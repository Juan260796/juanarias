import { requireAdmin } from "../../../../lib/supabase-server";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseDuration(body) {
  const tipo = ["dias", "meses", "anios"].includes(String(body.duracion_tipo || "")) ? String(body.duracion_tipo) : "meses";
  const cantidad = tipo === "anios" ? 1 : Number(body.duracion_cantidad || 1);
  const valid =
    (tipo === "dias" && Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= 30) ||
    (tipo === "meses" && Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= 12) ||
    (tipo === "anios" && cantidad === 1);
  return valid ? { tipo, cantidad } : null;
}

function durationKey(tipo, cantidad) {
  const qty = Number(cantidad || 1);
  // Para evitar duplicados equivalentes:
  // 30 días = 1 mes y 12 meses = 1 año.
  if (tipo === "dias") return qty === 30 ? "M1" : `D${qty}`;
  if (tipo === "anios") return "M12";
  return `M${qty}`;
}

async function findDuplicateService(supabase, { id = "", nombre, duration }) {
  const { data, error } = await supabase
    .from("servicios")
    .select("id,nombre,duracion_tipo,duracion_cantidad");
  if (error) return { error };

  const wantedName = normalizeText(nombre);
  const wantedDuration = durationKey(duration.tipo, duration.cantidad);
  const duplicate = (data || []).find((service) =>
    service.id !== id &&
    normalizeText(service.nombre) === wantedName &&
    durationKey(service.duracion_tipo, service.duracion_cantidad) === wantedDuration
  );
  return { duplicate };
}

function duplicateMessage(nombre, duration) {
  const label = duration.tipo === "dias"
    ? `${duration.cantidad} días`
    : duration.tipo === "anios"
      ? "1 año"
      : `${duration.cantidad} ${duration.cantidad === 1 ? "mes" : "meses"}`;
  const equivalent = duration.tipo === "dias" && duration.cantidad === 30
    ? " (30 días se considera equivalente a 1 mes)"
    : duration.tipo === "meses" && duration.cantidad === 1
      ? " (1 mes se considera equivalente a 30 días)"
      : duration.tipo === "anios"
        ? " (1 año se considera equivalente a 12 meses)"
        : duration.tipo === "meses" && duration.cantidad === 12
          ? " (12 meses se considera equivalente a 1 año)"
          : "";
  return `Ya existe ${nombre} con duración de ${label}${equivalent}.`;
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const nombre = String(body.nombre || "").trim();
  const descripcion = String(body.descripcion || "").trim() || null;
  const duration = parseDuration(body);
  const tipo_entrega = ["estandar", "chatgpt", "gemini", "manual"].includes(String(body.tipo_entrega || "")) ? String(body.tipo_entrega) : "estandar";

  if (!nombre) return Response.json({ error: "El nombre del servicio es obligatorio." }, { status: 400 });
  if (!duration) return Response.json({ error: "La duración del servicio no es válida." }, { status: 400 });

  const check = await findDuplicateService(supabase, { nombre, duration });
  if (check.error) return Response.json({ error: check.error.message }, { status: 400 });
  if (check.duplicate) return Response.json({ error: duplicateMessage(nombre, duration) }, { status: 409 });

  const { data, error } = await supabase
    .from("servicios")
    .insert({
      nombre,
      descripcion,
      activo: body.activo !== false,
      duracion_tipo: duration.tipo,
      duracion_cantidad: duration.cantidad,
      tipo_entrega
    })
    .select("*")
    .single();

  if (error) {
    const friendly = /DUPLICATE_SERVICE_DURATION|duplicate|unique/i.test(error.message || "")
      ? duplicateMessage(nombre, duration)
      : error.message;
    return Response.json({ error: friendly }, { status: 400 });
  }
  return Response.json({ servicio: data }, { status: 201 });
}

export async function PATCH(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const nombre = String(body.nombre || "").trim();
  const descripcion = String(body.descripcion || "").trim() || null;
  const duration = parseDuration(body);
  const tipo_entrega = ["estandar", "chatgpt", "gemini", "manual"].includes(String(body.tipo_entrega || "")) ? String(body.tipo_entrega) : "estandar";

  if (!id || !nombre) return Response.json({ error: "ID y nombre del servicio son obligatorios." }, { status: 400 });
  if (!duration) return Response.json({ error: "La duración del servicio no es válida." }, { status: 400 });

  const check = await findDuplicateService(supabase, { id, nombre, duration });
  if (check.error) return Response.json({ error: check.error.message }, { status: 400 });
  if (check.duplicate) return Response.json({ error: duplicateMessage(nombre, duration) }, { status: 409 });

  const changes = {
    nombre,
    descripcion,
    duracion_tipo: duration.tipo,
    duracion_cantidad: duration.cantidad,
    tipo_entrega
  };
  if (typeof body.activo === "boolean") changes.activo = body.activo;

  const { data, error } = await supabase.from("servicios").update(changes).eq("id", id).select("*").single();
  if (error) {
    const friendly = /DUPLICATE_SERVICE_DURATION|duplicate|unique/i.test(error.message || "")
      ? duplicateMessage(nombre, duration)
      : error.message;
    return Response.json({ error: friendly }, { status: 400 });
  }
  return Response.json({ servicio: data });
}

export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const { supabase } = auth;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return Response.json({ error: "Falta el ID del servicio." }, { status: 400 });

  const { error: subsError } = await supabase.from("suscripciones").delete().eq("servicio_id", id);
  if (subsError) return Response.json({ error: subsError.message }, { status: 400 });

  const { error } = await supabase.from("servicios").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
