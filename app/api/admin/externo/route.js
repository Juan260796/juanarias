import { requireAdmin } from "../../../../lib/supabase-server";
import { syncOrderMembership } from "../../../../lib/google-sheets-sync";

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function effectiveDeliveryType(service) {
  const name = normalizeName(service?.nombre);
  if (name.startsWith("gemini")) return "gemini";
  if (name.startsWith("chatgpt") || name.startsWith("chat gpt")) return "chatgpt";
  return service?.tipo_entrega || "estandar";
}

function addDurationISO(dateString, tipo, cantidad) {
  const [y, m, d] = String(dateString || "").split("-").map(Number);
  if (!y || !m || !d) return "";
  const qty = Math.max(1, Number(cantidad) || 1);

  if (tipo === "dias") {
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + qty);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  if (tipo === "anios") {
    const targetYear = y + qty;
    const lastDay = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
    return `${targetYear}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
  }

  const monthIndex = (m - 1) + qty;
  const targetYear = y + Math.floor(monthIndex / 12);
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const cliente_id = String(body.cliente_id || "").trim();
  const servicio_id = String(body.servicio_id || "").trim();
  const fecha_inicio = String(body.fecha_inicio || "").trim();
  const correo = String(body.correo || "").trim();
  const clave = String(body.clave || "").trim() || null;
  const pin = String(body.pin || "").trim() || null;
  const proveedor_id = String(body.proveedor_id || "").trim() || null;
  const perfil = Number(body.perfil || 1);
  const ganancia_neta = Number(body.ganancia_neta);
  const fecha_ganancia = String(body.fecha_ganancia || fecha_inicio || "").trim();

  if (!cliente_id || !servicio_id || !fecha_inicio || !correo) {
    return Response.json({ error: "Cliente, servicio, fecha y correo/acceso son obligatorios." }, { status: 400 });
  }
  if (!Number.isInteger(perfil) || perfil < 1 || perfil > 50) {
    return Response.json({ error: "El perfil/cupo debe estar entre 1 y 50." }, { status: 400 });
  }
  if (!Number.isFinite(ganancia_neta) || ganancia_neta < 0) {
    return Response.json({ error: "Escribe una ganancia neta válida para el pedido." }, { status: 400 });
  }

  const [{ data: cliente, error: clienteError }, { data: servicio, error: servicioError }] = await Promise.all([
    supabase.from("clientes").select("id,nombre,username,telefono").eq("id", cliente_id).single(),
    supabase.from("servicios").select("id,nombre,tipo_entrega,duracion_tipo,duracion_cantidad,activo").eq("id", servicio_id).single()
  ]);

  if (clienteError || !cliente) return Response.json({ error: clienteError?.message || "Cliente no encontrado." }, { status: 404 });
  if (servicioError || !servicio) return Response.json({ error: servicioError?.message || "Servicio no encontrado." }, { status: 404 });
  if (servicio.activo === false) return Response.json({ error: "Ese servicio está inactivo." }, { status: 400 });

  const durationType = servicio.duracion_tipo || "meses";
  const durationQty = Number(servicio.duracion_cantidad || 1);
  const fecha_vencimiento = addDurationISO(fecha_inicio, durationType, durationQty);
  if (!fecha_vencimiento) return Response.json({ error: "No pudimos calcular el vencimiento." }, { status: 400 });

  const { data: suscripcion, error: subError } = await supabase
    .from("suscripciones")
    .insert({ cliente_id, servicio_id, fecha_inicio, fecha_vencimiento, ganancia_neta, fecha_ganancia, activo: true })
    .select("id,cliente_id,servicio_id,fecha_inicio,fecha_vencimiento,ganancia_neta,fecha_ganancia,activo")
    .single();
  if (subError) return Response.json({ error: subError.message }, { status: 400 });

  const type = effectiveDeliveryType(servicio);
  const perfiles_pins = pin ? { [String(perfil)]: pin } : {};
  const accountInsert = {
    servicio_id,
    proveedor_id,
    correo: type === "gemini" ? correo : correo,
    clave,
    pin: null,
    perfiles_pins,
    grupo: type === "gemini" ? correo : null,
    perfil: null,
    etiqueta: "externa",
    notas: "Cuenta externa / perfil comprado por fuera",
    estado: "agotada",
    cupos_total: Math.max(1, perfil),
    duracion_tipo: durationType,
    duracion_cantidad: durationQty,
    fecha_carga: fecha_inicio,
    fecha_vencimiento
  };

  const { data: cuenta, error: cuentaError } = await supabase
    .from("inventario_cuentas")
    .insert(accountInsert)
    .select("*")
    .single();

  if (cuentaError || !cuenta) {
    await supabase.from("suscripciones").delete().eq("id", suscripcion.id);
    return Response.json({ error: cuentaError?.message || "No pudimos guardar las credenciales externas." }, { status: 400 });
  }

  const { data: asignacion, error: assignmentError } = await supabase
    .from("inventario_asignaciones")
    .insert({
      inventario_id: cuenta.id,
      suscripcion_id: suscripcion.id,
      cliente_id,
      cupo_numero: perfil,
      correo_cliente: type === "gemini" ? correo : null,
      activo: true,
      es_reemplazo: false,
      reemplaza_asignacion_id: null
    })
    .select("*")
    .single();

  if (assignmentError || !asignacion) {
    await supabase.from("inventario_cuentas").delete().eq("id", cuenta.id);
    await supabase.from("suscripciones").delete().eq("id", suscripcion.id);
    return Response.json({ error: assignmentError?.message || "No pudimos asignar las credenciales al cliente." }, { status: 400 });
  }

  await syncOrderMembership(supabase, suscripcion.id);
  return Response.json({ cliente, servicio, suscripcion, cuenta, asignacion }, { status: 201 });
}
