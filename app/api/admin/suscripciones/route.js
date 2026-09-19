import { requireAdmin } from "../../../../lib/supabase-server";
import { getOrderSyncSnapshot, syncOrderDelete, syncOrderMembership } from "../../../../lib/google-sheets-sync";


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

async function recalcInventoryState(supabase, inventarioId) {
  if (!inventarioId) return;
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

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const cliente_id = String(body.cliente_id || "");
  const servicio_id = String(body.servicio_id || "");
  const fecha_inicio = String(body.fecha_inicio || "");
  const fecha_vencimiento = String(body.fecha_vencimiento || "");
  const ganancia_neta = Number(body.ganancia_neta);
  const fecha_ganancia = String(body.fecha_ganancia || fecha_inicio || "");

  if (!cliente_id || !servicio_id || !fecha_inicio || !fecha_vencimiento) {
    return Response.json({ error: "Cliente, servicio y fechas son obligatorios." }, { status: 400 });
  }
  if (!Number.isFinite(ganancia_neta) || ganancia_neta < 0) {
    return Response.json({ error: "Escribe una ganancia neta válida para el pedido." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("suscripciones")
    .insert({ cliente_id, servicio_id, fecha_inicio, fecha_vencimiento, ganancia_neta, fecha_ganancia, activo: true })
    .select("id")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ suscripcion: data }, { status: 201 });
}

export async function PATCH(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return Response.json({ error: "Falta el ID de la suscripción." }, { status: 400 });

  const { data: current, error: currentError } = await supabase
    .from("suscripciones")
    .select("id,cliente_id,servicio_id,fecha_inicio,fecha_vencimiento,activo")
    .eq("id", id)
    .single();
  if (currentError || !current) return Response.json({ error: currentError?.message || "Pedido no encontrado." }, { status: 404 });

  const changes = {};
  if (typeof body.activo === "boolean") changes.activo = body.activo;
  if (body.fecha_vencimiento) changes.fecha_vencimiento = String(body.fecha_vencimiento);

  const wantsEditableFields = Boolean(body.fecha_inicio || body.servicio_id || Object.prototype.hasOwnProperty.call(body, "cupo_numero"));

  if (wantsEditableFields) {
    const nextStart = String(body.fecha_inicio || current.fecha_inicio || "").trim();
    const nextServiceId = String(body.servicio_id || current.servicio_id || "").trim();
    if (!nextStart || !nextServiceId) return Response.json({ error: "Fecha de inicio y servicio son obligatorios." }, { status: 400 });

    const [{ data: service, error: serviceError }, { data: assignment, error: assignmentError }] = await Promise.all([
      supabase.from("servicios").select("id,nombre,activo,duracion_tipo,duracion_cantidad").eq("id", nextServiceId).single(),
      supabase.from("inventario_asignaciones").select("id,inventario_id,cupo_numero,activo").eq("suscripcion_id", id).eq("activo", true).maybeSingle()
    ]);
    if (serviceError || !service) return Response.json({ error: serviceError?.message || "Servicio no encontrado." }, { status: 404 });
    if (service.activo === false) return Response.json({ error: "El servicio seleccionado está inactivo." }, { status: 400 });
    if (assignmentError) return Response.json({ error: assignmentError.message }, { status: 400 });

    let inventory = null;
    if (assignment?.inventario_id) {
      const { data: item, error: itemError } = await supabase
        .from("inventario_cuentas")
        .select("id,servicio_id,cupos_total,duracion_tipo,duracion_cantidad,etiqueta")
        .eq("id", assignment.inventario_id)
        .single();
      if (itemError || !item) return Response.json({ error: itemError?.message || "No se encontró la cuenta asignada." }, { status: 400 });
      inventory = item;

      if (inventory.servicio_id !== nextServiceId) {
        if (inventory.etiqueta === "externa") {
          const externalDurationType = service.duracion_tipo || "meses";
          const externalDurationQty = Number(service.duracion_cantidad || 1);
          const { error: invServiceError } = await supabase.from("inventario_cuentas").update({
            servicio_id: nextServiceId,
            duracion_tipo: externalDurationType,
            duracion_cantidad: externalDurationQty
          }).eq("id", inventory.id);
          if (invServiceError) return Response.json({ error: invServiceError.message }, { status: 400 });
          inventory = { ...inventory, servicio_id: nextServiceId, duracion_tipo: externalDurationType, duracion_cantidad: externalDurationQty };
        } else {
          return Response.json({
            error: "La cuenta de stock asignada pertenece a otro servicio. Para cambiar el servicio, usa una cuenta del mismo servicio o reemplaza primero la cuenta asignada."
          }, { status: 400 });
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, "cupo_numero")) {
        const requestedSlot = Number(body.cupo_numero);
        if (!Number.isInteger(requestedSlot) || requestedSlot < 1) {
          return Response.json({ error: "El perfil/cupo debe ser un número válido." }, { status: 400 });
        }

        let maxSlots = Number(inventory.cupos_total || 1);
        if (inventory.etiqueta === "externa" && requestedSlot > maxSlots) {
          const { error: expandError } = await supabase.from("inventario_cuentas").update({ cupos_total: requestedSlot }).eq("id", inventory.id);
          if (expandError) return Response.json({ error: expandError.message }, { status: 400 });
          maxSlots = requestedSlot;
        }
        if (requestedSlot > maxSlots) return Response.json({ error: `El perfil/cupo debe estar entre 1 y ${maxSlots}.` }, { status: 400 });

        const { data: occupied, error: occupiedError } = await supabase
          .from("inventario_asignaciones")
          .select("id")
          .eq("inventario_id", inventory.id)
          .eq("cupo_numero", requestedSlot)
          .eq("activo", true)
          .neq("id", assignment.id)
          .maybeSingle();
        if (occupiedError) return Response.json({ error: occupiedError.message }, { status: 400 });
        if (occupied) return Response.json({ error: `El perfil/cupo ${requestedSlot} ya está ocupado en esa cuenta.` }, { status: 409 });

        if (requestedSlot !== Number(assignment.cupo_numero)) {
          const { error: slotError } = await supabase.from("inventario_asignaciones").update({ cupo_numero: requestedSlot }).eq("id", assignment.id);
          if (slotError) return Response.json({ error: slotError.message }, { status: 400 });
        }
      }
    } else if (Object.prototype.hasOwnProperty.call(body, "cupo_numero")) {
      return Response.json({ error: "Este pedido no tiene una cuenta/perfil asignado para editar." }, { status: 400 });
    }

    const durationType = inventory?.duracion_tipo || service.duracion_tipo || "meses";
    const durationQty = Number(inventory?.duracion_cantidad || service.duracion_cantidad || 1);
    const recalculatedExpiry = addDurationISO(nextStart, durationType, durationQty);
    if (!recalculatedExpiry) return Response.json({ error: "No se pudo recalcular la fecha final." }, { status: 400 });

    changes.fecha_inicio = nextStart;
    changes.servicio_id = nextServiceId;
    changes.fecha_vencimiento = recalculatedExpiry;

    if (inventory?.etiqueta === "externa") {
      const { error: externalDateError } = await supabase.from("inventario_cuentas").update({
        fecha_carga: nextStart,
        fecha_vencimiento: recalculatedExpiry
      }).eq("id", inventory.id);
      if (externalDateError) return Response.json({ error: externalDateError.message }, { status: 400 });
    }
  }

  if (Object.keys(changes).length === 0) {
    return Response.json({ error: "No hay cambios para guardar." }, { status: 400 });
  }

  const { error } = await supabase.from("suscripciones").update(changes).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  await syncOrderMembership(supabase, id);
  return Response.json({ ok: true });
}

export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return Response.json({ error: "Falta el ID de la suscripción." }, { status: 400 });

  // Guardamos primero si este pedido pertenece a JU para actualizar el respaldo
  // incluso después de borrarlo de Supabase.
  const googleSnapshot = await getOrderSyncSnapshot(supabase, id);

  // Guardamos qué cuentas estaban usando este pedido para liberar sus perfiles/cupos
  // inmediatamente después de eliminarlo.
  const { data: assignments, error: assignmentsError } = await supabase
    .from("inventario_asignaciones")
    .select("id,inventario_id")
    .eq("suscripcion_id", id)
    .eq("activo", true);

  if (assignmentsError) return Response.json({ error: assignmentsError.message }, { status: 400 });
  const inventoryIds = [...new Set((assignments || []).map((item) => item.inventario_id).filter(Boolean))];

  // Borramos las asignaciones de ese pedido antes de borrar la suscripción.
  // Así el perfil/cupo queda libre incluso si una instalación antigua de la
  // base no tenía ON DELETE CASCADE correctamente configurado.
  if ((assignments || []).length > 0) {
    const { error: releaseError } = await supabase
      .from("inventario_asignaciones")
      .delete()
      .eq("suscripcion_id", id);
    if (releaseError) return Response.json({ error: releaseError.message }, { status: 400 });
  }

  const { error } = await supabase.from("suscripciones").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });

  await Promise.all(inventoryIds.map((inventoryId) => recalcInventoryState(supabase, inventoryId)));
  if (googleSnapshot?.isJU) await syncOrderDelete(id);
  return Response.json({ ok: true, perfiles_liberados: (assignments || []).length });
}
