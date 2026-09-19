import { requireAdmin } from "../../../../lib/supabase-server";
import {
  getOrderSyncSnapshot,
  googleSyncConfigured,
  syncClientUpsert,
  syncOrderSnapshot
} from "../../../../lib/google-sheets-sync";

async function runChunks(items, worker, size = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const chunkResults = await Promise.all(chunk.map(worker));
    results.push(...chunkResults);
  }
  return results;
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  if (!googleSyncConfigured()) {
    return Response.json({ error: "Faltan las variables de Google Sheets en Vercel." }, { status: 400 });
  }

  const { supabase } = auth;
  const [{ data: clientes, error: clientesError }, { data: subscriptions, error: subsError }] = await Promise.all([
    supabase.from("clientes").select("id,nombre,username,telefono,created_at").order("created_at", { ascending: true }),
    supabase.from("suscripciones").select("id").order("created_at", { ascending: true })
  ]);

  if (clientesError || subsError) {
    return Response.json({ error: clientesError?.message || subsError?.message || "No se pudo leer la información." }, { status: 500 });
  }

  const clientResults = await runChunks(clientes || [], (cliente) => syncClientUpsert(cliente));

  const snapshots = await runChunks(
    subscriptions || [],
    (item) => getOrderSyncSnapshot(supabase, item.id),
    8
  );
  const juSnapshots = snapshots.filter((snapshot) => snapshot?.isJU);
  const orderResults = await runChunks(
    juSnapshots,
    (snapshot) => syncOrderSnapshot(snapshot, { deleteIfNotJU: false })
  );

  const clientErrors = clientResults.filter((result) => result && result.ok === false && !result.skipped).length;
  const orderErrors = orderResults.filter((result) => result && result.ok === false && !result.skipped).length;

  return Response.json({
    ok: clientErrors === 0 && orderErrors === 0,
    clientes_sincronizados: (clientes || []).length - clientErrors,
    pedidos_ju_sincronizados: juSnapshots.length - orderErrors,
    errores: clientErrors + orderErrors
  });
}
