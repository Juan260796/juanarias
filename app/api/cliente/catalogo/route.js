import { createAdminSupabase } from "../../../../lib/supabase-server";

// Solo publicar productos con precio real, no valores pendientes como "Consultar".
function tienePrecio(precio) {
  const texto = String(precio ?? "").trim();
  if (!texto || /^(consultar|sin precio|pendiente|por definir|n\/?a|gratis|no disponible)$/i.test(texto)) return false;
  const numeros = texto.match(/\d+/g);
  return Boolean(numeros && numeros.some((n) => Number(n) > 0));
}

export async function GET(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return Response.json({ error: "Inicia sesión para ver el catálogo." }, { status: 401 });
  const supabase = createAdminSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth.user) return Response.json({ error: "Sesión inválida." }, { status: 401 });
  const { data: customer } = await supabase.from("clientes").select("id").eq("auth_user_id", auth.user.id).maybeSingle();
  if (!customer) return Response.json({ error: "No eres cliente del panel." }, { status: 403 });
  const { data, error } = await supabase.from("catalogo_publico")
    .select("id,titulo,descripcion,precio,duracion,orden").eq("activo", true).order("orden").order("titulo");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: (data || []).filter((item) => tienePrecio(item.precio)) });
}
