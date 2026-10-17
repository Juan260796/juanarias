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
  const fecha_ganancia = String(fecha_inicio || "");

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
const action = String(body.action || "");

if (!id) return Response.json({ error: "Falta el ID de la suscripción." }, { status: 400 });

if (action === "editar_ganancia") {
  const ganancia_neta = Number(body.ganancia_neta);

  if (!Number.isFinite(ganancia_neta) || ganancia_neta < 0) {
    return Response.json(
      { error: "Escribe una ganancia válida." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from(body.es_ganancia_renovacion === true ? "ganancias_renovaciones" : "suscripciones")
    .update({ ganancia_neta })
    .eq("id", id)
     .select(body.es_ganancia_renovacion === true ? "id,ganancia_neta,fecha_ganancia" : "id,ganancia_neta,fecha_inicio,fecha_ganancia")
    .single();

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 400 }
    );
  }

  return Response.json({
    suscripcion: data
  });
}

if (action === "marcar_reportada") {



  const { data, error } = await supabase
    .from("suscripciones")
    .update({
      reporte_vencimiento: true,
      fecha_reporte: new Date().toISOString()
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
  
  return Response.json(
    { error: error.message },
    { status: 400 }
  );
}

  return Response.json({
    suscripcion: data
  });
}

  

  const { data: current, error: currentError } = await supabase
    .from("suscripciones")
    .select("id,cliente_id,servicio_id,fecha_inicio,fecha_vencimiento,activo,reporte_vencimiento,fecha_reporte")
    .eq("id", id)
    .single();
  if (currentError || !current) return Response.json({ error: currentError?.message || "Pedido no encontrado." }, { status: 404 });

  // Una renovación crea una ganancia independiente; no modifica la ganancia original.
  let renewalProfit = null;
  if (body.es_renovacion === true) {
    const rawProfit = body.ganancia_renovacion;
    renewalProfit = Number(rawProfit);
    if (rawProfit === undefined || rawProfit === null || rawProfit === "" ||
        !Number.isFinite(renewalProfit) || renewalProfit < 0) {
      return Response.json({ error: "Indica una ganancia neta válida para la renovación (puede ser 0)." }, { status: 400 });
    }
    // Evita alterar perfiles/fechas si la migración SQL todavía no se ha aplicado.
    const { error: profitTableError } = await supabase
      .from("ganancias_renovaciones")
      .select("id", { head: true })
      .limit(1);
    if (profitTableError) {
      return Response.json({ error: "Falta ejecutar la migración MIGRACION_GANANCIAS_RENOVACIONES.sql en Supabase: " + profitTableError.message }, { status: 400 });
    }
  }

  const changes = {};

if (typeof body.activo === "boolean") {
  changes.activo = body.activo;
}

if (body.fecha_vencimiento) {
  changes.fecha_vencimiento = String(body.fecha_vencimiento);
}

if (body.fecha_inicio) {
  changes.fecha_inicio = String(body.fecha_inicio);
}


// LIMPIAR REPORTE AL RENOVAR
if (body.es_renovacion === true) {
  changes.reporte_vencimiento = false;
  changes.fecha_reporte = null;
}


// CAMBIO MANUAL DE REPORTE
if (typeof body.reporte_vencimiento === "boolean") {
  changes.reporte_vencimiento = body.reporte_vencimiento;
}



// RENOVACIÓN EN LA MISMA CUENTA: recuperar la última asignación
// incluso si fue liberada al vencer hace más de 2 días.
if (body.es_renovacion === true && body.cambiar_cuenta !== true) {
  const { data: history, error: historyError } = await supabase
    .from("inventario_asignaciones")
    .select("*")
    .eq("suscripcion_id", id);

  if (historyError) return Response.json({ error: historyError.message }, { status: 400 });

  // Los pedidos creados sin credenciales siguen renovándose normalmente.
  const assigned = (history || []).filter(a => a.inventario_id);
  const previous = assigned.find(a => a.activo === true) || assigned[assigned.length - 1];

  if (previous) {
    const accountId = previous.inventario_id;
    const requested = String(body.perfil_misma_cuenta || "mismo");
    const slot = requested === "mismo" ? Number(previous.cupo_numero) : Number(requested);
    if (!Number.isInteger(slot) || slot < 1) {
      return Response.json({ error: "El perfil/cupo seleccionado no es válido." }, { status: 400 });
    }

    const { data: account, error: accountError } = await supabase
      .from("inventario_cuentas")
      .select("id,cupos_total,estado,servicio_id")
      .eq("id", accountId).maybeSingle();
    if (accountError) return Response.json({ error: accountError.message }, { status: 400 });
    if (!account || ["fallida", "reemplazada"].includes(account.estado)) {
      return Response.json({ error: "La cuenta anterior ya no está disponible. Selecciona cambiar por otra cuenta." }, { status: 409 });
    }
    if (slot > Number(account.cupos_total || 1)) {
      return Response.json({ error: `La cuenta solo tiene ${account.cupos_total || 1} perfil(es)/cupo(s).` }, { status: 400 });
    }

    const { data: occupied, error: occupiedError } = await supabase
      .from("inventario_asignaciones")
      .select("id,suscripcion_id")
      .eq("inventario_id", accountId)
      .eq("cupo_numero", slot)
      .eq("activo", true);
    if (occupiedError) return Response.json({ error: occupiedError.message }, { status: 400 });
    if ((occupied || []).some(a => a.suscripcion_id !== id)) {
      return Response.json({ error: `El perfil/cupo ${slot} de la cuenta anterior ya está ocupado. Elige otra cuenta o un perfil libre.` }, { status: 409 });
    }

    if (!previous.activo || Number(previous.cupo_numero) !== slot) {
      const { error: restoreError } = await supabase
        .from("inventario_asignaciones")
        .update({ activo: true, cupo_numero: slot })
        .eq("id", previous.id);
      if (restoreError) return Response.json({ error: restoreError.message }, { status: 400 });
    }
    await recalcInventoryState(supabase, accountId);
  }
}

// CAMBIO DE CUENTA AL RENOVAR
if (
  body.es_renovacion === true &&
  body.cambiar_cuenta === true
) {
  const nuevoInventarioId = String(body.nuevo_inventario_id || "");
  const nuevoCupo = Number(body.nuevo_cupo);

  

  if (!nuevoInventarioId || !Number.isInteger(nuevoCupo)) {
    return Response.json(
      { error: "Cuenta nueva y perfil son obligatorios." },
      { status: 400 }
    );
  }

  // Buscar TODAS las asignaciones activas de esta suscripción
  const { data: asignacionesActivas, error: asignacionesError } =
    await supabase
      .from("inventario_asignaciones")
      .select("*")
      .eq("suscripcion_id", id)
      .eq("activo", true);

  if (asignacionesError) {
    return Response.json(
      { error: asignacionesError.message },
      { status: 400 }
    );
  }

  

  // Guardamos los inventarios anteriores para recalcularlos después
  const inventariosAnteriores = [
    ...new Set(
      (asignacionesActivas || [])
        .map((a) => a.inventario_id)
        .filter(Boolean)
    )
  ];

  // IMPORTANTE:
  // Desactivar TODAS las asignaciones activas de esta suscripción
  if ((asignacionesActivas || []).length > 0) {
    const ids = asignacionesActivas.map((a) => a.id);

    const { error: liberarError } = await supabase
      .from("inventario_asignaciones")
      .update({ activo: false })
      .in("id", ids);

    if (liberarError) {
      return Response.json(
        {
          error: `No se pudieron liberar las asignaciones anteriores: ${liberarError.message}`
        },
        { status: 400 }
      );
    }

    
  }

  // Verificar que el nuevo perfil esté libre
  const { data: ocupado, error: ocupadoError } = await supabase
    .from("inventario_asignaciones")
    .select("id")
    .eq("inventario_id", nuevoInventarioId)
    .eq("cupo_numero", nuevoCupo)
    .eq("activo", true)
    .maybeSingle();

  if (ocupadoError) {
    return Response.json(
      { error: ocupadoError.message },
      { status: 400 }
    );
  }

  if (ocupado) {
    return Response.json(
      {
        error: `El perfil ${nuevoCupo} ya está ocupado.`
      },
      { status: 409 }
    );
  }

  // Crear UNA SOLA nueva asignación
  const { data: nuevaAsignacion, error: asignacionError } =
    await supabase
      .from("inventario_asignaciones")
      .insert({
        inventario_id: nuevoInventarioId,
        suscripcion_id: id,
        cliente_id: current.cliente_id,
        cupo_numero: nuevoCupo,
        activo: true,
        es_reemplazo: false,
        reemplaza_asignacion_id:
          asignacionesActivas?.[0]?.id || null,
        fecha_asignacion: new Date().toISOString()
      })
      .select("*")
      .single();

  if (asignacionError) {
    // Si falla la nueva asignación, restauramos las anteriores
    if ((asignacionesActivas || []).length > 0) {
      const ids = asignacionesActivas.map((a) => a.id);

      await supabase
        .from("inventario_asignaciones")
        .update({ activo: true })
        .in("id", ids);
    }

    return Response.json(
      { error: asignacionError.message },
      { status: 400 }
    );
  }

  

  // Recalcular inventarios anteriores
  for (const inventarioId of inventariosAnteriores) {
    await recalcInventoryState(
      supabase,
      inventarioId
    );
  }

  // Recalcular inventario nuevo
  await recalcInventoryState(
    supabase,
    nuevoInventarioId
  );

  
}

// CAMBIO MANUAL DE REPORTE
if (typeof body.reporte_vencimiento === "boolean") {
  changes.reporte_vencimiento = body.reporte_vencimiento;
}

// SOLO ACTUALIZAR FECHA REPORTE SI VIENE EXPLICITAMENTE
if (Object.prototype.hasOwnProperty.call(body, "fecha_reporte")) {
  changes.fecha_reporte = body.fecha_reporte;
}

  const wantsEditableFields = Boolean(
  (body.fecha_inicio || body.servicio_id || Object.prototype.hasOwnProperty.call(body, "cupo_numero"))
  && !body.es_renovacion
);

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

    // La duración del PEDIDO es independiente de la duración
// de la cuenta de inventario.
//
// Si solo se está editando el cupo, servicio u otro dato,
// conservamos la fecha de vencimiento original del pedido.
// No usamos la duración de inventario para modificarla.
changes.fecha_inicio = nextStart;
changes.fecha_ganancia = nextStart;
changes.servicio_id = nextServiceId;
// Solo recalcular la fecha de vencimiento si realmente
// cambió la fecha de inicio.
if (nextStart !== current.fecha_inicio) {
  // Conservar la duración REAL que tiene actualmente el pedido.
  // NO tomar la duración del servicio ni la del inventario.

  const currentStart = String(current.fecha_inicio || "").trim();
  const currentEnd = String(current.fecha_vencimiento || "").trim();

  if (!currentStart || !currentEnd) {
    return Response.json(
      { error: "El pedido no tiene fechas suficientes para conservar su duración." },
      { status: 400 }
    );
  }

  const currentStartDate = new Date(`${currentStart}T00:00:00`);
  const currentEndDate = new Date(`${currentEnd}T00:00:00`);

  if (
    Number.isNaN(currentStartDate.getTime()) ||
    Number.isNaN(currentEndDate.getTime()) ||
    currentEndDate <= currentStartDate
  ) {
    return Response.json(
      { error: "Las fechas actuales del pedido no son válidas." },
      { status: 400 }
    );
  }

  // Primero intentamos determinar si la duración actual está expresada en meses.
  const monthDiff =
    (currentEndDate.getFullYear() - currentStartDate.getFullYear()) * 12 +
    (currentEndDate.getMonth() - currentStartDate.getMonth());

  let durationType = "dias";
  let durationQty = Math.round(
    (currentEndDate - currentStartDate) / (1000 * 60 * 60 * 24)
  );

  // Si al sumar esos meses obtenemos exactamente la fecha actual
  // de vencimiento, conservamos la duración como meses.
  if (
    monthDiff >= 1 &&
    addDurationISO(currentStart, "meses", monthDiff) === currentEnd
  ) {
    durationType = "meses";
    durationQty = monthDiff;
  }

  const recalculatedExpiry = addDurationISO(
    nextStart,
    durationType,
    durationQty
  );

  if (!recalculatedExpiry) {
    return Response.json(
      { error: "No se pudo recalcular la fecha final." },
      { status: 400 }
    );
  }

  changes.fecha_vencimiento = recalculatedExpiry;
}
    if (inventory?.etiqueta === "externa") {
      const { error: externalDateError } = await supabase.from("inventario_cuentas").update({
  fecha_carga: nextStart
}).eq("id", inventory.id);
      if (externalDateError) return Response.json({ error: externalDateError.message }, { status: 400 });
    }
  }

  if (Object.keys(changes).length === 0) {
    return Response.json({ error: "No hay cambios para guardar." }, { status: 400 });
  }



const { data: updated, error } = await supabase
  .from("suscripciones")
  .update(changes)
  .eq("id", id)
  .select("*")
  .single();



if (error) {
  
  return Response.json({ error: error.message }, { status: 400 });
}

// Guardamos una fila por renovación; jamás sobrescribimos suscripciones.ganancia_neta.
if (body.es_renovacion === true) {
  const [{ data: clientRow }, { data: serviceRow }] = await Promise.all([
    supabase.from("clientes").select("nombre").eq("id", current.cliente_id).maybeSingle(),
    supabase.from("servicios").select("nombre").eq("id", current.servicio_id).maybeSingle()
  ]);
  const { error: renewalInsertError } = await supabase
    .from("ganancias_renovaciones")
    .insert({
      suscripcion_id: id,
      cliente_id: current.cliente_id,
      servicio_id: current.servicio_id,
      cliente_nombre: clientRow?.nombre || "Cliente",
      servicio_nombre: serviceRow?.nombre || "Servicio",
      ganancia_neta: renewalProfit,
      fecha_ganancia: String(changes.fecha_inicio || new Date().toISOString().slice(0, 10))
    });
  if (renewalInsertError) {
    return Response.json({
      error: "La renovación pudo haberse aplicado, pero NO se guardó su ganancia. No repitas la renovación antes de revisar: " + renewalInsertError.message
    }, { status: 500 });
  }
}

// await syncOrderMembership(supabase, id);

return Response.json({ ok: true, updated });
}

export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return Response.json({ error: "Falta el ID de la suscripción." }, { status: 400 });

  // Guardamos primero si este pedido pertenece a JU para actualizar el respaldo
// después del proceso de eliminación renov desactivación.
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
  // Eliminación MANUAL: borra también todas las ganancias asociadas a este pedido,
  // independientemente de su antigüedad. El archivado AUTOMÁTICO por vencimiento
  // se hace en /api/admin/data y no pasa por esta ruta.
  const { error: renewalProfitDeleteError } = await supabase
    .from("ganancias_renovaciones")
    .delete()
    .eq("suscripcion_id", id);

  if (renewalProfitDeleteError) {
    return Response.json({ error: `No se eliminaron las ganancias de renovación: ${renewalProfitDeleteError.message}` }, { status: 400 });
  }

  const { error: subscriptionDeleteError } = await supabase
    .from("suscripciones")
    .delete()
    .eq("id", id);

  if (subscriptionDeleteError) {
    return Response.json({ error: `No se pudo eliminar el pedido: ${subscriptionDeleteError.message}` }, { status: 400 });
  }

  await Promise.all(inventoryIds.map((inventoryId) => recalcInventoryState(supabase, inventoryId)));
  if (googleSnapshot?.isJU) await syncOrderDelete(id);
  return Response.json({ ok: true, perfiles_liberados: (assignments || []).length });
}
