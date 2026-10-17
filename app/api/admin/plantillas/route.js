import { requireAdmin } from "../../../../lib/supabase-server";

const VALID_VARIABLES = new Set([
  "cliente", "servicio", "tiempo", "correo", "clave", "perfil", "pin",
  "proveedor", "fecha_inicio", "fecha_vencimiento", "grupo", "correo_cliente"
]);

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const servicio_id = String(body.servicio_id || "").trim();
  const nombre = String(body.nombre || "Mensaje de entrega").trim().slice(0, 120);
  const contenido = String(body.contenido || "").trim();
  if (!servicio_id || !contenido || contenido.length > 12000) {
    return Response.json({ error: "Selecciona un servicio e introduce un mensaje de hasta 12.000 caracteres." }, { status: 400 });
  }
  const invalidVariables = [...contenido.matchAll(/\{([a-z_]+)\}/gi)]
    .map((m) => m[1].toLowerCase()).filter((v) => !VALID_VARIABLES.has(v));
  if (invalidVariables.length) {
    return Response.json({ error: "Variables desconocidas: " + [...new Set(invalidVariables)].join(", ") }, { status: 400 });
  }
  const { data: service, error: serviceError } = await supabase.from("servicios").select("id").eq("id", servicio_id).maybeSingle();
  if (serviceError || !service) return Response.json({ error: "Servicio no encontrado." }, { status: 404 });
  const { data, error } = await supabase.from("plantillas_mensajes")
    .upsert({ servicio_id, nombre, contenido, activo: true, updated_at: new Date().toISOString() }, { onConflict: "servicio_id" })
    .select("id,servicio_id,nombre,contenido,activo").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ plantilla: data });
}

export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const servicio_id = String(body.servicio_id || "").trim();
  if (!id && !servicio_id) return Response.json({ error: "Falta identificar la plantilla." }, { status: 400 });
  const { error } = await supabase.from("plantillas_mensajes").delete().eq(id ? "id" : "servicio_id", id || servicio_id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}

export async function PATCH(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const servicio_id = String(body.servicio_id || "").trim();
  const nombre = String(body.nombre || "Mensaje de entrega").trim().slice(0, 120);
  const contenido = String(body.contenido || "").trim();
  if (!id || !servicio_id || !contenido || contenido.length > 12000) return Response.json({error:"Datos de la plantilla incompletos."}, {status:400});
  const invalidVariables = [...contenido.matchAll(/\{([a-z_]+)\}/gi)].map((m) => m[1].toLowerCase()).filter((v) => !VALID_VARIABLES.has(v));
  if (invalidVariables.length) return Response.json({error:"Variables desconocidas: " + [...new Set(invalidVariables)].join(", ")}, {status:400});
  const {data: servicio, error: serviceError} = await supabase.from("servicios").select("id").eq("id",servicio_id).maybeSingle();
  if (serviceError || !servicio) return Response.json({error:"Servicio no encontrado."},{status:404});
  const {data,error} = await supabase.from("plantillas_mensajes").update({servicio_id,nombre,contenido,updated_at:new Date().toISOString()}).eq("id",id).select("id,servicio_id,nombre,contenido,activo").single();
  if (error) return Response.json({error:error.message},{status:400});
  return Response.json({plantilla:data});
}
