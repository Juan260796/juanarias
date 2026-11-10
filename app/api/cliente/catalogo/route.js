import { createAdminSupabase } from "../../../../lib/supabase-server";

// Catálogo público: nunca exponer clientes, pedidos, contraseñas ni datos del inventario.
// Solo se consultan los campos comerciales de las ofertas activas con precio.
function tienePrecio(precio) {
  const texto = String(precio ?? "").trim();
  if (!texto || /^(consultar|sin precio|pendiente|por definir|n\/?a|gratis|no disponible)$/i.test(texto)) return false;
  const numeros = texto.match(/\d+/g);
  return Boolean(numeros && numeros.some((n) => Number(n) > 0));
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from("catalogo_publico")
      .select("id,titulo,descripcion,precio,duracion,orden")
      .eq("activo", true)
      .order("orden")
      .order("titulo");
    if (error) return Response.json({ error: "No se pudo cargar el catálogo." }, {status:500,headers:{"Cache-Control":"no-store"}});
    return Response.json({items:(data || []).filter((item) => tienePrecio(item.precio))}, {headers:{"Cache-Control":"no-store"}});
  } catch {
    return Response.json({ error: "No se pudo cargar el catálogo." }, {status:500,headers:{"Cache-Control":"no-store"}});
  }
}
