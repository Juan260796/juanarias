import { requireAdmin } from "../../../../lib/supabase-server";

function clean(body) {
  const titulo = String(body.titulo || "").trim();
  const descripcion = String(body.descripcion || "").trim() || null;
  const precio = String(body.precio || "").trim() || null;
  const fecha_inicio = String(body.fecha_inicio || "");
  const fecha_fin = String(body.fecha_fin || "");
  const activo = body.activo !== false;
  return { titulo, descripcion, precio, fecha_inicio, fecha_fin, activo };
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = clean(await request.json().catch(() => ({})));
  if (!body.titulo || !body.fecha_inicio || !body.fecha_fin) {
    return Response.json({ error: "Título y fechas son obligatorios." }, { status: 400 });
  }
  if (body.fecha_fin < body.fecha_inicio) {
    return Response.json({ error: "La fecha final no puede ser anterior a la fecha inicial." }, { status: 400 });
  }
  const { data, error } = await auth.supabase.from("promociones").insert(body).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ promocion: data }, { status: 201 });
}

export async function PATCH(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const raw = await request.json().catch(() => ({}));
  const id = String(raw.id || "");
  const body = clean(raw);
  if (!id || !body.titulo || !body.fecha_inicio || !body.fecha_fin) {
    return Response.json({ error: "ID, título y fechas son obligatorios." }, { status: 400 });
  }
  const { data, error } = await auth.supabase.from("promociones").update(body).eq("id", id).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ promocion: data });
}

export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return Response.json({ error: "Falta el ID de la promoción." }, { status: 400 });
  const { error } = await auth.supabase.from("promociones").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
