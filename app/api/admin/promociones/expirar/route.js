import { requireAdmin } from "../../../../../lib/supabase-server";

// Fecha colombiana, independientemente del huso horario del servidor Vercel.
function todayBogota() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const get = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { error } = await auth.supabase
    .from("promociones")
    .update({ activo: false })
    .eq("activo", true)
    .lt("fecha_fin", todayBogota());

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
