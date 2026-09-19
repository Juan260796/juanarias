import { requireAdmin } from "../../../../lib/supabase-server";

function cleanInitials(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

async function providerExists(supabase, iniciales, excludeId = "") {
  const { data, error } = await supabase.from("proveedores").select("id,iniciales");
  if (error) return { error };
  return {
    exists: (data || []).some((provider) => provider.id !== excludeId && cleanInitials(provider.iniciales) === iniciales)
  };
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const iniciales = cleanInitials(body.iniciales);
  if (!iniciales) return Response.json({ error: "Escribe las iniciales del proveedor." }, { status: 400 });

  const check = await providerExists(auth.supabase, iniciales);
  if (check.error) return Response.json({ error: check.error.message }, { status: 400 });
  if (check.exists) return Response.json({ error: `El proveedor ${iniciales} ya existe.` }, { status: 409 });

  const { data, error } = await auth.supabase.from("proveedores").insert({ iniciales }).select("*").single();
  if (error) {
    const friendly = /duplicate|unique|DUPLICATE_PROVIDER/i.test(error.message || "") ? `El proveedor ${iniciales} ya existe.` : error.message;
    return Response.json({ error: friendly }, { status: 400 });
  }
  return Response.json({ proveedor: data }, { status: 201 });
}

export async function PATCH(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return Response.json({ error: "Falta el proveedor." }, { status: 400 });
  const changes = {};
  if (Object.prototype.hasOwnProperty.call(body, "iniciales")) {
    const iniciales = cleanInitials(body.iniciales);
    if (!iniciales) return Response.json({ error: "Las iniciales no son válidas." }, { status: 400 });
    const check = await providerExists(auth.supabase, iniciales, id);
    if (check.error) return Response.json({ error: check.error.message }, { status: 400 });
    if (check.exists) return Response.json({ error: `El proveedor ${iniciales} ya existe.` }, { status: 409 });
    changes.iniciales = iniciales;
  }
  if (typeof body.activo === "boolean") changes.activo = body.activo;
  const { data, error } = await auth.supabase.from("proveedores").update(changes).eq("id", id).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ proveedor: data });
}

export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return Response.json({ error: "Falta el proveedor." }, { status: 400 });
  const { count } = await auth.supabase.from("inventario_cuentas").select("id", { count: "exact", head: true }).eq("proveedor_id", id);
  if ((count || 0) > 0) {
    const { error } = await auth.supabase.from("proveedores").update({ activo: false }).eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, archived: true });
  }
  const { error } = await auth.supabase.from("proveedores").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
