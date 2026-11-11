import { requireAdmin } from "../../../../lib/supabase-server";

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const url = String(process.env.INVENTORY_SHEETS_DOCUMENT_URL || "").trim();
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/.test(url)) {
    return Response.json({ error: "Falta configurar INVENTORY_SHEETS_DOCUMENT_URL con la dirección de la nueva hoja." }, { status: 400 });
  }
  return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
}
