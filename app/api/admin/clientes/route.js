import { requireAdmin } from "../../../../lib/supabase-server";
import { validUsername, usernameToEmail } from "../../../../lib/username";
import { getOrderSyncSnapshot, syncClientDelete, syncClientUpsert, syncOrderDelete } from "../../../../lib/google-sheets-sync";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("57")) digits = digits.slice(2);
  if (digits.length === 14 && digits.startsWith("0057")) digits = digits.slice(4);
  return digits;
}

async function findClientConflict(supabase, { id = "", nombre, username, telefono }) {
  const { data, error } = await supabase
    .from("clientes")
    .select("id,nombre,username,telefono");
  if (error) return { error };

  const wantedName = normalizeText(nombre);
  const wantedUsername = normalizeText(username);
  const wantedPhone = normalizePhone(telefono);

  for (const client of data || []) {
    if (client.id === id) continue;
    if (wantedName && normalizeText(client.nombre) === wantedName) {
      return { message: "Ya existe un cliente con ese nombre." };
    }
    if (wantedUsername && normalizeText(client.username) === wantedUsername) {
      return { message: "Ese nombre de usuario ya está registrado." };
    }
    if (wantedPhone && normalizePhone(client.telefono) === wantedPhone) {
      return { message: "Ya existe un cliente con ese número de celular." };
    }
  }
  return {};
}

function duplicateClientFriendly(message = "") {
  if (/DUPLICATE_CLIENT_NAME/i.test(message)) return "Ya existe un cliente con ese nombre.";
  if (/DUPLICATE_CLIENT_PHONE/i.test(message)) return "Ya existe un cliente con ese número de celular.";
  if (/DUPLICATE_CLIENT_USERNAME/i.test(message)) return "Ese nombre de usuario ya está registrado.";
  if (/duplicate|unique/i.test(message)) return "Ya existe un cliente con alguno de esos datos.";
  return message;
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const nombre = String(body.nombre || "").trim();
  const username = String(body.username || "").trim();
  const telefono = String(body.telefono || "").trim() || null;
  const password = String(body.password || "");

  if (!nombre || !validUsername(username) || password.length < 6) {
    return Response.json({
      error: "Nombre, usuario válido y contraseña de mínimo 6 caracteres son obligatorios. El usuario puede usar letras, números, punto, guion o guion bajo."
    }, { status: 400 });
  }

  const conflict = await findClientConflict(supabase, { nombre, username, telefono });
  if (conflict.error) return Response.json({ error: conflict.error.message }, { status: 400 });
  if (conflict.message) return Response.json({ error: conflict.message }, { status: 409 });

  const email = usernameToEmail(username);

  const { data: created, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: nombre, username }
  });

  if (userError || !created.user) {
    const friendly = /already|registered|exists/i.test(userError?.message || "") ? "Ese nombre de usuario ya está registrado." : (userError?.message || "No se pudo crear el usuario.");
    return Response.json({ error: friendly }, { status: 400 });
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .insert({ nombre, username, telefono, email: null, auth_user_id: created.user.id })
    .select("id,nombre,username,telefono,created_at,auth_user_id")
    .single();

  if (clienteError) {
    await supabase.auth.admin.deleteUser(created.user.id);
    return Response.json({ error: duplicateClientFriendly(clienteError.message) }, { status: 400 });
  }

  await syncClientUpsert(cliente);
  return Response.json({ cliente }, { status: 201 });
}

export async function PATCH(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const nombre = String(body.nombre || "").trim();
  const username = String(body.username || "").trim();
  const telefono = String(body.telefono || "").trim() || null;
  const password = String(body.password || "");

  if (!id || !nombre || !validUsername(username)) {
    return Response.json({ error: "ID, nombre y usuario válido son obligatorios." }, { status: 400 });
  }
  if (password && password.length < 6) {
    return Response.json({ error: "La nueva contraseña debe tener mínimo 6 caracteres." }, { status: 400 });
  }

  const conflict = await findClientConflict(supabase, { id, nombre, username, telefono });
  if (conflict.error) return Response.json({ error: conflict.error.message }, { status: 400 });
  if (conflict.message) return Response.json({ error: conflict.message }, { status: 409 });

  const { data: existing, error: existingError } = await supabase
    .from("clientes")
    .select("id,auth_user_id,username")
    .eq("id", id)
    .single();

  if (existingError || !existing) {
    return Response.json({ error: existingError?.message || "Cliente no encontrado." }, { status: 404 });
  }

  if (existing.auth_user_id) {
    const authChanges = {
      email: usernameToEmail(username),
      email_confirm: true,
      user_metadata: { display_name: nombre, username }
    };
    if (password) authChanges.password = password;
    const { error: authError } = await supabase.auth.admin.updateUserById(existing.auth_user_id, authChanges);
    if (authError) {
      const friendly = /already|registered|exists/i.test(authError.message || "") ? "Ese nombre de usuario ya está registrado." : authError.message;
      return Response.json({ error: friendly }, { status: 400 });
    }
  }

  const { data: cliente, error } = await supabase
    .from("clientes")
    .update({ nombre, username, telefono, email: null })
    .eq("id", id)
    .select("id,nombre,username,telefono,created_at,auth_user_id")
    .single();

  if (error) return Response.json({ error: duplicateClientFriendly(error.message) }, { status: 400 });
  await syncClientUpsert(cliente);
  return Response.json({ cliente });
}

export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return Response.json({ error: "Falta el ID del cliente." }, { status: 400 });

  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .select("id,nombre,auth_user_id")
    .eq("id", id)
    .single();

  if (clienteError || !cliente) {
    return Response.json({ error: clienteError?.message || "Cliente no encontrado." }, { status: 404 });
  }

  // Antes de borrar al cliente guardamos cuáles de sus pedidos pertenecen a JU
  // para poder marcarlos como eliminados también en el respaldo de Google Sheets.
  const { data: clientSubs } = await supabase
    .from("suscripciones")
    .select("id")
    .eq("cliente_id", id);
  const orderSnapshots = await Promise.all(
    (clientSubs || []).map((item) => getOrderSyncSnapshot(supabase, item.id))
  );
  const juOrderIds = orderSnapshots.filter((item) => item?.isJU).map((item) => item.id);

  const { error: inventoryError } = await supabase
    .from("inventario_cuentas")
    .update({ estado: "disponible", cliente_id: null, suscripcion_id: null, fecha_asignacion: null })
    .eq("cliente_id", id);
  if (inventoryError) return Response.json({ error: inventoryError.message }, { status: 400 });

  const { error: subsError } = await supabase.from("suscripciones").delete().eq("cliente_id", id);
  if (subsError) return Response.json({ error: subsError.message }, { status: 400 });

  const { error: deleteError } = await supabase.from("clientes").delete().eq("id", id);
  if (deleteError) return Response.json({ error: deleteError.message }, { status: 400 });

  let warning = "";
  if (cliente.auth_user_id) {
    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(cliente.auth_user_id);
    if (authDeleteError) warning = "El cliente se borró del panel, pero no se pudo eliminar su acceso de Authentication.";
  }

  await syncClientDelete(cliente);
  await Promise.all(juOrderIds.map((orderId) => syncOrderDelete(orderId)));

  return Response.json({ ok: true, warning });
}
