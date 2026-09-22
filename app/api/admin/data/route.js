import { requireAdmin } from "../../../../lib/supabase-server";
import { syncManyOrderMemberships } from "../../../../lib/google-sheets-sync";

function parseISO(value) {
  const [y, m, d] = String(value || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function cutoffFiveDaysExpired(todayValue) {
  const date = parseISO(todayValue);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() - 5);
  return toISO(date);
}

async function recalcInventoryState(supabase, inventarioId) {
  const { data: item } = await supabase
    .from("inventario_cuentas")
    .select("id,cupos_total,estado")
    .eq("id", inventarioId)
    .maybeSingle();
  if (!item || item.estado === "fallida" || item.estado === "reemplazada") return;

  const { count } = await supabase
    .from("inventario_asignaciones")
    .select("id", { count: "exact", head: true })
    .eq("inventario_id", inventarioId)
    .eq("activo", true);

  const estado = (count || 0) >= Number(item.cupos_total || 1) ? "agotada" : "disponible";
  await supabase.from("inventario_cuentas").update({ estado }).eq("id", inventarioId);
}

async function archiveFiveDayExpired(supabase, todayValue) {
  const cutoff = cutoffFiveDaysExpired(todayValue);
  if (!cutoff) return new Set();

  const { data: staleSubs, error } = await supabase
    .from("suscripciones")
    .select("id")
    .lte("fecha_vencimiento", cutoff)
    .eq("activo", true);

  if (error || !staleSubs?.length) return new Set();
  const ids = staleSubs.map((item) => item.id);

  const { data: assignments } = await supabase
    .from("inventario_asignaciones")
    .select("id,inventario_id,suscripcion_id")
    .in("suscripcion_id", ids)
    .eq("activo", true);

  if (assignments?.length) {
    await supabase
      .from("inventario_asignaciones")
      .update({ activo: false })
      .in("id", assignments.map((item) => item.id));

    const inventoryIds = [...new Set(assignments.map((item) => item.inventario_id).filter(Boolean))];
    await Promise.all(inventoryIds.map((inventoryId) => recalcInventoryState(supabase, inventoryId)));
  }

  // No borramos el cliente ni el historial físico. Se archiva el pedido para
  // que desaparezca del panel y pueda recuperarse en base de datos si hiciera falta.
  await supabase.from("suscripciones").update({ activo: false }).in("id", ids);
  await syncManyOrderMemberships(supabase, ids);
  return new Set(ids);
}

async function archiveExpiredInventory(supabase, todayValue) {
  const cutoff = cutoffFiveDaysExpired(todayValue);
  if (!cutoff) return;

  const { data: staleAccounts, error } = await supabase
    .from("inventario_cuentas")
    .select("id")
    .lte("fecha_vencimiento", cutoff)
    .neq("estado", "reemplazada");

  if (error || !staleAccounts?.length) return;
  const ids = staleAccounts.map((item) => item.id);

  await supabase
    .from("inventario_asignaciones")
    .update({ activo: false })
    .in("inventario_id", ids)
    .eq("activo", true);

  // Se archivan en vez de borrarse físicamente para conservar trazabilidad,
  // pero desaparecen de todo el panel y dejan libres sus perfiles/cupos.
  await supabase
    .from("inventario_cuentas")
    .update({ estado: "reemplazada" })
    .in("id", ids);
}

async function cleanupStaleAssignments(supabase) {
  const { data: assignments, error } = await supabase
    .from("inventario_asignaciones")
    .select("id,inventario_id,suscripcion_id")
    .eq("activo", true);
  if (error || !assignments?.length) return;

  const subIds = [...new Set(assignments.map((item) => item.suscripcion_id).filter(Boolean))];
  if (!subIds.length) return;
  const { data: subscriptions } = await supabase
    .from("suscripciones")
    .select("id,activo")
    .in("id", subIds);
  const activeIds = new Set((subscriptions || []).filter((item) => item.activo).map((item) => item.id));
  const stale = assignments.filter((item) => !activeIds.has(item.suscripcion_id));
  if (!stale.length) return;

  await supabase
    .from("inventario_asignaciones")
    .update({ activo: false })
    .in("id", stale.map((item) => item.id));

  const inventoryIds = [...new Set(stale.map((item) => item.inventario_id).filter(Boolean))];
  await Promise.all(inventoryIds.map((inventoryId) => recalcInventoryState(supabase, inventoryId)));
}

async function syncLoyaltyRewards(supabase, orderCounts) {
  const { data: existing, error: existingError } = await supabase
    .from("premios_fidelidad")
    .select("id,cliente_id,ciclo_numero,estado,created_at,entregado_at");
  if (existingError) throw existingError;

  const existingKeys = new Set((existing || []).map((item) => `${item.cliente_id}:${item.ciclo_numero}`));
  const missing = [];
  for (const [clienteId, countValue] of Object.entries(orderCounts || {})) {
    const earned = Math.floor(Number(countValue || 0) / 10);
    for (let cycle = 1; cycle <= earned; cycle += 1) {
      const key = `${clienteId}:${cycle}`;
      if (!existingKeys.has(key)) missing.push({ cliente_id: clienteId, ciclo_numero: cycle, estado: "pendiente" });
    }
  }

  if (missing.length) {
    const { error } = await supabase
      .from("premios_fidelidad")
      .upsert(missing, { onConflict: "cliente_id,ciclo_numero", ignoreDuplicates: true });
    if (error) throw error;
  }

  const { data, error } = await supabase
    .from("premios_fidelidad")
    .select("id,cliente_id,ciclo_numero,estado,created_at,entregado_at,clientes(id,nombre,username,telefono)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const requestUrl = new URL(request.url);
  const today = requestUrl.searchParams.get("today") || "";
  const archivedIds = await archiveFiveDayExpired(supabase, today);
  await archiveExpiredInventory(supabase, today);
  await cleanupStaleAssignments(supabase);

  const [clientesRes, serviciosRes, promocionesRes, inventarioRes, proveedoresRes, asignacionesRes] = await Promise.all([
    supabase.from("clientes").select("id,nombre,username,telefono,created_at,auth_user_id").order("created_at", { ascending: false }),
    supabase.from("servicios").select("*").order("nombre", { ascending: true }),
    supabase.from("promociones").select("*").order("fecha_inicio", { ascending: false }),
    supabase
      .from("inventario_cuentas")
      .select("id,servicio_id,proveedor_id,correo,clave,pin,perfiles_pins,grupo,perfil,etiqueta,notas,estado,fecha_carga,fecha_vencimiento,created_at,cupos_total,duracion_tipo,duracion_cantidad,servicios(id,nombre,tipo_entrega,duracion_tipo,duracion_cantidad),proveedores(id,iniciales,activo)")
      .order("created_at", { ascending: false }),
    supabase.from("proveedores").select("*").order("iniciales", { ascending: true }),
    supabase.from("inventario_asignaciones").select("*").order("fecha_asignacion", { ascending: false })
  ]);

  const firstBaseError = clientesRes.error || serviciosRes.error || promocionesRes.error || inventarioRes.error || proveedoresRes.error || asignacionesRes.error;
  if (firstBaseError) return Response.json({ error: firstBaseError.message }, { status: 500 });

  // La v38 agrega dos columnas a suscripciones. Si todavía no se ha ejecutado
  // MIGRACION_V38_DESDE_V37.sql, no dejamos que falle TODA la carga del panel:
  // recuperamos pedidos con el esquema anterior para que clientes, servicios,
  // inventario y demás información sigan siendo visibles.
  let profitSchemaReady = true;
  let suscripcionesRes = await supabase
    .from("suscripciones")
    .select("id,cliente_id,servicio_id,fecha_inicio,fecha_vencimiento,ganancia_neta,fecha_ganancia,activo,reporte_vencimiento,fecha_reporte,clientes(id,nombre,username,telefono)")
    .order("fecha_vencimiento", { ascending: true });

  if (suscripcionesRes.error) {
    const msg = String(suscripcionesRes.error.message || "").toLowerCase();
    const missingProfitColumns = msg.includes("ganancia_neta") || msg.includes("fecha_ganancia") || (msg.includes("column") && msg.includes("suscripciones"));
    if (!missingProfitColumns) return Response.json({ error: suscripcionesRes.error.message }, { status: 500 });

    profitSchemaReady = false;
    suscripcionesRes = await supabase
      .from("suscripciones")
      .select("id,cliente_id,servicio_id,fecha_inicio,fecha_vencimiento,activo,reporte_vencimiento,fecha_reporte,clientes(id,nombre,username,telefono)")
      .order("fecha_vencimiento", { ascending: true });
    if (suscripcionesRes.error) return Response.json({ error: suscripcionesRes.error.message }, { status: 500 });
  }

  const allSubscriptions = suscripcionesRes.data || [];
  const visibleSubscriptions = allSubscriptions.filter((item) => !archivedIds.has(item.id));
  const order_counts = {};
  for (const item of allSubscriptions) {
    if (item.cliente_id) order_counts[item.cliente_id] = (order_counts[item.cliente_id] || 0) + 1;
  }

  let premios_fidelidad = [];
  try {
    premios_fidelidad = await syncLoyaltyRewards(supabase, order_counts);
  } catch (rewardError) {
    return Response.json({ error: `Programa de fidelidad: ${rewardError.message}` }, { status: 500 });
  }

  const inventoryHistory = inventarioRes.data || [];
  // Las cuentas externas se crean al momento de un pedido para mostrar sus
  // credenciales al cliente, pero no forman parte del stock administrado.
  const managedInventoryHistory = inventoryHistory.filter((item) => item.etiqueta !== "externa");
  const visibleInventory = managedInventoryHistory.filter((item) => item.estado !== "reemplazada");

  return Response.json({
    clientes: clientesRes.data || [],
    servicios: serviciosRes.data || [],
    suscripciones: visibleSubscriptions,
    ganancias: profitSchemaReady
      ? allSubscriptions.map((item) => ({ id: item.id, fecha_inicio: item.fecha_inicio, fecha_ganancia: item.fecha_ganancia, ganancia_neta: item.ganancia_neta == null ? null : Number(item.ganancia_neta) }))
      : [],
    ganancias_configuradas: profitSchemaReady,
    promociones: promocionesRes.data || [],
    premios_fidelidad,
    inventario: visibleInventory,
    inventario_historico: managedInventoryHistory,
    proveedores: proveedoresRes.data || [],
    asignaciones: asignacionesRes.data || [],
    order_counts
  });
}
