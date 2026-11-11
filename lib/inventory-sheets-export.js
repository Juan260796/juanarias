/**
 * Lectura de control operativo para Google Sheets. Nunca exportar claves, PIN,
 * costos, ganancias, teléfonos, ni fechas de compra. Supabase es la autoridad.
 */
import { createAdminSupabase } from "./supabase-server";

async function allRows(db, table, columns, filters = null) {
  const rows = [];
  for (let start = 0; start < 20000; start += 750) {
    let query = db.from(table).select(columns).order("id", { ascending: true }).range(start, start + 749);
    if (filters) query = filters(query);
    const { data, error } = await query;
    if (error) throw new Error(`No se pudo consultar ${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < 750) return rows;
  }
  throw new Error(`Hay demasiados registros en ${table}; amplía la paginación del exportador.`);
}

function todayColombia() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function dayDifference(iso, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  return Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
}

export async function getInventorySheetsSnapshot() {
  const db = createAdminSupabase();
  const [accounts, services, assignments, subscriptions, clients] = await Promise.all([
    allRows(db, "inventario_cuentas", "id,servicio_id,correo,grupo,cupos_total,duracion_tipo,duracion_cantidad,fecha_vencimiento,estado"),
    allRows(db, "servicios", "id,nombre"),
    allRows(db, "inventario_asignaciones", "id,inventario_id,suscripcion_id,cupo_numero,activo"),
    allRows(db, "suscripciones", "id,cliente_id,fecha_inicio,fecha_vencimiento,activo"),
    allRows(db, "clientes", "id,nombre")
  ]);
  const eligible = accounts.filter(a => a.duracion_tipo === "meses" && Number(a.duracion_cantidad) >= 2);
  const servicesById = new Map(services.map(s => [s.id, s.nombre]));
  const clientsById = new Map(clients.map(c => [c.id, c.nombre]));
  const subscriptionsById = new Map(subscriptions.map(s => [s.id, s]));
  const assignmentsByAccount = new Map();
  // Puede haber asignaciones anteriores desactivadas; solamente la vigente.
  for (const a of assignments) {
    if (a.activo !== true) continue;
    if (!assignmentsByAccount.has(a.inventario_id)) assignmentsByAccount.set(a.inventario_id, new Map());
    assignmentsByAccount.get(a.inventario_id).set(Number(a.cupo_numero), a);
  }
  const today = todayColombia();
  const rows = [];
  for (const account of eligible) {
    const slots = Math.max(1, Math.min(500, Number(account.cupos_total) || 1));
    const accountAssignments = assignmentsByAccount.get(account.id) || new Map();
    for (let slot = 1; slot <= slots; slot++) {
      const assignment = accountAssignments.get(slot);
      const sub = assignment ? subscriptionsById.get(assignment.suscripcion_id) : null;
      const validSub = sub && sub.activo !== false;
      const clientExpiry = validSub ? sub.fecha_vencimiento : "";
      const daysClient = dayDifference(clientExpiry, today);
      const daysAccount = dayDifference(account.fecha_vencimiento, today);
      rows.push({
        cuenta_id: account.id,
        asignacion_id: validSub ? assignment.id : "",
        servicio: servicesById.get(account.servicio_id) || "Servicio",
        cuenta: account.correo || account.grupo || "(Sin referencia)",
        perfil: slot,
        cliente: validSub ? (clientsById.get(sub.cliente_id) || "Cliente") : "",
        inicio_cliente: validSub ? sub.fecha_inicio : "",
        vence_cliente: clientExpiry || "",
        dias_cliente: daysClient,
        estado_perfil: !validSub ? "Disponible" : (daysClient < 0 ? "Vencido / retirar" : daysClient <= 3 ? "Por vencer" : "Ocupado"),
        vence_cuenta: account.fecha_vencimiento || "",
        dias_cuenta: daysAccount,
        estado_cuenta: account.estado || "",
        duracion_cuenta: `${account.duracion_cantidad} meses`
      });
    }
  }
  return { ok: true, generado: new Date().toISOString(), cuentas: eligible.length, perfiles: rows.length, filas: rows };
}
