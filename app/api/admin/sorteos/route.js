import { randomInt } from "node:crypto";
import { requireAdmin } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function colombiaDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function fechaAnterior(fecha, dias = 1) {
  const date = new Date(`${fecha}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - dias);
  return date.toISOString().slice(0, 10);
}

function fechaSolicitada(request) {
  const hoy = colombiaDate();
  const url = new URL(request.url);
  const fecha = url.searchParams.get("fecha") || fechaAnterior(hoy);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
      !Number.isFinite(Date.parse(`${fecha}T12:00:00Z`)) ||
      new Date(`${fecha}T12:00:00Z`).toISOString().slice(0, 10) !== fecha) {
    throw new Error("La fecha seleccionada no es válida.");
  }
  if (fecha > hoy) throw new Error("No se pueden consultar sorteos de fechas futuras.");
  return { fecha, hoy, ultimaFechaSorteable: fechaAnterior(hoy) };
}

// La fecha del sorteo se compara con la fecha elegida al vender o renovar,
// no con created_at: registrar hoy una compra de otro día no da cupos hoy.
async function getEntries(supabase, fecha) {
  const [ordersRes, renewalsRes] = await Promise.all([
    supabase.from("suscripciones")
      .select("id,cliente_id,excluido_conteo,fecha_inicio,created_at,clientes(id,nombre,telefono)")
      .eq("fecha_inicio", fecha)
      .order("created_at", { ascending: true }),
    supabase.from("ganancias_renovaciones")
      .select("id,suscripcion_id,cliente_id,cliente_nombre,fecha_ganancia,created_at")
      .eq("fecha_ganancia", fecha)
      .order("created_at", { ascending: true })
  ]);
  if (ordersRes.error) throw new Error(`No se pudieron consultar las compras: ${ordersRes.error.message}`);
  if (renewalsRes.error) throw new Error(`No se pudieron consultar las renovaciones: ${renewalsRes.error.message}`);
  const groups = new Map();
  const add = (clienteId, nombre, telefono) => {
    if (!clienteId) return;
    const id = String(clienteId);
    if (!groups.has(id)) groups.set(id, { cliente_id: id, nombre: nombre || "Cliente", telefono: telefono || "", cupos: 0 });
    const current = groups.get(id);
    current.cupos += 1;
    if (nombre && current.nombre === "Cliente") current.nombre = nombre;
    if (telefono && !current.telefono) current.telefono = telefono;
  };
  // Al renovar, suscripciones.fecha_inicio se cambia a la fecha de la renovación,
  // y ganancias_renovaciones guarda el movimiento real. Esa misma operación
  // NO debe entregar dos boletos (uno por cada tabla).
  const pedidosRenovadosEstaFecha = new Set(
    (renewalsRes.data || [])
      .filter(item => item.suscripcion_id && item.fecha_ganancia === fecha)
      .map(item => String(item.suscripcion_id))
  );
  for (const order of ordersRes.data || []) {
    if (order.excluido_conteo === true) continue;
    if (pedidosRenovadosEstaFecha.has(String(order.id))) continue;
    const cliente = Array.isArray(order.clientes) ? order.clientes[0] : order.clientes;
    add(order.cliente_id, cliente?.nombre, cliente?.telefono);
  }
  const renewalIds = new Set();
  for (const renewal of renewalsRes.data || []) {
    if (renewalIds.has(renewal.id)) continue;
    renewalIds.add(renewal.id);
    add(renewal.cliente_id, renewal.cliente_nombre, "");
  }
  const participantes = Array.from(groups.values()).sort((a,b) => a.nombre.localeCompare(b.nombre, "es"));
  // Renovaciones: completar teléfono desde clientes si ese cliente no compró otro servicio hoy.
  const missing = participantes.filter(item => !item.telefono).map(item => item.cliente_id);
  if (missing.length) {
    const { data: clients, error } = await supabase.from("clientes").select("id,nombre,telefono").in("id", missing);
    if (error) throw new Error(error.message);
    for (const client of clients || []) {
      const entry = groups.get(String(client.id));
      if (entry) { entry.telefono = client.telefono || ""; entry.nombre = client.nombre || entry.nombre; }
    }
  }
  return participantes;
}

// Cada cupo recibe un número estable y una ubicación visual mezclada por fecha.
// La selección de ganadores sigue siendo criptográficamente aleatoria.
function boletosDeFecha(fecha, participantes) {
  const tickets = [];
  for (const person of participantes) {
    for (let i = 0; i < Number(person.cupos || 0); i++) {
      tickets.push({ cliente_id: String(person.cliente_id), nombre: person.nombre, numero: tickets.length + 1 });
    }
  }
  let seed = 2166136261;
  for (const ch of fecha) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  for (let i = tickets.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tickets[i], tickets[j]] = [tickets[j], tickets[i]];
  }
  return tickets;
}

function chooseWeightedTwo(fecha, participantes) {
  let disponibles = boletosDeFecha(fecha, participantes);
  const winners = [];
  for (let i = 0; i < 2; i++) {
    if (!disponibles.length) throw new Error("Se requieren dos clientes diferentes.");
    const ticket = disponibles[randomInt(disponibles.length)];
    const person = participantes.find(p => String(p.cliente_id) === ticket.cliente_id);
    winners.push({ ...person, cupo_ganador: ticket.numero });
    disponibles = disponibles.filter(item => item.cliente_id !== ticket.cliente_id);
  }
  return winners;
}

async function findExisting(supabase, fecha) {
  const { data, error } = await supabase.from("sorteos_diarios")
    .select("fecha,participantes,ganadores,participaciones,clientes_elegibles,created_at")
    .eq("fecha", fecha).maybeSingle();
  if (error) throw new Error(`${error.message}. Ejecuta MIGRACION_SORTEOS_DIARIOS.sql en Supabase.`);
  return data;
}

function payload(fecha, participantes, sorteo) {
  return {
    fecha,
    participantes: sorteo ? (sorteo.participantes || participantes) : participantes,
    participaciones: sorteo ? sorteo.participaciones : participantes.reduce((sum, p) => sum + p.cupos, 0),
    clientes_elegibles: sorteo ? sorteo.clientes_elegibles : participantes.length,
    boletos: boletosDeFecha(fecha, sorteo ? (sorteo.participantes || participantes) : participantes),
    sorteo: sorteo ? { fecha: sorteo.fecha, ganadores: sorteo.ganadores, created_at: sorteo.created_at } : null
  };
}

async function getEstados(supabase, hoy) {
  const ultima = fechaAnterior(hoy);
  const primera = fechaAnterior(ultima, 89);
  const { data, error } = await supabase.from("sorteos_diarios")
    .select("fecha").gte("fecha", primera).lte("fecha", ultima);
  if (error) throw new Error(`No se pudieron consultar los sorteos anteriores: ${error.message}`);
  const realizados = new Set((data || []).map(item => item.fecha));
  return Array.from({ length: 90 }, (_, i) => {
    const fecha = fechaAnterior(ultima, i);
    return { fecha, estado: realizados.has(fecha) ? "realizado" : "pendiente" };
  });
}

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  try {
    const { fecha, hoy, ultimaFechaSorteable } = fechaSolicitada(request);
    const [existing, estados] = await Promise.all([
      findExisting(auth.supabase, fecha), getEstados(auth.supabase, hoy)
    ]);
    const participantes = existing ? [] : await getEntries(auth.supabase, fecha);
    return Response.json({
      ...payload(fecha, participantes, existing),
      fecha_hoy: hoy,
      fecha_maxima_sorteable: ultimaFechaSorteable,
      estado: existing ? "realizado" : fecha === hoy ? "en_curso" : "pendiente",
      estados
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    if (!body?.fecha) return Response.json({ error: "Selecciona la fecha de las ventas." }, { status: 400 });
    const { fecha, hoy } = fechaSolicitada(new Request(`http://local/sorteos?fecha=${encodeURIComponent(body.fecha)}`));
    if (fecha >= hoy) return Response.json({ error: "El sorteo solo puede realizarse a partir del día siguiente a las ventas." }, { status: 400 });
    const existing = await findExisting(auth.supabase, fecha);
    if (existing) return Response.json(payload(fecha, [], existing));
    const participantes = await getEntries(auth.supabase, fecha);
    if (participantes.length < 2) return Response.json({ error: "Se necesitan al menos dos clientes distintos con compras registradas en la fecha seleccionada." }, { status: 400 });
    const ganadores = chooseWeightedTwo(fecha, participantes);
    const record = {
      fecha, ganadores, participantes,
      participaciones: participantes.reduce((sum, item) => sum + item.cupos, 0),
      clientes_elegibles: participantes.length
    };
    const { data, error } = await auth.supabase.from("sorteos_diarios")
      .insert(record).select("*").single();
    if (error) {
      // Evita sorteos duplicados en clics simultáneos: fecha es clave primaria.
      if (error.code === "23505") {
        const saved = await findExisting(auth.supabase, fecha);
        if (saved) return Response.json(payload(fecha, [], saved));
      }
      throw new Error(error.message);
    }
    return Response.json(payload(fecha, [], data));
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
}
