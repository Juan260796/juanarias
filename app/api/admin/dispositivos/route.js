import { requireAdmin } from "../../../../lib/supabase-server";

const fields = "id,suscripcion_id,tipo,dispositivo,identificador,notas,registrado_at,updated_at";
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const { data, error } = await auth.supabase.from("dispositivos_chatgpt").select(fields).order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ dispositivos: data || [] });
}
export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  if (!uuid(body.suscripcion_id)) return Response.json({ error: "Pedido inválido." }, { status: 400 });
  const { data: sub, error: subError } = await supabase.from("suscripciones")
    .select("id,servicio_id,fecha_vencimiento,servicios(nombre)").eq("id", body.suscripcion_id).maybeSingle();
  if (subError || !sub) return Response.json({ error: "Pedido no encontrado." }, { status: 404 });
  const name = Array.isArray(sub.servicios) ? sub.servicios[0]?.nombre : sub.servicios?.nombre;
  if (!/chat\s*gpt/i.test(String(name || ""))) return Response.json({ error: "Solo se registran dispositivos de pedidos ChatGPT." }, { status: 400 });
  const { count, error: countError } = await supabase.from("inventario_asignaciones")
    .select("id", { count: "exact", head: true }).eq("suscripcion_id", body.suscripcion_id).eq("activo", true);
  if (countError || !count) return Response.json({ error: "El pedido ya no tiene un cupo activo. No se puede registrar dispositivo." }, { status: 409 });
  const tipo = ["PC", "Celular", "Tablet", "Otro"].includes(body.tipo) ? body.tipo : "Otro";
  const dispositivo = String(body.dispositivo || "").trim().slice(0, 120);
  if (!dispositivo) return Response.json({ error: "Escribe el dispositivo registrado." }, { status: 400 });
  const item = { suscripcion_id: body.suscripcion_id, tipo, dispositivo,
    identificador: String(body.identificador || "").trim().slice(0, 160),
    notas: String(body.notas || "").trim().slice(0, 500), updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("dispositivos_chatgpt")
    .upsert(item, { onConflict: "suscripcion_id" }).select(fields).single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ dispositivo: data });
}
export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  if (!uuid(body.suscripcion_id)) return Response.json({ error: "Pedido inválido." }, { status: 400 });
  const { error } = await auth.supabase.from("dispositivos_chatgpt").delete().eq("suscripcion_id", body.suscripcion_id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
