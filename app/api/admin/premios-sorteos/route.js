import { requireAdmin } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function addDuration(dateString, tipo, cantidad) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  if (!year || !month || !day) return "";
  const amount = Number(cantidad);
  if (!Number.isInteger(amount) || amount < 1 || amount > 365) return "";
  if (tipo === "dias") {
    const date = new Date(Date.UTC(year, month - 1, day + amount));
    return date.toISOString().slice(0, 10);
  }
  const months = tipo === "anios" ? amount * 12 : amount;
  const index = month - 1 + months;
  const y = year + Math.floor(index / 12);
  const m = ((index % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2,"0")}-${String(Math.min(day,last)).padStart(2,"0")}`;
}

function todayColombia() {
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const item = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return `${item.year}-${item.month}-${item.day}`;
}

function serviceKey(name) {
  return String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\s*[-–—|]\s*\d+\s*(dias?|mes(?:es)?|anos?)\s*$/i," ").trim();
}

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const {supabase} = auth;
  const [{data: sorteos,error: e1}, {data: entregas,error: e2}] = await Promise.all([
    supabase.from("sorteos_diarios").select("fecha,ganadores").order("fecha",{ascending:false}).limit(120),
    supabase.from("entregas_premios_sorteo").select("fecha_sorteo,cliente_id,suscripcion_id,created_at")
  ]);
  if (e1 || e2) return Response.json({error: (e1 || e2).message + ". Ejecuta MIGRACION_ENTREGA_PREMIOS_SORTEOS.sql."},{status:400});
  const done = new Set((entregas||[]).map(item=>`${item.fecha_sorteo}:${item.cliente_id}`));
  const winners = (sorteos||[]).flatMap(s=>(s.ganadores||[]).map((g,index)=>({
    fecha_sorteo:s.fecha, cliente_id:g.cliente_id, nombre:g.nombre,
    posicion_ganador:index+1, entregado:done.has(`${s.fecha}:${g.cliente_id}`)
  })));
  return Response.json({ganadores:winners},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const {supabase} = auth;
  const body = await request.json().catch(()=>({}));
  const fecha_sorteo = String(body.fecha_sorteo || "");
  const cliente_id = String(body.cliente_id || "");
  const servicio_id = String(body.servicio_id || "");
  const fecha_inicio = String(body.fecha_inicio || "");
  const origen = String(body.origen || "");
  const inventario_id = String(body.inventario_id || "");
  const cupo_numero = Number(body.cupo_numero);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_sorteo) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha_inicio) ||
      !Number.isFinite(Date.parse(`${fecha_inicio}T12:00:00Z`)) ||
      new Date(`${fecha_inicio}T12:00:00Z`).toISOString().slice(0,10)!==fecha_inicio ||
      !cliente_id || !servicio_id || !["stock","external","order"].includes(origen)) {
    return Response.json({error:"Selecciona ganador, servicio, origen y una fecha válidos."},{status:400});
  }
  if (fecha_sorteo >= todayColombia()) return Response.json({error:"Las ventas se sortean desde el día siguiente."},{status:400});
  const [{data:sorteo,error:sorteoError},{data:cliente,error:clienteError},{data:servicio,error:servicioError}] = await Promise.all([
    supabase.from("sorteos_diarios").select("fecha,ganadores").eq("fecha",fecha_sorteo).maybeSingle(),
    supabase.from("clientes").select("id,nombre,telefono,username").eq("id",cliente_id).maybeSingle(),
    supabase.from("servicios").select("id,nombre,duracion_tipo,duracion_cantidad,tipo_entrega,activo").eq("id",servicio_id).maybeSingle()
  ]);
  if (sorteoError || !sorteo) return Response.json({error:sorteoError?.message||"El sorteo de esa fecha no está realizado."},{status:400});
  const posicion = (sorteo.ganadores||[]).findIndex(g=>String(g.cliente_id)===cliente_id);
  if (posicion<0 || !cliente || !servicio || servicio.activo===false) return Response.json({error:"El cliente debe ser uno de los dos ganadores y el servicio debe estar activo."},{status:400});
  const {data:existing,error:existingError} = await supabase.from("entregas_premios_sorteo")
    .select("id").eq("fecha_sorteo",fecha_sorteo).eq("cliente_id",cliente_id).maybeSingle();
  if (existingError) return Response.json({error:existingError.message+". Ejecuta MIGRACION_ENTREGA_PREMIOS_SORTEOS.sql."},{status:400});
  if (existing) return Response.json({error:"Este ganador ya recibió su premio para el sorteo seleccionado."},{status:409});
  const fecha_vencimiento = addDuration(fecha_inicio,servicio.duracion_tipo||"meses",Number(servicio.duracion_cantidad||1));
  if (!fecha_vencimiento) return Response.json({error:"No se pudo calcular el vencimiento del servicio."},{status:400});
  let cuenta = null;
  let externaNueva = false;
  const correo_cliente = String(body.correo_cliente||"").trim()||null;
  if (origen==="stock") {
    const {data:item,error} = await supabase.from("inventario_cuentas").select("*").eq("id",inventario_id).maybeSingle();
    if (error || !item) return Response.json({error:error?.message||"Cuenta no encontrada."},{status:400});
    if (["fallida","reemplazada","retirada"].includes(item.estado) || (item.fecha_vencimiento && item.fecha_vencimiento<=todayColombia()))
      return Response.json({error:"La cuenta del stock ya no permite nuevas asignaciones."},{status:400});
    const {data:stockService}=await supabase.from("servicios").select("nombre").eq("id",item.servicio_id).maybeSingle();
    if (serviceKey(stockService?.nombre)!==serviceKey(servicio.nombre)) return Response.json({error:"El servicio y la cuenta del stock no coinciden."},{status:400});
    if (!Number.isInteger(cupo_numero)||cupo_numero<1||cupo_numero>Number(item.cupos_total||1))
      return Response.json({error:"Selecciona un cupo válido de esa cuenta."},{status:400});
    const {data:occupied,error:occupiedError}=await supabase.from("inventario_asignaciones")
      .select("id").eq("inventario_id",inventario_id).eq("cupo_numero",cupo_numero).eq("activo",true).limit(1);
    if (occupiedError || occupied?.length) return Response.json({error:occupiedError?.message||"El cupo seleccionado ya está ocupado."},{status:409});
    if ((serviceKey(servicio.nombre).startsWith("gemini") || (serviceKey(servicio.nombre).includes("youtube") && item.grupo))&&!correo_cliente)
      return Response.json({error:"Indica el Gmail del cliente para el grupo familiar."},{status:400});
    cuenta = item;
  } else if (origen==="external") {
    const correo=String(body.correo||"").trim();
    if (!correo || !Number.isInteger(cupo_numero)||cupo_numero<1||cupo_numero>50)
      return Response.json({error:"Ingresa acceso externo y número de perfil válido."},{status:400});
    if (serviceKey(servicio.nombre).includes("youtube")&&body.grupo&&!correo_cliente)
      return Response.json({error:"Ingresa el Gmail de la invitación familiar."},{status:400});
  }
  let subscriptionId = null;
  let createdAccountId = null;
  try {
    const {data:sub,error:subError} = await supabase.from("suscripciones").insert({
      cliente_id, servicio_id, fecha_inicio, fecha_vencimiento,
      fecha_ganancia: fecha_inicio, ganancia_neta:0, activo:true,
      excluido_conteo:true, es_premio:true
    }).select("*").single();
    if (subError || !sub) throw new Error(subError?.message||"No se pudo crear la entrega del premio. Ejecuta la migración SQL.");
    subscriptionId=sub.id;
    if (origen==="external") {
      const pin=String(body.pin||"").trim();
      const correo=String(body.correo||"").trim();
      const grupo=String(body.grupo||"").trim();
      const {data:created,error:accountError}=await supabase.from("inventario_cuentas").insert({
        servicio_id,proveedor_id:body.proveedor_id||null,correo,clave:String(body.clave||"").trim()||null,
        pin:null,perfiles_pins:pin?{[String(cupo_numero)]:pin}:{},
        grupo:grupo || (serviceKey(servicio.nombre).startsWith("gemini")?correo:null),
        etiqueta:"externa",notas:"Entrega gratuita de premio de sorteo",estado:"agotada",
        cupos_total:cupo_numero,duracion_tipo:servicio.duracion_tipo,duracion_cantidad:servicio.duracion_cantidad,
        fecha_carga:fecha_inicio,fecha_vencimiento
      }).select("*").single();
      if (accountError || !created) throw new Error(accountError?.message||"No se pudieron guardar las credenciales del premio.");
      cuenta=created;createdAccountId=created.id;
    }
    let asignacion=null;
    if (cuenta) {
      const {data:assigned,error:assignmentError}=await supabase.from("inventario_asignaciones").insert({
        inventario_id:cuenta.id,suscripcion_id:subscriptionId,cliente_id,
        cupo_numero,correo_cliente,activo:true,es_reemplazo:false,reemplaza_asignacion_id:null
      }).select("*").single();
      if (assignmentError || !assigned) throw new Error(assignmentError?.message||"No se pudo reservar el cupo del premio.");
      asignacion=assigned;
    }
    const {data:record,error:recordError}=await supabase.from("entregas_premios_sorteo").insert({
      fecha_sorteo,cliente_id,servicio_id,suscripcion_id:subscriptionId,
      posicion_ganador:posicion+1,origen,fecha_entrega:fecha_inicio
    }).select("id").single();
    if (recordError || !record) throw new Error(recordError?.message||"No se pudo registrar la entrega.");
    if (origen==="stock") {
      const {count}=await supabase.from("inventario_asignaciones").select("id",{count:"exact",head:true}).eq("inventario_id",cuenta.id).eq("activo",true);
      const estado=(count||0)>=Number(cuenta.cupos_total||1)?"agotada":"disponible";
      await supabase.from("inventario_cuentas").update({estado}).eq("id",cuenta.id);
    }
    return Response.json({ok:true,cliente,servicio,suscripcion:sub,cuenta,asignacion,entrega_id:record.id},{status:201});
  } catch(error) {
    if (subscriptionId) {
      await supabase.from("inventario_asignaciones").delete().eq("suscripcion_id",subscriptionId);
      if (createdAccountId) await supabase.from("inventario_cuentas").delete().eq("id",createdAccountId);
      await supabase.from("suscripciones").delete().eq("id",subscriptionId);
    }
    return Response.json({error:error.message},{status:400});
  }
}
