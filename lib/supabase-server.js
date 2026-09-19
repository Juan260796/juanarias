import { createClient } from "@supabase/supabase-js";

export function createAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY");
  }

  return createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export async function requireAdmin(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return { response: Response.json({ error: "No autorizado" }, { status: 401 }) };
  }

  const supabase = createAdminSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    return { response: Response.json({ error: "Sesión inválida" }, { status: 401 }) };
  }

  const { data: admin, error: adminError } = await supabase
    .from("admins")
    .select("auth_user_id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (adminError || !admin) {
    return { response: Response.json({ error: "No tienes permisos de administrador" }, { status: 403 }) };
  }

  return { supabase, user: authData.user };
}
