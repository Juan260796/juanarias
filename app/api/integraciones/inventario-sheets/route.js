import { timingSafeEqual } from "node:crypto";
import { getInventorySheetsSnapshot } from "../../../../lib/inventory-sheets-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const secret = process.env.INVENTORY_SHEETS_SYNC_TOKEN || "";
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(secret);
  const valid = b.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
  if (!valid) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const data = await getInventorySheetsSnapshot();
    return Response.json(data, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (err) {
    console.error("Error al preparar control de inventario", err);
    return Response.json({ error: "No se pudo obtener el inventario" }, { status: 500 });
  }
}
