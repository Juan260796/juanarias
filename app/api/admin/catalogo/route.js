import { requireAdmin } from "../../../../lib/supabase-server";

const fields = "id,titulo,descripcion,precio,duracion,orden,activo,categoria,created_at";
function clean(body) {
  return {
    titulo: String(body.titulo || "").trim().slice(0, 120),
    descripcion: String(body.descripcion || "").trim().slice(0, 1500),
    precio: String(body.precio || "").trim().slice(0, 80),
    duracion: String(body.duracion || "").trim().slice(0, 80),
    orden: Number.isFinite(Number(body.orden)) ? Math.trunc(Number(body.orden)) : 0,
    activo: body.activo !== false,
    categoria: ["streaming", "ia", "educacion", "musica", "otros"].includes(body.categoria) ? body.categoria : "otros",
    updated_at: new Date().toISOString()
  };
}
export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const { data, error } = await auth.supabase.from("catalogo_publico").select(fields).order("orden").order("created_at");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: data || [] });
}
export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const item = clean(await request.json().catch(() => ({})));
  if (!item.titulo) return Response.json({ error: "Indica el nombre del producto." }, { status: 400 });
  const { data, error } = await auth.supabase.from("catalogo_publico").insert(item).select(fields).single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ item: data }, { status: 201 });
}
export async function PATCH(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ""))) return Response.json({ error: "ID inválido." }, { status: 400 });
  const item = clean(body);
  if (!item.titulo) return Response.json({ error: "Indica el nombre del producto." }, { status: 400 });
  const { data, error } = await auth.supabase.from("catalogo_publico").update(item).eq("id", body.id).select(fields).single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ item: data });
}
export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ""))) return Response.json({ error: "ID inválido." }, { status: 400 });
  const { error } = await auth.supabase.from("catalogo_publico").delete().eq("id", body.id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
