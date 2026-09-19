const GOOGLE_URL = process.env.GOOGLE_SHEETS_WEBAPP_URL || "";
const GOOGLE_TOKEN = process.env.GOOGLE_SHEETS_SYNC_TOKEN || "";

export function googleSyncConfigured() {
  return Boolean(GOOGLE_URL && GOOGLE_TOKEN);
}

async function postToGoogle(action, payload = {}) {
  if (!googleSyncConfigured()) {
    return { ok: false, skipped: true, reason: "Google Sheets no está configurado." };
  }

  try {
    const response = await fetch(GOOGLE_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: GOOGLE_TOKEN, action, ...payload }),
      cache: "no-store",
      redirect: "follow"
    });

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!response.ok || data?.ok === false) {
      const message = data?.error || `Google Sheets respondió ${response.status}.`;
      console.error("[JUAN CUENTAS] Error de sincronización con Google Sheets:", message);
      return { ok: false, error: message };
    }

    return { ok: true, data };
  } catch (error) {
    console.error("[JUAN CUENTAS] No se pudo sincronizar con Google Sheets:", error);
    return { ok: false, error: error?.message || String(error) };
  }
}

export async function syncClientUpsert(cliente) {
  if (!cliente?.id) return { ok: false, skipped: true };
  return postToGoogle("cliente_upsert", {
    cliente: {
      id: cliente.id,
      nombre: cliente.nombre || "",
      username: cliente.username || "",
      telefono: cliente.telefono || "",
      created_at: cliente.created_at || ""
    }
  });
}

export async function syncClientDelete(cliente) {
  if (!cliente?.id) return { ok: false, skipped: true };
  return postToGoogle("cliente_delete", { cliente: { id: cliente.id } });
}

export async function syncOrderDelete(id) {
  if (!id) return { ok: false, skipped: true };
  return postToGoogle("pedido_delete", { pedido: { id } });
}

async function latestAssignmentForSubscription(supabase, suscripcionId) {
  let { data, error } = await supabase
    .from("inventario_asignaciones")
    .select("id,inventario_id,cupo_numero,activo,fecha_asignacion")
    .eq("suscripcion_id", suscripcionId)
    .eq("activo", true)
    .order("fecha_asignacion", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data) return data;

  const fallback = await supabase
    .from("inventario_asignaciones")
    .select("id,inventario_id,cupo_numero,activo,fecha_asignacion")
    .eq("suscripcion_id", suscripcionId)
    .order("fecha_asignacion", { ascending: false })
    .limit(1)
    .maybeSingle();

  return fallback.error ? null : fallback.data;
}

export async function getOrderSyncSnapshot(supabase, suscripcionId) {
  if (!suscripcionId) return null;

  const { data: sub, error: subError } = await supabase
    .from("suscripciones")
    .select("id,created_at,cliente_id,servicio_id,fecha_inicio,fecha_vencimiento,activo")
    .eq("id", suscripcionId)
    .maybeSingle();
  if (subError || !sub) return null;

  const assignment = await latestAssignmentForSubscription(supabase, suscripcionId);
  if (!assignment?.inventario_id) {
    return { id: sub.id, isJU: false };
  }

  const { data: inventory, error: inventoryError } = await supabase
    .from("inventario_cuentas")
    .select("id,correo,grupo,proveedor_id")
    .eq("id", assignment.inventario_id)
    .maybeSingle();
  if (inventoryError || !inventory) return { id: sub.id, isJU: false };

  let providerInitials = "";
  if (inventory.proveedor_id) {
    const { data: provider } = await supabase
      .from("proveedores")
      .select("iniciales")
      .eq("id", inventory.proveedor_id)
      .maybeSingle();
    providerInitials = String(provider?.iniciales || "").trim().toUpperCase();
  }

  if (providerInitials !== "JU") {
    return { id: sub.id, isJU: false };
  }

  const [{ data: cliente }, { data: servicio }] = await Promise.all([
    supabase.from("clientes").select("id,nombre,username,telefono").eq("id", sub.cliente_id).maybeSingle(),
    supabase.from("servicios").select("id,nombre").eq("id", sub.servicio_id).maybeSingle()
  ]);

  return {
    id: sub.id,
    isJU: true,
    pedido: {
      id: sub.id,
      created_at: sub.created_at || "",
      cliente: cliente?.nombre || "",
      username: cliente?.username || "",
      telefono: cliente?.telefono || "",
      servicio: servicio?.nombre || "",
      proveedor: "JU",
      cuenta: inventory.grupo || inventory.correo || "",
      cupo: assignment.cupo_numero || "",
      fecha_inicio: sub.fecha_inicio || "",
      fecha_vencimiento: sub.fecha_vencimiento || "",
      estado: sub.activo === false ? "Finalizado" : "Activo"
    }
  };
}

export async function syncOrderSnapshot(snapshot, { deleteIfNotJU = true } = {}) {
  if (!snapshot?.id) return { ok: false, skipped: true };
  if (!snapshot.isJU) {
    return deleteIfNotJU ? syncOrderDelete(snapshot.id) : { ok: true, skipped: true };
  }
  return postToGoogle("pedido_upsert", { pedido: snapshot.pedido });
}

export async function syncOrderMembership(supabase, suscripcionId) {
  const snapshot = await getOrderSyncSnapshot(supabase, suscripcionId);
  // Si alguna vez estuvo en Pedidos JU y luego cambió a otro proveedor,
  // queda como Eliminado en la hoja en lugar de conservar datos desactualizados.
  return syncOrderSnapshot(snapshot, { deleteIfNotJU: true });
}

export async function syncManyOrderMemberships(supabase, subscriptionIds = []) {
  const ids = [...new Set(subscriptionIds.filter(Boolean))];
  const results = [];
  for (let i = 0; i < ids.length; i += 5) {
    const chunk = ids.slice(i, i + 5);
    const chunkResults = await Promise.all(chunk.map((id) => syncOrderMembership(supabase, id)));
    results.push(...chunkResults);
  }
  return results;
}
