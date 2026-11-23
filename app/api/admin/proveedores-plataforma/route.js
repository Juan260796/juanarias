import { requireAdmin } from "../../../../lib/supabase-server";

// Alta de proveedor con plataforma. Se mantiene la API anterior para los
// proveedores existentes y las otras funciones que todavía la utilicen.
export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Datos inválidos." }, { status: 400 }); }

  const iniciales = String(body?.iniciales || "").trim().toUpperCase();
  const plataforma = String(body?.plataforma || "").trim();
  if (!/^[A-Z0-9]{1,8}$/.test(iniciales)) {
    return Response.json({ error: "Las iniciales deben tener de 1 a 8 letras o números." }, { status: 400 });
  }
  if (!plataforma || plataforma.length > 80) {
    return Response.json({ error: "Escribe una plataforma válida (máximo 80 caracteres)." }, { status: 400 });
  }

  const { supabase } = auth;
  const { data: exists, error: lookupError } = await supabase
    .from("proveedores").select("id").eq("iniciales", iniciales).limit(1);
  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (exists?.length) return Response.json({ error: "Ya existe un proveedor con esas iniciales." }, { status: 409 });

  const { data, error } = await supabase
    .from("proveedores")
    .insert({ iniciales, plataforma, activo: true })
    .select("id,iniciales,plataforma,activo")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ proveedor: data }, { status: 201 });
}

// Modifica únicamente los datos de identificación del proveedor, conservando
// su ID y todas las cuentas, compras y relaciones históricas.
export async function PATCH(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Datos inválidos." }, { status: 400 }); }

  const id = String(body?.id || "").trim();
  const iniciales = String(body?.iniciales || "").trim().toUpperCase();
  const plataforma = String(body?.plataforma || "").trim();
  if (!id) return Response.json({ error: "Falta seleccionar el proveedor." }, { status: 400 });
  if (!/^[A-Z0-9]{1,8}$/.test(iniciales)) {
    return Response.json({ error: "Las iniciales deben tener de 1 a 8 letras o números." }, { status: 400 });
  }
  if (!plataforma || plataforma.length > 80) {
    return Response.json({ error: "Escribe una plataforma válida (máximo 80 caracteres)." }, { status: 400 });
  }
  const { supabase } = auth;
  const { data: duplicates, error: lookupError } = await supabase
    .from("proveedores").select("id").eq("iniciales", iniciales).neq("id", id).limit(1);
  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (duplicates?.length) return Response.json({ error: "Ya existe otro proveedor con esas iniciales." }, { status: 409 });

  const { data, error } = await supabase.from("proveedores")
    .update({ iniciales, plataforma }).eq("id", id)
    .select("id,iniciales,plataforma,activo").maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "No se encontró el proveedor." }, { status: 404 });
  return Response.json({ proveedor: data });
}
