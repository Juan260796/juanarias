import { requireAdmin } from "../../../../lib/supabase-server";
import { syncManyOrderMemberships, syncOrderMembership } from "../../../../lib/google-sheets-sync";

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

function parseInventoryDuration(body, deliveryType) {
  const tipo = String(body.duracion_tipo || (deliveryType === "gemini" ? "meses" : "dias"));
  const cantidad = Number(body.duracion_cantidad || 1);
  const valid = deliveryType === "gemini"
    ? tipo === "meses" && Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= 12
    : ((tipo === "dias" && Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= 30) ||
      (tipo === "meses" && Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= 12));
  return valid ? { tipo, cantidad } : null;
}

function normalizeProfilePins(value, total, legacyPin = null) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (let i = 1; i <= Number(total || 1); i += 1) {
    const raw = source[String(i)] ?? source[i] ?? (i === 1 ? legacyPin : null);
    const pin = String(raw || "").trim();
    if (pin) result[String(i)] = pin;
  }
  return result;
}

function addDurationISO(dateString, tipo, cantidad) {
  const [y, m, d] = String(dateString || "").split("-").map(Number);
  if (!y || !m || !d) return dateString;
  const qty = Math.max(1, Number(cantidad) || 1);
  const date = new Date(Date.UTC(y, m - 1, d));

  // Si el servicio está definido en días, se suman exactamente esos días calendario.
  // Ej.: 31/01 + 30 días = 02/03 (año no bisiesto), 12/07 + 30 = 11/08.
  // El día de inicio no se descuenta ni se cuenta dos veces.
  if (tipo === "dias") {
    date.setUTCDate(date.getUTCDate() + qty);
  } else {
    // Meses: conservar el mismo día del mes cuando existe.
    // Ej.: 1 mes desde 12/09 -> 12/10.
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + qty);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(originalDay, last));
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function todayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function getService(supabase, servicioId) {
  const { data, error } = await supabase.from("servicios").select("id,nombre,tipo_entrega").eq("id", servicioId).single();
  if (error || !data) return { error: error?.message || "Servicio no encontrado." };
  return { data };
}

async function recalcInventoryState(supabase, inventarioId) {
  const { data: item } = await supabase.from("inventario_cuentas").select("id,cupos_total,estado").eq("id", inventarioId).single();
  if (!item || item.estado === "fallida" || item.estado === "reemplazada") return;
  const { count } = await supabase.from("inventario_asignaciones").select("id", { count: "exact", head: true }).eq("inventario_id", inventarioId).eq("activo", true);
  const estado = (count || 0) >= Number(item.cupos_total || 1) ? "agotada" : "disponible";
  await supabase.from("inventario_cuentas").update({ estado }).eq("id", inventarioId);
}

async function validateAssignment(supabase, inventarioId, suscripcionId, cupoNumero) {
  const [{ data: item, error: itemError }, { data: sub, error: subError }] = await Promise.all([
    supabase.from("inventario_cuentas").select("id,servicio_id,estado,cupos_total,duracion_tipo,duracion_cantidad").eq("id", inventarioId).single(),
    supabase.from("suscripciones").select("id,cliente_id,servicio_id,fecha_inicio,fecha_vencimiento").eq("id", suscripcionId).single()
  ]);
  if (itemError || !item) return { error: itemError?.message || "Cuenta no encontrada." };
  if (subError || !sub) return { error: subError?.message || "Pedido no encontrado." };
  if (["fallida", "reemplazada"].includes(item.estado)) return { error: "Esa cuenta no está disponible para nuevas entregas." };
  if (item.servicio_id !== sub.servicio_id) return { error: "La cuenta no corresponde al servicio del pedido." };
  const cupo = Number(cupoNumero);
  if (!Number.isInteger(cupo) || cupo < 1 || cupo > Number(item.cupos_total || 1)) return { error: `El cupo/perfil debe estar entre 1 y ${item.cupos_total}.` };
  const { data: occupied } = await supabase.from("inventario_asignaciones").select("id").eq("inventario_id", inventarioId).eq("cupo_numero", cupo).eq("activo", true).maybeSingle();
  if (occupied) return { error: `El cupo/perfil ${cupo} ya está ocupado.` };
  return { item, sub, cupo };
}

async function validateInventorySlot(supabase, inventarioId, cupoNumero) {
  const { data: item, error: itemError } = await supabase
    .from("inventario_cuentas")
    .select("id,servicio_id,estado,cupos_total,duracion_tipo,duracion_cantidad")
    .eq("id", inventarioId)
    .single();
  if (itemError || !item) return { error: itemError?.message || "Cuenta no encontrada." };
  if (["fallida", "reemplazada"].includes(item.estado)) return { error: "Esa cuenta no está disponible para nuevas entregas." };
  const cupo = Number(cupoNumero);
  if (!Number.isInteger(cupo) || cupo < 1 || cupo > Number(item.cupos_total || 1)) {
    return { error: `El cupo/perfil debe estar entre 1 y ${item.cupos_total}.` };
  }
  const { data: occupied } = await supabase
    .from("inventario_asignaciones")
    .select("id")
    .eq("inventario_id", inventarioId)
    .eq("cupo_numero", cupo)
    .eq("activo", true)
    .maybeSingle();
  if (occupied) return { error: `El cupo/perfil ${cupo} ya está ocupado.` };
  return { item, cupo };
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const servicio_id = String(body.servicio_id || "");
  const proveedor_id = String(body.proveedor_id || "");
  if (!servicio_id || !proveedor_id) return Response.json({ error: "Selecciona servicio y proveedor." }, { status: 400 });

  const serviceResult = await getService(auth.supabase, servicio_id);
  if (serviceResult.error) return Response.json({ error: serviceResult.error }, { status: 400 });
  const tipo = effectiveDeliveryType(serviceResult.data);
  if (tipo === "manual") return Response.json({ error: "Los servicios manuales no usan inventario." }, { status: 400 });

  const duration = parseInventoryDuration(body, tipo);
  if (!duration) return Response.json({ error: tipo === "gemini" ? "Gemini permite de 1 a 12 meses." : "Usa de 1 a 30 días o de 1 a 12 meses." }, { status: 400 });

  const correo = String(body.correo || "").trim() || null;
  const clave = String(body.clave || "").trim() || null;
  const pin = String(body.pin || "").trim() || null;
  const grupo = String(body.grupo || "").trim() || null;
  const notas = String(body.notas || "").trim() || null;
  const fecha_carga = String(body.fecha_carga || "").trim() || undefined;

  let cupos_total = Number(body.cupos_total || 1);
  if (tipo === "chatgpt") cupos_total = 15;
  if (tipo === "gemini") cupos_total = 4;
  if (!Number.isInteger(cupos_total) || cupos_total < 1 || cupos_total > 50) return Response.json({ error: "El número de perfiles/cupos no es válido." }, { status: 400 });
  const perfiles_pins = tipo === "estandar" ? normalizeProfilePins(body.perfiles_pins, cupos_total, pin) : {};

  if (tipo === "estandar" && !correo) return Response.json({ error: "El correo/acceso es obligatorio para una cuenta estándar." }, { status: 400 });
  if (tipo === "chatgpt" && !correo) return Response.json({ error: "El correo de ChatGPT es obligatorio." }, { status: 400 });
  if (tipo === "gemini" && !grupo) return Response.json({ error: "Escribe el correo del grupo de Gemini." }, { status: 400 });

  const effectiveLoadDate = fecha_carga || todayISO();
  const insert = {
    servicio_id,
    proveedor_id,
    correo: tipo === "gemini" ? grupo : correo,
    clave,
    pin: null,
    perfiles_pins,
    grupo: tipo === "gemini" ? grupo : null,
    perfil: null,
    etiqueta: null,
    notas,
    estado: "disponible",
    cupos_total,
    duracion_tipo: duration.tipo,
    duracion_cantidad: duration.cantidad,
    fecha_carga: effectiveLoadDate,
    fecha_vencimiento: addDurationISO(effectiveLoadDate, duration.tipo, duration.cantidad)
  };
  const { data, error } = await auth.supabase.from("inventario_cuentas").insert(insert).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ cuenta: data }, { status: 201 });
}

export async function PATCH(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const action = String(body.action || "");
  if (!id) return Response.json({ error: "Falta el ID de la cuenta." }, { status: 400 });

  if (action === "renovar_cuenta") {
    const tipo = String(body.tipo || "meses");
    const cantidad = Number(body.cantidad || 1);
    const max = tipo === "dias" ? 30 : tipo === "meses" ? 12 : 0;
    if (!max || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > max) {
      return Response.json({ error: tipo === "dias" ? "Usa entre 1 y 30 días." : "Usa entre 1 y 12 meses." }, { status: 400 });
    }

    const { data: current, error: currentError } = await auth.supabase
      .from("inventario_cuentas")
      .select("id,fecha_vencimiento,estado")
      .eq("id", id)
      .single();
    if (currentError || !current) return Response.json({ error: currentError?.message || "Cuenta no encontrada." }, { status: 404 });

    const today = todayISO();
    const base = current.fecha_vencimiento && current.fecha_vencimiento >= today ? current.fecha_vencimiento : today;
    const fecha_vencimiento = addDurationISO(base, tipo, cantidad);
    const changes = { fecha_vencimiento };
    if (current.estado === "reemplazada") changes.estado = "disponible";

    const { data, error } = await auth.supabase
      .from("inventario_cuentas")
      .update(changes)
      .eq("id", id)
      .select("*")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await recalcInventoryState(auth.supabase, id);
    return Response.json({ cuenta: data });
  }

  if (action === "asignar_nuevo_pedido") {
    const cliente_id = String(body.cliente_id || "");
    const fecha_inicio = String(body.fecha_inicio || "");
    const cupo_numero = Number(body.cupo_numero || 1);
    const correo_cliente = String(body.correo_cliente || "").trim() || null;
    const ganancia_neta = Number(body.ganancia_neta);
    const fecha_ganancia = String(body.fecha_ganancia || fecha_inicio || "").trim();
    if (!cliente_id) return Response.json({ error: "Selecciona un cliente." }, { status: 400 });
    if (!fecha_inicio) return Response.json({ error: "Selecciona la fecha de inicio." }, { status: 400 });
    if (!Number.isFinite(ganancia_neta) || ganancia_neta < 0) return Response.json({ error: "Escribe una ganancia neta válida para el pedido." }, { status: 400 });

    const validation = await validateInventorySlot(auth.supabase, id, cupo_numero);
    if (validation.error) return Response.json({ error: validation.error }, { status: 400 });

    const serviceResult = await getService(auth.supabase, validation.item.servicio_id);
    if (serviceResult.error) return Response.json({ error: serviceResult.error }, { status: 400 });
    if (effectiveDeliveryType(serviceResult.data) === "gemini" && !correo_cliente) {
      return Response.json({ error: "Para Gemini escribe el correo Gmail del cliente." }, { status: 400 });
    }

    const fecha_vencimiento = addDurationISO(
      fecha_inicio,
      validation.item.duracion_tipo || "dias",
      validation.item.duracion_cantidad || 1
    );

    const { data: subscription, error: subscriptionError } = await auth.supabase
      .from("suscripciones")
      .insert({
        cliente_id,
        servicio_id: validation.item.servicio_id,
        fecha_inicio,
        fecha_vencimiento,
        ganancia_neta,
        fecha_ganancia,
        activo: true
      })
      .select("id,cliente_id,servicio_id,fecha_inicio,fecha_vencimiento,ganancia_neta,fecha_ganancia,activo")
      .single();

    if (subscriptionError || !subscription) {
      return Response.json({ error: subscriptionError?.message || "No se pudo crear el nuevo pedido." }, { status: 400 });
    }

    const { data: assignment, error: assignmentError } = await auth.supabase
      .from("inventario_asignaciones")
      .insert({
        inventario_id: id,
        suscripcion_id: subscription.id,
        cliente_id,
        cupo_numero: validation.cupo,
        correo_cliente,
        activo: true,
        es_reemplazo: false,
        reemplaza_asignacion_id: null
      })
      .select("*")
      .single();

    if (assignmentError || !assignment) {
      await auth.supabase.from("suscripciones").delete().eq("id", subscription.id);
      return Response.json({ error: assignmentError?.message || "No se pudo asignar la cuenta." }, { status: 400 });
    }

    await recalcInventoryState(auth.supabase, id);
    await syncOrderMembership(auth.supabase, subscription.id);
    return Response.json({ suscripcion: subscription, asignacion: assignment }, { status: 201 });
  }

  if (action === "reemplazar_cuenta_completa") {
    const oldInventoryId = String(body.old_inventory_id || "");
    if (!oldInventoryId) return Response.json({ error: "Falta la cuenta que vas a reemplazar." }, { status: 400 });
    if (oldInventoryId === id) return Response.json({ error: "Selecciona una cuenta diferente para la garantía." }, { status: 400 });

    const [{ data: oldItem, error: oldItemError }, { data: newItem, error: newItemError }] = await Promise.all([
      auth.supabase.from("inventario_cuentas").select("id,servicio_id,correo,grupo,estado,cupos_total").eq("id", oldInventoryId).single(),
      auth.supabase.from("inventario_cuentas").select("id,servicio_id,correo,grupo,estado,cupos_total").eq("id", id).single()
    ]);
    if (oldItemError || !oldItem) return Response.json({ error: oldItemError?.message || "Cuenta anterior no encontrada." }, { status: 404 });
    if (newItemError || !newItem) return Response.json({ error: newItemError?.message || "Cuenta nueva no encontrada." }, { status: 404 });
    if (oldItem.servicio_id !== newItem.servicio_id) return Response.json({ error: "La cuenta de garantía debe ser del mismo servicio." }, { status: 400 });
    if (["fallida", "reemplazada"].includes(newItem.estado)) return Response.json({ error: "La cuenta nueva no está disponible para garantías." }, { status: 400 });

    const [{ data: oldAssignments, error: oldAssignmentsError }, { data: newAssignments, error: newAssignmentsError }] = await Promise.all([
      auth.supabase.from("inventario_asignaciones").select("*").eq("inventario_id", oldInventoryId).eq("activo", true).order("cupo_numero", { ascending: true }),
      auth.supabase.from("inventario_asignaciones").select("id,cupo_numero").eq("inventario_id", id).eq("activo", true)
    ]);
    if (oldAssignmentsError) return Response.json({ error: oldAssignmentsError.message }, { status: 400 });
    if (newAssignmentsError) return Response.json({ error: newAssignmentsError.message }, { status: 400 });
    if (!oldAssignments?.length) return Response.json({ error: "La cuenta anterior no tiene perfiles/cupos activos para reemplazar." }, { status: 400 });

    const used = new Set((newAssignments || []).map((assignment) => Number(assignment.cupo_numero)));
    const totalSlots = Number(newItem.cupos_total || 1);
    const requiredSlots = oldAssignments.map((assignment) => Number(assignment.cupo_numero || 1));
    const highestRequiredSlot = Math.max(...requiredSlots);
    if (highestRequiredSlot > totalSlots) {
      return Response.json({ error: `La cuenta nueva necesita al menos ${highestRequiredSlot} perfiles/cupos para conservar los mismos números de la cuenta fallida.` }, { status: 400 });
    }
    const blockedRequiredSlot = requiredSlots.find((slot) => used.has(slot));
    if (blockedRequiredSlot) {
      return Response.json({ error: `El perfil/cupo ${blockedRequiredSlot} ya está ocupado en la cuenta nueva. La garantía debe conservar el mismo número de perfil/cupo.` }, { status: 400 });
    }

    const replacementRows = oldAssignments.map((oldAssignment) => {
      const oldSlot = Number(oldAssignment.cupo_numero || 1);
      return {
        inventario_id: id,
        suscripcion_id: oldAssignment.suscripcion_id,
        cliente_id: oldAssignment.cliente_id,
        cupo_numero: oldSlot,
        correo_cliente: oldAssignment.correo_cliente || null,
        activo: true,
        es_reemplazo: true,
        reemplaza_asignacion_id: oldAssignment.id
      };
    });

    const oldIds = oldAssignments.map((assignment) => assignment.id);
    const { error: deactivateError } = await auth.supabase
      .from("inventario_asignaciones")
      .update({ activo: false })
      .in("id", oldIds);
    if (deactivateError) return Response.json({ error: deactivateError.message }, { status: 400 });

    const { data: inserted, error: insertError } = await auth.supabase
      .from("inventario_asignaciones")
      .insert(replacementRows)
      .select("*");

    if (insertError) {
      await auth.supabase.from("inventario_asignaciones").update({ activo: true }).in("id", oldIds);
      await recalcInventoryState(auth.supabase, oldInventoryId);
      return Response.json({ error: insertError.message }, { status: 400 });
    }

    await auth.supabase.from("inventario_cuentas").update({ estado: "fallida" }).eq("id", oldInventoryId);
    const failedAccess = oldItem.grupo || oldItem.correo || "cuenta anterior";
    await auth.supabase.from("inventario_cuentas").update({ etiqueta: `garantia:${failedAccess}` }).eq("id", id);
    await recalcInventoryState(auth.supabase, id);

    const replacements = (inserted || []).map((assignment) => ({
      old_assignment_id: assignment.reemplaza_asignacion_id,
      asignacion: assignment
    }));

    await syncManyOrderMemberships(auth.supabase, oldAssignments.map((assignment) => assignment.suscripcion_id));

    return Response.json({
      reemplazos: replacements,
      cuenta_garantia: newItem,
      cuenta_fallida: oldItem
    });
  }

  if (action === "asignar" || action === "reemplazar") {
    const suscripcion_id = String(body.suscripcion_id || "");
    const cupo_numero = Number(body.cupo_numero || 1);
    const correo_cliente = String(body.correo_cliente || "").trim() || null;
    if (!suscripcion_id) return Response.json({ error: "Selecciona un pedido." }, { status: 400 });

    const validation = await validateAssignment(auth.supabase, id, suscripcion_id, cupo_numero);
    if (validation.error) return Response.json({ error: validation.error }, { status: 400 });

    let oldAssignment = null;
    if (action === "asignar") {
      const { data: existing } = await auth.supabase.from("inventario_asignaciones").select("id").eq("suscripcion_id", suscripcion_id).eq("activo", true).maybeSingle();
      if (existing) return Response.json({ error: "Ese pedido ya tiene una cuenta asignada. Usa Reemplazar / garantía." }, { status: 400 });
    } else {
      const oldId = String(body.old_assignment_id || "");
      if (!oldId) return Response.json({ error: "Falta la asignación que vas a reemplazar." }, { status: 400 });
      const { data, error } = await auth.supabase.from("inventario_asignaciones").select("*").eq("id", oldId).eq("activo", true).single();
      if (error || !data) return Response.json({ error: error?.message || "La entrega anterior no está activa." }, { status: 400 });
      if (data.suscripcion_id !== suscripcion_id) return Response.json({ error: "La garantía no corresponde a ese pedido." }, { status: 400 });
      oldAssignment = data;
      await auth.supabase.from("inventario_asignaciones").update({ activo: false }).eq("id", oldId);
      await auth.supabase.from("inventario_cuentas").update({ estado: "fallida" }).eq("id", data.inventario_id);
    }

    const { data: assignment, error: insertError } = await auth.supabase
      .from("inventario_asignaciones")
      .insert({
        inventario_id: id,
        suscripcion_id,
        cliente_id: validation.sub.cliente_id,
        cupo_numero: validation.cupo,
        correo_cliente,
        activo: true,
        es_reemplazo: action === "reemplazar",
        reemplaza_asignacion_id: oldAssignment?.id || null
      })
      .select("*")
      .single();

    if (insertError) {
      if (oldAssignment) {
        await auth.supabase.from("inventario_asignaciones").update({ activo: true }).eq("id", oldAssignment.id);
        await recalcInventoryState(auth.supabase, oldAssignment.inventario_id);
      }
      return Response.json({ error: insertError.message }, { status: 400 });
    }

    if (action === "asignar" && validation.sub.fecha_inicio) {
      const fecha_vencimiento = addDurationISO(validation.sub.fecha_inicio, validation.item.duracion_tipo, validation.item.duracion_cantidad);
      await auth.supabase.from("suscripciones").update({ fecha_vencimiento }).eq("id", suscripcion_id);
    }
    await recalcInventoryState(auth.supabase, id);
    await syncOrderMembership(auth.supabase, suscripcion_id);
    return Response.json({ asignacion: assignment });
  }

  if (action === "marcar_fallida") {
    const { data, error } = await auth.supabase.from("inventario_cuentas").update({ estado: "fallida" }).eq("id", id).select("*").single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ cuenta: data });
  }

  if (action === "reactivar") {
    await auth.supabase.from("inventario_cuentas").update({ estado: "disponible" }).eq("id", id);
    await recalcInventoryState(auth.supabase, id);
    const { data } = await auth.supabase.from("inventario_cuentas").select("*").eq("id", id).single();
    return Response.json({ cuenta: data });
  }

  const { data: existing, error: existingError } = await auth.supabase.from("inventario_cuentas").select("servicio_id,fecha_carga,fecha_vencimiento,duracion_tipo,duracion_cantidad").eq("id", id).single();
  if (existingError || !existing) return Response.json({ error: existingError?.message || "Cuenta no encontrada." }, { status: 404 });
  const serviceResult = await getService(auth.supabase, String(body.servicio_id || existing.servicio_id));
  if (serviceResult.error) return Response.json({ error: serviceResult.error }, { status: 400 });
  const tipo = effectiveDeliveryType(serviceResult.data);
  const changes = {};
  for (const key of ["correo", "clave", "pin", "grupo", "notas", "fecha_carga"]) {
    if (Object.prototype.hasOwnProperty.call(body, key)) changes[key] = String(body[key] || "").trim() || null;
  }
  if (body.servicio_id) changes.servicio_id = String(body.servicio_id);
  if (body.proveedor_id) changes.proveedor_id = String(body.proveedor_id);
  if (Object.prototype.hasOwnProperty.call(body, "cupos_total")) {
    let total = Number(body.cupos_total);
    if (tipo === "chatgpt") total = 15;
    if (tipo === "gemini") total = 4;
    if (!Number.isInteger(total) || total < 1 || total > 50) return Response.json({ error: "Cantidad de cupos inválida." }, { status: 400 });
    changes.cupos_total = total;
  }
  if (Object.prototype.hasOwnProperty.call(body, "duracion_tipo") || Object.prototype.hasOwnProperty.call(body, "duracion_cantidad")) {
    const duration = parseInventoryDuration(body, tipo);
    if (!duration) return Response.json({ error: "Duración inválida." }, { status: 400 });
    changes.duracion_tipo = duration.tipo;
    changes.duracion_cantidad = duration.cantidad;
  }
  if (Object.prototype.hasOwnProperty.call(body, "fecha_carga") || Object.prototype.hasOwnProperty.call(body, "duracion_tipo") || Object.prototype.hasOwnProperty.call(body, "duracion_cantidad")) {
    const loadDate = Object.prototype.hasOwnProperty.call(body, "fecha_carga") ? (String(body.fecha_carga || "").trim() || existing.fecha_carga || todayISO()) : (existing.fecha_carga || todayISO());
    const durationType = changes.duracion_tipo || existing.duracion_tipo || "dias";
    const durationQty = changes.duracion_cantidad || existing.duracion_cantidad || 1;
    changes.fecha_carga = loadDate;
    changes.fecha_vencimiento = addDurationISO(loadDate, durationType, durationQty);
  }
  if (Object.prototype.hasOwnProperty.call(body, "perfiles_pins")) {
    const total = Number(changes.cupos_total || body.cupos_total || 1);
    changes.perfiles_pins = tipo === "estandar" ? normalizeProfilePins(body.perfiles_pins, total, body.pin) : {};
    changes.pin = null;
  }
  const { data, error } = await auth.supabase.from("inventario_cuentas").update(changes).eq("id", id).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  await recalcInventoryState(auth.supabase, id);

  // Si cambia el proveedor o el acceso de una cuenta, actualizamos todos los
  // pedidos ligados a ella en el respaldo. Si deja de ser JU, quedan marcados
  // como eliminados en la hoja para no mostrar datos desactualizados.
  const { data: linkedAssignments } = await auth.supabase
    .from("inventario_asignaciones")
    .select("suscripcion_id")
    .eq("inventario_id", id);
  await syncManyOrderMemberships(auth.supabase, (linkedAssignments || []).map((item) => item.suscripcion_id));

  return Response.json({ cuenta: data });
}

export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return Response.json({ error: "Falta el ID de la cuenta." }, { status: 400 });
  const { count } = await auth.supabase.from("inventario_asignaciones").select("id", { count: "exact", head: true }).eq("inventario_id", id).eq("activo", true);
  if ((count || 0) > 0) return Response.json({ error: "Esta cuenta tiene clientes activos. Reemplázalos primero antes de borrarla." }, { status: 400 });
  const { error } = await auth.supabase.from("inventario_cuentas").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
