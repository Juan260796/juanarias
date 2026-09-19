import { requireAdmin } from "../../../../lib/supabase-server";

export async function PATCH(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return Response.json({ error: "Falta el ID del premio." }, { status: 400 });

  const { error } = await auth.supabase
    .from("premios_fidelidad")
    .update({ estado: "entregado", entregado_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });

  return Response.json({ ok: true });
}
