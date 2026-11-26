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

function utcRangeForBogotaDay(fecha) {
  // Colombia UTC-5 todo el año. Los registros se filtran por created_at,
  // nunca por fecha de inicio/vencimiento (que puede ser retroactiva).
  return { start: `${fecha}T05:00:00.000Z`, end: `${fechaSiguiente(fecha)}T05:00:00.000Z` };
}

function fechaSiguiente(fecha) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function getEntries(supabase, fecha) {
  const { start, end } = utcRangeForBogotaDay(fecha);
  const [ordersRes, renewalsRes] = await Promise.all([
    supabase.from("suscripciones")
      .select("id,cliente_id,excluido_conteo,created_at,clientes(id,nombre,telefono)")
      .gte("created_at", start).lt("created_at", end)
      .order("created_at", { ascending: true }),
    supabase.from("ganancias_renovaciones")
      .select("id,cliente_id,cliente_nombre,created_at")
      .gte("created_at", start).lt("created_at", end)
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
  for (const order of ordersRes.data || []) {
    if (order.excluido_conteo === true) continue;
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

function chooseWeightedTwo(participantes) {
  const available = [...participantes];
  const winners = [];
  for (let i = 0; i < 2; i++) {
    const total = available.reduce((sum, item) => sum + item.cupos, 0);
    if (total <= 0) throw new Error("Se requieren dos clientes diferentes.");
    const ticket = randomInt(total);
    let cumulative = 0;
    const selectedIndex = available.findIndex(item => { cumulative += item.cupos; return ticket < cumulative; });
    winners.push(available.splice(selectedIndex, 1)[0]);
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
    sorteo: sorteo ? { fecha: sorteo.fecha, ganadores: sorteo.ganadores, created_at: sorteo.created_at } : null
  };
}

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  try {
    const fecha = colombiaDate();
    const existing = await findExisting(auth.supabase, fecha);
    const participantes = existing ? [] : await getEntries(auth.supabase, fecha);
    return Response.json(payload(fecha, participantes, existing), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  try {
    const fecha = colombiaDate();
    const existing = await findExisting(auth.supabase, fecha);
    if (existing) return Response.json(payload(fecha, [], existing));
    const participantes = await getEntries(auth.supabase, fecha);
    if (participantes.length < 2) return Response.json({ error: "Se necesitan al menos dos clientes distintos con compras de hoy." }, { status: 400 });
    const ganadores = chooseWeightedTwo(participantes);
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
