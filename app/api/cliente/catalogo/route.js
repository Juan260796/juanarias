import { createAdminSupabase } from "../../../../lib/supabase-server";

// Catálogo público: devolver solo campos comerciales, nunca datos privados.
const FIELDS = "id,titulo,descripcion,precio,duracion,orden,categoria";
const PAGE_SIZE = 200;
const HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache" };

function tienePrecio(precio) {
  const texto = String(precio ?? "").trim();
  if (!texto || /^(consultar|sin precio|pendiente|por definir|n\/?a|gratis|no disponible)$/i.test(texto)) return false;
  const numeros = texto.match(/\d+/g);
  return Boolean(numeros && numeros.some((n) => Number(n) > 0));
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const supabase = createAdminSupabase();
    const items = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("catalogo_publico")
        .select(FIELDS)
        .eq("activo", true)
        .order("orden", { ascending: true })
        .order("titulo", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const batch = data || [];
      items.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    const published = items.filter((item) => tienePrecio(item.precio));
    return Response.json({ items: published, total: published.length }, { headers: HEADERS });
  } catch (error) {
    console.error("Error al consultar el catálogo público:", error?.message || error);
    return Response.json({ error: "No se pudo cargar el catálogo." }, { status: 500, headers: HEADERS });
  }
}
