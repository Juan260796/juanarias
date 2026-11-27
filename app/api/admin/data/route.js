import { requireAdmin } from "../../../../lib/supabase-server";

// No existe limpieza por fecha: la gestión de cupos se realiza manualmente.

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
  // Política de liberación MANUAL: el vencimiento no desocupa ni archiva
  // asignaciones. Solo la acción «Liberado» en avisos (o una operación manual
  // explícita de suspensión/cambio) puede cerrar una asignación.
  const archivedIds = new Set();

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
  .select(`
    id,
    cliente_id,
    servicio_id,
    fecha_inicio,
    fecha_vencimiento,
    ganancia_neta,
    fecha_ganancia,
    activo,
    reporte_vencimiento,
    fecha_reporte,
    excluido_conteo,
    es_premio,
    clientes(id,nombre,username,telefono),
    servicio:servicios!suscripciones_servicio_id_fkey(nombre) 
  `)
  .order("fecha_vencimiento", { ascending: true });

  if (suscripcionesRes.error) {
    const msg = String(suscripcionesRes.error.message || "").toLowerCase();
    const missingProfitColumns = msg.includes("ganancia_neta") || msg.includes("fecha_ganancia") || (msg.includes("column") && msg.includes("suscripciones"));
    if (!missingProfitColumns) return Response.json({ error: suscripcionesRes.error.message }, { status: 500 });

    profitSchemaReady = false;
    suscripcionesRes = await supabase
  .from("suscripciones")
  .select(`
    id,
    cliente_id,
    servicio_id,
    fecha_inicio,
    fecha_vencimiento,
    activo,
    reporte_vencimiento,
    fecha_reporte,
    excluido_conteo,
    es_premio,
    clientes(id,nombre,username,telefono),
    servicio:servicios!suscripciones_servicio_id_fkey(nombre)
  `)
  .order("fecha_vencimiento", { ascending: true });
    if (suscripcionesRes.error) return Response.json({ error: suscripcionesRes.error.message }, { status: 500 });
  }

  // Ganancias de renovaciones: una fila por evento y fecha real de renovación.
  const { data: renewalEarnings, error: renewalEarningsError } = await supabase
    .from("ganancias_renovaciones")
    .select("id,suscripcion_id,cliente_id,servicio_id,cliente_nombre,servicio_nombre,ganancia_neta,fecha_ganancia,created_at")
    .order("fecha_ganancia", { ascending: false });
  if (renewalEarningsError) {
    return Response.json({ error: "Consulta de ganancias de renovación: " + renewalEarningsError.message + ". Ejecuta MIGRACION_GANANCIAS_RENOVACIONES.sql." }, { status: 500 });
  }

  // La ausencia de la nueva tabla de plantillas no debe bloquear el panel.
  const { data: templatesData, error: templatesError } = await supabase
    .from("plantillas_mensajes")
    .select("id,servicio_id,nombre,contenido,activo,created_at,updated_at");
  const plantillas_mensajes = templatesError ? [] : (templatesData || []);

  const allSubscriptions = suscripcionesRes.data || [];
  const visibleSubscriptions = allSubscriptions.filter((item) => !archivedIds.has(item.id) && (item.excluido_conteo !== true || item.es_premio === true));
  const order_counts = {};
  for (const item of allSubscriptions) {
    // Solo excluimos pedidos que se eliminaron manualmente en versiones anteriores.
    // Los archivados automáticamente permanecen en el historial y siguen contando.
    if (item.cliente_id && item.excluido_conteo !== true) {
      order_counts[item.cliente_id] = (order_counts[item.cliente_id] || 0) + 1;
    }
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
  const managedInventoryHistory = inventoryHistory.filter(
  (item) => item.etiqueta !== "externa"
);

const externalInventory = inventoryHistory.filter(
  (item) => item.etiqueta === "externa"
);

const visibleInventory = managedInventoryHistory.filter(
  (item) => !["reemplazada", "retirada"].includes(item.estado)
);

  
  
  return Response.json({
    clientes: clientesRes.data || [],
    plantillas_mensajes,
    servicios: serviciosRes.data || [],
    suscripciones: visibleSubscriptions,

   ganancias: profitSchemaReady
  ? allSubscriptions.map((item) => ({
      id: item.id,
      cliente_id: item.cliente_id,
      servicio_id: item.servicio_id,
      fecha_inicio: item.fecha_inicio,
      fecha_vencimiento: item.fecha_vencimiento,
      fecha_ganancia: item.fecha_ganancia,
      ganancia_neta:
        item.ganancia_neta == null
          ? null
          : Number(item.ganancia_neta),
      cliente: Array.isArray(item.clientes)
        ? item.clientes[0] || null
        : item.clientes || null,
      servicio: Array.isArray(item.servicio)
        ? item.servicio[0] || null
        : item.servicio || null
    })).concat((renewalEarnings || []).map((item) => ({
      id: item.id,
      suscripcion_id: item.suscripcion_id,
      es_renovacion: true,
      cliente_id: item.cliente_id,
      servicio_id: item.servicio_id,
      fecha_inicio: item.fecha_ganancia,
      fecha_ganancia: item.fecha_ganancia,
      ganancia_neta: Number(item.ganancia_neta),
      cliente: { nombre: item.cliente_nombre || "Cliente" },
      servicio: { nombre: item.servicio_nombre || "Servicio" }
    })))
  : [],

    ganancias_configuradas: profitSchemaReady,
    promociones: promocionesRes.data || [],
    premios_fidelidad,

inventario: visibleInventory,
inventario_historico: managedInventoryHistory,
inventario_externo: inventoryHistory.filter(
  (item) => item.etiqueta === "externa"
),
    proveedores: proveedoresRes.data || [],
    asignaciones: asignacionesRes.data || [],
    order_counts
  });
}
