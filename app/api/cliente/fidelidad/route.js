import { createAdminSupabase } from "../../../../lib/supabase-server";

function getToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export async function GET(request) {
  const token = getToken(request);
  if (!token) return Response.json({ error: "No autorizado" }, { status: 401 });

  const supabase = createAdminSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });

  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (clienteError || !cliente) return Response.json({ error: "Cliente no encontrado" }, { status: 403 });

  const { count, error: countError } = await supabase
    .from("suscripciones")
    .select("id", { count: "exact", head: true })
    .eq("cliente_id", cliente.id);
  if (countError) return Response.json({ error: countError.message }, { status: 400 });

  const total = Number(count || 0);
  const earned = Math.floor(total / 10);

  const { data: existing, error: rewardsError } = await supabase
    .from("premios_fidelidad")
    .select("id,ciclo_numero,estado,entregado_at")
    .eq("cliente_id", cliente.id);
  if (rewardsError) return Response.json({ error: rewardsError.message }, { status: 400 });

  const cycles = new Set((existing || []).map((item) => Number(item.ciclo_numero)));
  const missing = [];
  for (let cycle = 1; cycle <= earned; cycle += 1) {
    if (!cycles.has(cycle)) missing.push({ cliente_id: cliente.id, ciclo_numero: cycle, estado: "pendiente" });
  }
  if (missing.length) {
    const { error } = await supabase.from("premios_fidelidad").upsert(missing, { onConflict: "cliente_id,ciclo_numero", ignoreDuplicates: true });
    if (error) return Response.json({ error: error.message }, { status: 400 });
  }

  const { data: rewards, error: finalError } = await supabase
    .from("premios_fidelidad")
    .select("id,ciclo_numero,estado,entregado_at")
    .eq("cliente_id", cliente.id);
  if (finalError) return Response.json({ error: finalError.message }, { status: 400 });

  const pending = (rewards || []).filter((item) => item.estado === "pendiente").length;
  const cycleCount = total % 10;

  return Response.json({
    total_services: total,
    cycle_count: cycleCount,
    pending_rewards: pending,
    just_won: total > 0 && cycleCount === 0
  });
}
