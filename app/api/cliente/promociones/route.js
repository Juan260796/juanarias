import { createAdminSupabase } from "../../../../lib/supabase-server";

function getToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export async function GET(request) {
  const token = getToken(request);
  if (!token) return Response.json({ error: "No autorizado" }, { status: 401 });

  const supabase = createAdminSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }

  // Solo usuarios vinculados como clientes reciben las promociones globales.
  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (clienteError || !cliente) {
    return Response.json({ error: "Cliente no encontrado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const requestedToday = url.searchParams.get("today");
  const today = validDate(requestedToday)
    ? requestedToday
    : new Date().toISOString().slice(0, 10);

  // Esta consulta se hace con la clave privada del servidor para que las
  // promociones activas lleguen a TODOS los clientes, independientemente
  // de políticas RLS incompletas o distintas entre instalaciones antiguas.
  const { data, error } = await supabase
    .from("promociones")
    .select("id,titulo,descripcion,precio,fecha_inicio,fecha_fin,activo,created_at")
    .eq("activo", true)
    .lte("fecha_inicio", today)
    .gte("fecha_fin", today)
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ promociones: data || [] });
}
