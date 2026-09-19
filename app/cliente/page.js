"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

function daysRemaining(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dueDay = Date.UTC(y, m - 1, d);
  const now = new Date();
  const todayDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dueDay - todayDay) / 86400000);
}

function remainingText(days) {
  if (days === null) return "Sin vencimiento";
  if (days > 1) return `Quedan ${days} días`;
  if (days === 1) return "Queda 1 día";
  if (days === 0) return "Vence hoy";
  if (days === -1) return "Venció hace 1 día";
  return `Venció hace ${Math.abs(days)} días`;
}

function durationText(tipo, cantidad) {
  const qty = Number(cantidad) || 1;
  if (tipo === "dias") return `${qty} ${qty === 1 ? "día" : "días"}`;
  if (tipo === "anios") return "1 año";
  return `${qty} ${qty === 1 ? "mes" : "meses"}`;
}

function serviceLabel(service) {
  if (!service) return "Servicio";
  return `${service.nombre || "Servicio"} · ${durationText(service.duracion_tipo || "meses", service.duracion_cantidad || 1)}`;
}

function nested(value) {
  return Array.isArray(value) ? value[0] : value;
}


async function fetchLoyaltyStatus() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token || "";
  if (!token) return { data: null, error: "Sesión no disponible" };

  try {
    const response = await fetch("/api/cliente/fidelidad", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { data: null, error: payload.error || "No pudimos cargar tu programa de fidelidad." };
    return { data: payload, error: null };
  } catch {
    return { data: null, error: "No pudimos cargar tu programa de fidelidad." };
  }
}
async function fetchGlobalPromotions(today) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token || "";
  if (!token) return { data: [], error: "Sesión no disponible" };

  try {
    const response = await fetch(`/api/cliente/promociones?today=${encodeURIComponent(today)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { data: [], error: payload.error || "No pudimos cargar las promociones." };
    return { data: payload.promociones || [], error: null };
  } catch {
    return { data: [], error: "No pudimos cargar las promociones." };
  }
}


function whatsappUrl(number, message) {
  const cleanNumber = String(number || "").replace(/\D/g, "");
  if (!cleanNumber) return "";
  const safeText = String(message || "").normalize("NFC");
  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(safeText)}`;
}

export default function Cliente() {
  const router = useRouter();
  const [cliente, setCliente] = useState(null);
  const [suscripciones, setSuscripciones] = useState([]);
  const [loyaltyCycleCount, setLoyaltyCycleCount] = useState(0);
  const [pendingRewards, setPendingRewards] = useState(0);
  const [justWonReward, setJustWonReward] = useState(false);
  const [promociones, setPromociones] = useState([]);
  const [asignaciones, setAsignaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        router.replace("/login");
        return;
      }

      const { data: adminData } = await supabase.from("admins").select("auth_user_id").eq("auth_user_id", authData.user.id).maybeSingle();
      if (adminData) {
        router.replace("/admin");
        return;
      }

      const { data: clienteData, error: clienteError } = await supabase.from("clientes").select("id,nombre,username,telefono").eq("auth_user_id", authData.user.id).single();
      if (clienteError) {
        if (mounted) {
          setError("No encontramos tu ficha de cliente. Contacta al administrador.");
          setLoading(false);
        }
        return;
      }

      const today = todayISO();
      const [subsRes, promosRes, assignmentsRes, loyaltyRes] = await Promise.all([
        supabase.from("suscripciones").select("id,fecha_inicio,fecha_vencimiento,activo,servicios(*)").eq("cliente_id", clienteData.id).order("fecha_vencimiento", { ascending: true }),
        fetchGlobalPromotions(today),
        supabase.from("inventario_asignaciones").select("id,suscripcion_id,cupo_numero,correo_cliente,es_reemplazo,inventario_cuentas(id,correo,clave,pin,perfiles_pins,grupo,notas,duracion_tipo,duracion_cantidad,servicios(id,nombre,tipo_entrega))").eq("cliente_id", clienteData.id).eq("activo", true),
        fetchLoyaltyStatus()
      ]);

      if (mounted) {
        setCliente(clienteData);
        if (subsRes.error) setError("No pudimos cargar tus servicios.");
        else {
          const allSubscriptions = subsRes.data || [];
          setSuscripciones(allSubscriptions.filter((sub) => { const days = daysRemaining(sub.fecha_vencimiento); return days === null || days > -5; }));
        }
        if (!promosRes.error) setPromociones(promosRes.data || []);
        if (!assignmentsRes.error) setAsignaciones(assignmentsRes.data || []);
        if (!loyaltyRes.error && loyaltyRes.data) {
          setLoyaltyCycleCount(Number(loyaltyRes.data.cycle_count || 0));
          setPendingRewards(Number(loyaltyRes.data.pending_rewards || 0));
          setJustWonReward(Boolean(loyaltyRes.data.just_won));
        } else {
          setLoyaltyCycleCount((subsRes.data || []).length % 10);
        }
        setLoading(false);
      }
    }

    load();
    return () => { mounted = false; };
  }, [router]);

  const today = useMemo(() => todayISO(), []);
  const assignmentBySubscription = useMemo(() => {
    const map = {};
    for (const item of asignaciones) if (item.suscripcion_id) map[item.suscripcion_id] = item;
    return map;
  }, [asignaciones]);

  const activeServicesCount = useMemo(() => suscripciones.filter((sub) => {
    const days = daysRemaining(sub.fecha_vencimiento);
    const service = nested(sub.servicios);
    return Boolean(sub.activo) && Boolean(service?.activo !== false) && (days === null || days >= 1);
  }).length, [suscripciones]);

  const loyaltyRemaining = Math.max(0, 10 - loyaltyCycleCount);
  const loyaltyProgress = Math.min(100, (loyaltyCycleCount / 10) * 100);

  async function copyValue(value) {
    try { await navigator.clipboard.writeText(value); } catch {}
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function renderAccess(assignment) {
    if (!assignment) return null;
    const account = nested(assignment.inventario_cuentas);
    if (!account) return null;
    const type = nested(account.servicios)?.tipo_entrega || "estandar";

    return (
      <details className="clientAccessBox">
        <summary>🔐 Ver credenciales {assignment.es_reemplazo ? "· Garantía" : ""}</summary>
        <div className="accessRows">
          {type === "gemini" ? (
            <>
              <div><span>CORREO DEL CLIENTE</span><strong>{assignment.correo_cliente || "—"}</strong>{assignment.correo_cliente && <button type="button" onClick={() => copyValue(assignment.correo_cliente)}>Copiar</button>}</div>
              <div><span>GRUPO</span><strong>{account.grupo || account.correo || "—"}</strong><button type="button" onClick={() => copyValue(account.grupo || account.correo || "")}>Copiar</button></div>
              <div><span>CUPO</span><strong>{assignment.cupo_numero}</strong></div>
            </>
          ) : type === "chatgpt" ? (
            <>
              <div><span>CORREO</span><strong>{account.correo}</strong><button type="button" onClick={() => copyValue(account.correo)}>Copiar</button></div>
              <div><span>CUPO</span><strong>{assignment.cupo_numero}</strong></div>
              <div><span>INGRESO</span><strong>Solicitar código</strong></div>
            </>
          ) : (
            <>
              <div><span>CORREO / ACCESO</span><strong>{account.correo}</strong><button type="button" onClick={() => copyValue(account.correo)}>Copiar</button></div>
              {account.clave && <div><span>CLAVE</span><strong>{account.clave}</strong><button type="button" onClick={() => copyValue(account.clave)}>Copiar</button></div>}
              <div><span>PERFIL</span><strong>{assignment.cupo_numero}</strong></div>
              {(() => {
                const profilePin = account.perfiles_pins?.[String(assignment.cupo_numero)] || account.pin || "";
                return profilePin ? <div><span>PIN</span><strong>{profilePin}</strong><button type="button" onClick={() => copyValue(profilePin)}>Copiar</button></div> : null;
              })()}
            </>
          )}
        </div>
        <div className="accessRules">
          {type === "chatgpt" ? (
            <>
              <b>¡IMPORTANTE!</b>
              <span>😁 Ingreso para un solo dispositivo</span>
              <span>🚫 Prohibido borrar las búsquedas</span>
              <span>🫂 La cuenta es compartida con otros usuarios</span>
              <span>🫡 Prohibido cambiar cualquier tipo de información</span>
              <span>🚨 Ingresa solo en las apps oficiales, no por navegador</span>
            </>
          ) : type === "gemini" ? (
            <>
              <b>Invitación de Gemini</b>
              <span>📩 Acepta la invitación enviada a tu Gmail.</span>
              <span>☑️ Verifica que quedes dentro del grupo familiar.</span>
            </>
          ) : (
            <>
              <b>¡IMPORTANTE!</b>
              <span>⚠ Uso apropiado</span>
              <span>❌ No cambiar nombres</span>
              <span>❌ No usarla en más de 1 dispositivo a la vez</span>
              <span>❌ Prohibido compartir la pantalla con otras personas</span>
            </>
          )}
          {account.notas && <em>{account.notas}</em>}
        </div>
      </details>
    );
  }

  if (loading) return <main className="page"><div className="card loadingCard">Cargando tus servicios...</div></main>;

  return (
    <main className="dashboard">
      <header className="topbar"><div className="clientBrand"><img className="brandLogo clientHeaderLogo" src="/logo.jpg" alt="Juan Cuentas" /><div><strong>JUAN CUENTAS</strong><span>Panel del cliente</span></div></div><button className="linkButton" onClick={logout}>Salir</button></header>
      <section className="content">
        <div className="welcome"><p>Hola 👋</p><h1>{cliente?.nombre || "Cliente"}</h1><div className="muted">Consulta tus servicios, credenciales, promociones y avance de fidelidad.</div></div>

        <section className={`loyaltyCard ${justWonReward ? "unlocked" : loyaltyCycleCount >= 7 ? "near" : ""}`}>
          <div className="loyaltyTop">
            <div className="loyaltyIcon">{justWonReward ? "🏆" : "🎁"}</div>
            <div className="grow">
              <span className="loyaltyEyebrow">PROGRAMA DE FIDELIDAD</span>
              <h2>{loyaltyCycleCount} {loyaltyCycleCount === 1 ? "servicio en este ciclo" : "servicios en este ciclo"}</h2>
              {justWonReward ? (
                <p>🎉✨🏆 <strong>¡GANADOR!</strong> Completaste 10 servicios y desbloqueaste un premio. ¡Felicitaciones! 🥳🎁 Este mensaje se mantendrá hasta que hagas tu próximo pedido.</p>
              ) : loyaltyRemaining <= 3 ? (
                <p>🔥💙 ¡Ya casi lo logras! Te {loyaltyRemaining === 1 ? "falta" : "faltan"} <strong>{loyaltyRemaining} {loyaltyRemaining === 1 ? "servicio" : "servicios"}</strong> para reclamar tu premio 🎁✨</p>
              ) : (
                <p>✨ Sigue acumulando. Al completar tu <strong>10.º servicio</strong> podrás reclamar un premio especial 🎁</p>
              )}
            </div>
            <div className="loyaltyCounter"><b>{loyaltyCycleCount}</b><span>/ 10</span></div>
          </div>
          <div className="loyaltyProgress"><span style={{ width: `${loyaltyProgress}%` }} /></div>
          <div className="loyaltyMeta"><span>✅ {activeServicesCount} activos ahora</span></div>
          {pendingRewards > 0 && <div className="loyaltyPending">🚨🎁 <strong>{pendingRewards}</strong> {pendingRewards === 1 ? "premio pendiente por reclamar" : "premios pendientes por reclamar"}</div>}
        </section>

        {promociones.length > 0 && (
          <section className="clientPromotions">
            <div className="clientSectionTitle">
              <div><span>🎉✨ OFERTAS DE HOY ✨🎁</span><h2>Promociones para ti</h2><p>🔥 Aprovecha antes de que terminen.</p></div>
              <b>{promociones.length}</b>
            </div>
            <div className="promoClientGrid">
              {promociones.map((promo, index) => {
                // URL pre-codificada: el emoji viaja como bytes UTF-8 (%F0%9F%98%8A)
                // para evitar que algunos navegadores Android lo conviertan en un carácter roto al abrir WhatsApp.
                const encodedTitle = encodeURIComponent(String(promo.titulo || "").normalize("NFC"));
                const promoWhatsapp = `https://api.whatsapp.com/send?phone=573137279240&text=Hola%2C%20me%20interesa%20la%20promoci%C3%B3n%3A%20${encodedTitle}%20%F0%9F%98%8A`;
                const icons = ["🎁", "🔥", "✨", "💙", "🎉"];
                return (
                  <article className={`promoClientCard promoTone${(index % 3) + 1}`} key={promo.id}>
                    <div className="promoSpark">{icons[index % icons.length]}</div>
                    <div className="grow"><small>OFERTA ESPECIAL</small><h3>✨ {promo.titulo}</h3>{promo.descripcion && <p>💫 {promo.descripcion}</p>}{promo.precio && <strong>🔥 {promo.precio}</strong>}</div>
                    <a href={promoWhatsapp} target="_blank" rel="noreferrer">💬 Me interesa</a>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {error && <div className="errorBox wide">{error}</div>}
        {!error && suscripciones.length === 0 && <div className="card emptyState">Aún no tienes servicios asignados.</div>}

        <div className="clientServicesHeader"><div><span>📺 MIS SERVICIOS</span><h2>Servicios y accesos</h2></div><b>{suscripciones.length}</b></div>
        <div className="grid clientServicesGrid">
          {suscripciones.map((s) => {
            const service = nested(s.servicios);
            const days = daysRemaining(s.fecha_vencimiento);
            const suspended = !s.activo || service?.activo === false;
            const expired = !suspended && days !== null && days <= 0;
            const expiring = !suspended && days !== null && days >= 1 && days <= 3;
            const status = suspended
              ? { text: "Suspendido", className: "status suspendedStatus", card: "suspended" }
              : expired
                ? { text: "Vencido", className: "status off", card: "expired" }
                : expiring
                  ? { text: "⚠ Por vencer", className: "status clientWarningStatus", card: "expiring" }
                  : { text: "Activo", className: "status ok", card: "active" };
            const dayClass = expired ? "daysLeft expiredDays" : expiring ? "daysLeft urgent" : "daysLeft";
            return (
              <article className={`service card clientServiceCard ${status.card}`} key={s.id}>
                <div className="serviceIcon">{(service?.nombre || "S")[0].toUpperCase()}</div>
                <div className="grow">
                  <h2>{serviceLabel(service)}</h2>
                  {service?.descripcion && <p>{service.descripcion}</p>}
                  <div className="clientDates"><span>📅 Inicio: <b>{formatDate(s.fecha_inicio)}</b></span><span>⏳ Vence: <b>{formatDate(s.fecha_vencimiento)}</b></span></div>
                  <p className={dayClass}>{expiring ? "⚠️ " : expired ? "🔴 " : "✅ "}{remainingText(days)}</p>
                  {expiring && <div className="expiryAlert yellow">⚠️ Tu servicio está próximo a vencer. Puedes renovarlo antes de la fecha final.</div>}
                  {expired && <div className="expiryAlert red">🔴 Este servicio está vencido. Después de 5 días sin renovación dejará de mostrarse.</div>}
                  {renderAccess(assignmentBySubscription[s.id])}
                </div>
                <span className={status.className}>{status.text}</span>
              </article>
            );
          })}
        </div>
        <a className="whatsapp clientSupportFixed" href="https://wa.me/573137279240" target="_blank" rel="noreferrer" aria-label="Soporte por WhatsApp">💬 <span>Soporte por WhatsApp</span></a>
      </section>
    </main>
  );
}
