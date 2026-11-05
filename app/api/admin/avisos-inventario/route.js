import { requireAdmin } from "../../../../lib/supabase-server";

// Marca el aviso por entrega y fecha de vencimiento. Si se renueva, una fecha
// de vencimiento nueva dará lugar a un aviso nuevo cuando vuelva a vencer.
export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const { data, error } = await auth.supabase.from("avisos_inventario_gestionados")
    .select("asignacion_id,fecha_vencimiento")
    .order("gestionado_at", { ascending: false })
    .limit(5000);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ gestionados: (data || []).map((row) => `${row.asignacion_id}:${row.fecha_vencimiento}`) });
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const asignacion_id = String(body.asignacion_id || "");
  const suscripcion_id = String(body.suscripcion_id || "");
  const fecha_vencimiento = String(body.fecha_vencimiento || "");
  if (!/^[0-9a-f-]{36}$/i.test(asignacion_id) || !/^[0-9a-f-]{36}$/i.test(suscripcion_id) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha_vencimiento)) {
    return Response.json({ error: "Aviso inválido." }, { status: 400 });
  }
  const { data: assignment, error: readError } = await supabase.from("inventario_asignaciones")
    .select("id,suscripcion_id")
    .eq("id", asignacion_id).eq("suscripcion_id", suscripcion_id).maybeSingle();
  if (readError || !assignment) return Response.json({ error: "La entrega ya no existe." }, { status: 404 });
  const { data: subscription } = await supabase.from("suscripciones")
    .select("id,fecha_vencimiento").eq("id", suscripcion_id).maybeSingle();
  if (!subscription || subscription.fecha_vencimiento !== fecha_vencimiento) {
    return Response.json({ error: "La fecha del pedido cambió. Actualiza la lista antes de marcar el aviso." }, { status: 409 });
  }
  const { error } = await supabase.from("avisos_inventario_gestionados").upsert(
    { asignacion_id, suscripcion_id, fecha_vencimiento, gestionado_at: new Date().toISOString() },
    { onConflict: "asignacion_id,fecha_vencimiento" }
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
