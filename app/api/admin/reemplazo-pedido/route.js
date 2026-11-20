import { requireAdmin } from "../../../../lib/supabase-server";
import { syncOrderMembership } from "../../../../lib/google-sheets-sync";

// Solo administradores. La función SQL es atómica y solo permite service_role.
export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  if (!body.asignacion_id || !body.motivo) {
    return Response.json({ error: "Selecciona la entrega y explica el motivo." }, { status: 400 });
  }
  const { data, error } = await auth.supabase.rpc("jc_reemplazar_pedido", { p: body });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  try { await syncOrderMembership(auth.supabase, data.suscripcion_id); }
  catch (e) { console.warn("Sincronización externa pendiente:", e?.message); }
  return Response.json({ ok: true, reemplazo: data });
}

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get("suscripcion_id") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const {data,error} = await auth.supabase.from("historial_reemplazos_pedido")
    .select("id,creado_en,motivo,cupo_anterior,cupo_nuevo,dias_compensacion,fecha_vencimiento_anterior,fecha_vencimiento_nueva,inventario_anterior_id,inventario_nuevo_id")
    .eq("suscripcion_id",id).order("creado_en",{ascending:false}).limit(40);
  if(error)return Response.json({error:error.message},{status:400});
  return Response.json({historial:data||[]});
}
