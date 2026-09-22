"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISO(value) {
  const [y, m, d] = String(value || "").split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDuration(dateString, tipo, cantidad) {
  const [y, m, d] = String(dateString || todayISO()).split("-").map(Number);
  if (!y || !m || !d) return "";
  const qty = Math.max(1, Number(cantidad) || 1);

  // Regla de tiempo de JUAN CUENTAS:
  // - Si el servicio está definido en DÍAS, se suman exactamente esos días calendario.
  //   El día de inicio no se cuenta como un día consumido: 31/01 + 30 días = 02/03
  //   en un año no bisiesto; 12/07 + 30 días = 11/08; 12/09 + 30 días = 12/10.
  // - Si está definido en MESES, se conserva el mismo número de día cuando existe.
  //   Ej.: 09/09 + 1 mes = 09/10.
  // Usamos UTC para que la zona horaria nunca cambie el día.
  if (tipo === "dias") {
    const start = new Date(Date.UTC(y, m - 1, d));
    start.setUTCDate(start.getUTCDate() + qty);
    return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`;
  }

  if (tipo === "anios") {
    const targetYear = y + qty;
    const lastDay = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
    return `${targetYear}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
  }

  const monthIndex = (m - 1) + qty;
  const targetYear = y + Math.floor(monthIndex / 12);
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

function nextDayISO(value) {
  const date = parseISO(value);
  date.setDate(date.getDate() + 1);
  return toISO(date);
}

function formatDate(value) {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

function daysRemaining(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;

  // Comparamos solo fechas de calendario (sin horas) para evitar que
  // zonas horarias o el mediodía interno sumen un día extra.
  const dueDay = Date.UTC(y, m - 1, d);
  const now = new Date();
  const todayDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dueDay - todayDay) / 86400000);
}

function remainingText(days) {
  if (days === null) return "Sin vencimiento";
  if (days > 1) return `${days} días restantes`;
  if (days === 1) return "1 día restante";
  if (days === 0) return "Vencido hoy";
  if (days === -1) return "Vencido hace 1 día";
  return `Vencido hace ${Math.abs(days)} días`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function durationText(tipo, cantidad) {
  const qty = Number(cantidad) || 1;
  if (tipo === "dias") return `${qty} ${qty === 1 ? "día" : "días"}`;
  if (tipo === "anios") return "1 año";
  return `${qty} ${qty === 1 ? "mes" : "meses"}`;
}

function serviceDuration(service) {
  return {
    tipo: service?.duracion_tipo || "meses",
    cantidad: service?.duracion_cantidad || 1
  };
}

function serviceLabel(service) {
  const duration = serviceDuration(service);
  return `${service?.nombre || "Servicio"} · ${durationText(duration.tipo, duration.cantidad)}`;
}

function inventoryServiceLabel(service) {
  const duration = serviceDuration(service);
  return `${service?.nombre || "Servicio"} x${durationText(duration.tipo, duration.cantidad)}`;
}

function deliveryTypeLabel(type) {
  return ({ estandar: "Cuenta estándar", chatgpt: "ChatGPT", gemini: "Gemini", manual: "Manual / generado al comprar" })[type] || "Cuenta estándar";
}

function effectiveDeliveryType(service) {
  const name = normalizeText(service?.nombre || "");
  // Si el nombre empieza por Gemini o ChatGPT, el formato especial manda
  // aunque un servicio antiguo todavía figure como "estándar" en la base.
  if (name.startsWith("gemini")) return "gemini";
  if (name.startsWith("chatgpt") || name.startsWith("chat gpt")) return "chatgpt";
  return service?.tipo_entrega || "estandar";
}

function isCapcutService(service) {
  const name = normalizeText(service?.nombre || "");
  return name.includes("capcut");
}

function withPurchaseThanks(message) {
  const smile = String.fromCodePoint(0x1F601);
  return `${String(message || "").trimEnd()}\n\nGracias por tu compra y confianza ${smile}`;
}

function inventoryDurationText(item) {
  const qty = Number(item?.duracion_cantidad || 1);
  if (item?.duracion_tipo === "meses" && qty === 12) return "1 año";
  return durationText(item?.duracion_tipo || "dias", qty);
}

function providerInitials(item) {
  const provider = Array.isArray(item?.proveedores) ? item.proveedores[0] : item?.proveedores;
  return provider?.iniciales || "";
}


function NavIcon({ name }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    order: <><path {...common} d="M12 5v14M5 12h14"/><circle {...common} cx="12" cy="12" r="9"/></>,
    active: <><circle {...common} cx="12" cy="12" r="9"/><path {...common} d="m8 12 2.6 2.6L16.5 9"/></>,
    expired: <><circle {...common} cx="12" cy="12" r="9"/><path {...common} d="M12 7v5l3 2"/></>,
    profit: <><circle {...common} cx="12" cy="12" r="9"/><path {...common} d="M16 8.5c-.8-.9-2-1.5-3.5-1.5-2 0-3.5 1-3.5 2.5s1.2 2.2 3.5 2.5 3.5 1 3.5 2.5-1.5 2.5-3.8 2.5c-1.7 0-3.1-.6-4-1.7M12 5v14"/></>,
    clients: <><path {...common} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle {...common} cx="9" cy="7" r="4"/><path {...common} d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    addClient: <><path {...common} d="M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle {...common} cx="8" cy="7" r="4"/><path {...common} d="M19 8v6M16 11h6"/></>,
    stream: <><rect {...common} x="3" y="4" width="18" height="13" rx="2"/><path {...common} d="M8 21h8M12 17v4"/><path {...common} d="m10 8 5 2.5-5 2.5V8Z"/></>,
    gift: <><path {...common} d="M20 12v9H4v-9"/><path {...common} d="M2 7h20v5H2z"/><path {...common} d="M12 7v14"/><path {...common} d="M12 7H7.5a2.5 2.5 0 1 1 2.2-3.7L12 7Zm0 0h4.5a2.5 2.5 0 1 0-2.2-3.7L12 7Z"/></>,
    inventory: <><path {...common} d="M3 7h18v14H3z"/><path {...common} d="M5 3h14v4H5z"/><path {...common} d="M8 11h8"/><path {...common} d="M8 15h5"/></>,
    logout: <><path {...common} d="M10 17l5-5-5-5"/><path {...common} d="M15 12H3"/><path {...common} d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></>,
    menu: <><path {...common} d="M4 6h16M4 12h16M4 18h16"/></>
  };
  return <span className="navIcon" aria-hidden="true"><svg viewBox="0 0 24 24">{paths[name]}</svg></span>;
}

const VIEW_TITLES = {
  pedido: "Generar nuevo pedido",
  activas: "Cuentas activas",
  vencidas: "Cuentas vencidas",
  ganancias: "Ganancias",
  clientes: "Clientes",
  promociones: "Promociones diarias",
  inventario: "Inventario / Streaming",
  crearCliente: "Crear cliente",
  crearStreaming: "Crear servicio streaming"
};

const VALID_VIEWS = new Set(Object.keys(VIEW_TITLES));

function whatsappNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`;
  return digits;
}

function whatsappUrl(number, message) {
  const cleanNumber = whatsappNumber(number);
  if (!cleanNumber) return "";
  const safeText = String(message || "").normalize("NFC");
  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(safeText)}`;
}

function daysTone(days) {
  if (days === null) return "daysNeutral";
  if (days <= 0) return "daysRed";
  if (days <= 3) return "daysOrange";
  return "daysGreen";
}


function formatLongDate(value) {
  if (!value) return "";
  const date = parseISO(value);
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long" }).format(date);
}

function promotionIsToday(promo) {
  const today = todayISO();
  return promo?.activo !== false && String(promo?.fecha_inicio || "") <= today && String(promo?.fecha_fin || "") >= today;
}

export default function Admin() {
  const [serviceSearch, setServiceSearch] = useState("");
  const router = useRouter();
  const [token, setToken] = useState("");
  const [data, setData] = useState({ clientes: [], servicios: [], suscripciones: [], ganancias: [], promociones: [], premios_fidelidad: [], inventario: [], inventario_historico: [], proveedores: [], asignaciones: [], order_counts: {} });
  const filteredServices = data.servicios.filter((service) =>
  service.nombre.toLowerCase().includes(serviceSearch.toLowerCase())
);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [copyNotice, setCopyNotice] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("pedido");
  const [menuOpen, setMenuOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [showClientMatches, setShowClientMatches] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");
  const [showServiceMatches, setShowServiceMatches] = useState(false);
  const [clientListQuery, setClientListQuery] = useState("");
  const [showClientCreateInline, setShowClientCreateInline] = useState(false);
  const [clientForm, setClientForm] = useState({ nombre: "", username: "", telefono: "", password: "" });
  const [serviceForm, setServiceForm] = useState({ nombre: "", descripcion: "", duracion_tipo: "meses", duracion_cantidad: 1, tipo_entrega: "estandar" });
  const [subForm, setSubForm] = useState({ cliente_id: "", servicio_id: "", fecha_inicio: todayISO() });
  const [profitValue, setProfitValue] = useState("");
  const [profitTab, setProfitTab] = useState("diaria");
  const [editingClientId, setEditingClientId] = useState("");
  const [clientEditForm, setClientEditForm] = useState({ nombre: "", username: "", telefono: "", password: "" });
  const [editingServiceId, setEditingServiceId] = useState("");
  const [serviceEditForm, setServiceEditForm] = useState({ nombre: "", descripcion: "", activo: true, duracion_tipo: "meses", duracion_cantidad: 1, tipo_entrega: "estandar" });
  const [renewalDrafts, setRenewalDrafts] = useState({});
  const [renewMenuId, setRenewMenuId] = useState("");
  const [inventoryRenewalDrafts, setInventoryRenewalDrafts] = useState({});
  const [inventoryRenewMenuId, setInventoryRenewMenuId] = useState("");
  const [promoForm, setPromoForm] = useState({ titulo: "", descripcion: "", precio: "", fecha_inicio: todayISO(), fecha_fin: todayISO(), activo: true });
  const [promotionTab, setPromotionTab] = useState("promociones");
  const [providerForm, setProviderForm] = useState({ iniciales: "" });
  const [inventoryTab, setInventoryTab] = useState("proveedores");
  const [inventoryServiceQuery, setInventoryServiceQuery] = useState("");
  const [showInventoryServiceMatches, setShowInventoryServiceMatches] = useState(false);
  const [deliveryServiceQuery, setDeliveryServiceQuery] = useState("");
  const [showDeliveryServiceMatches, setShowDeliveryServiceMatches] = useState(false);
  const [deliveryClientQuery, setDeliveryClientQuery] = useState("");
  const [inventoryForm, setInventoryForm] = useState({ servicio_id: "", proveedor_id: "", correo: "", clave: "", pin: "", perfiles_pins: {}, grupo: "", cupos_total: "", duracion_tipo: "", duracion_cantidad: "", notas: "", fecha_carga: todayISO() });
  const [deliveryForm, setDeliveryForm] = useState({ servicio_id: "", cliente_id: "", inventario_id: "", cupo_numero: "", correo_cliente: "", fecha_inicio: todayISO() });
  const [orderSource, setOrderSource] = useState("external");
  const [externalOrderForm, setExternalOrderForm] = useState({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "" });
  const [generatedDelivery, setGeneratedDelivery] = useState(null);
  const [generatedGuarantees, setGeneratedGuarantees] = useState([]);
  const [replacementForm, setReplacementForm] = useState({ old_inventory_id: "" });
  const [replacementAccountForm, setReplacementAccountForm] = useState({ proveedor_id: "", correo: "", clave: "", pin: "", perfiles_pins: {}, grupo: "", cupos_total: "", duracion_tipo: "", duracion_cantidad: "", notas: "", fecha_carga: todayISO() });
  const [editingInventoryId, setEditingInventoryId] = useState("");
  const [inventoryEditForm, setInventoryEditForm] = useState({});
  const [editingSubscriptionId, setEditingSubscriptionId] = useState("");
  const [subscriptionEditForm, setSubscriptionEditForm] = useState({ fecha_inicio: "", servicio_id: "", cupo_numero: "" });
  const [deleteSelection, setDeleteSelection] = useState({ suscripciones: [], clientes: [], servicios: [], promociones: [], proveedores: [], inventario: [] });
  const [deleteMode, setDeleteMode] = useState({});

  const api = useCallback(async (path, options = {}, accessToken = token) => {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {})
      }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Ocurrió un error.");
    return json;
  }, [token]);

  const refresh = useCallback(async (accessToken = token) => {
    const result = await api(`/api/admin/data?today=${todayISO()}`, {}, accessToken);
    setData(result);
  }, [api, token]);

  useEffect(() => {
    const syncViewFromUrl = () => {
      const section = new URLSearchParams(window.location.search).get("section");
      if (section && VALID_VIEWS.has(section)) setView(section);
    };
    syncViewFromUrl();
    window.addEventListener("popstate", syncViewFromUrl);
    return () => window.removeEventListener("popstate", syncViewFromUrl);
  }, []);

  useEffect(() => {
    if (!copyNotice) return undefined;
    const timer = window.setTimeout(() => setCopyNotice(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copyNotice]);

  useEffect(() => {
    let active = true;
    async function start() {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        router.replace("/login");
        return;
      }

      const { data: admin } = await supabase.from("admins").select("auth_user_id").eq("auth_user_id", session.user.id).maybeSingle();
      if (!admin) {
        router.replace("/cliente");
        return;
      }

      if (!active) return;
      setToken(session.access_token);
      try {
        await refresh(session.access_token);
      } catch (e) {
        setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    start();
    return () => { active = false; };
  }, [refresh, router]);

  const enrichedSubs = useMemo(() => data.suscripciones.map((s) => {
    const cliente = Array.isArray(s.clientes) ? s.clientes[0] : s.clientes;
    const servicio = Array.isArray(s.servicios) ? s.servicios[0] : s.servicios;
    const days = daysRemaining(s.fecha_vencimiento);
    const expired = Boolean(s.fecha_vencimiento && days !== null && days < 0);
    const active = Boolean(s.activo) && Boolean(servicio?.activo !== false) && !expired;
    return { ...s, cliente, servicio, days, expired, active };
  }), [data.suscripciones]);

  const activeSubs = useMemo(() => enrichedSubs
    .filter((s) => Boolean(s.activo) && Boolean(s.servicio?.activo !== false) && s.days !== null && s.days >= 1)
    .sort((a, b) => (a.days ?? 999999) - (b.days ?? 999999)), [enrichedSubs]);

  // Solo mostramos vencimientos de hoy hasta 4 días atrás. Al cumplir 5 días
  // vencidos se archivan del panel y se libera cualquier perfil/cupo asignado.
  const expiredSubs = useMemo(() => enrichedSubs
    .filter((s) => Boolean(s.activo) && Boolean(s.servicio?.activo !== false) && s.days !== null && s.days <= 0 && s.days >= -4)
    .sort((a, b) => (b.days ?? -999999) - (a.days ?? -999999)), [enrichedSubs]);

  const stats = useMemo(() => ({
    clientes: data.clientes.length,
    activos: activeSubs.length,
    vencidos: expiredSubs.length
  }), [data.clientes.length, activeSubs.length, expiredSubs.length]);

  const selectedClient = useMemo(
    () => data.clientes.find((c) => c.id === subForm.cliente_id) || null,
    [data.clientes, subForm.cliente_id]
  );

  const selectedService = useMemo(
    () => data.servicios.find((s) => s.id === subForm.servicio_id) || null,
    [data.servicios, subForm.servicio_id]
  );

  const calculatedExpiry = useMemo(() => {
    if (!selectedService || !subForm.fecha_inicio) return "";
    const duration = serviceDuration(selectedService);
    return addDuration(subForm.fecha_inicio, duration.tipo, duration.cantidad);
  }, [selectedService, subForm.fecha_inicio]);

  const clientMatches = useMemo(() => {
    const q = normalizeText(clientQuery);
    const source = data.clientes.slice().sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
    if (!q) return source.slice(0, 8);
    return source.filter((c) => normalizeText(`${c.nombre} ${c.username || ""} ${c.telefono || ""}`).includes(q)).slice(0, 8);
  }, [clientQuery, data.clientes]);

  const serviceMatches = useMemo(() => {
    const q = normalizeText(serviceQuery);
    const source = data.servicios
      .filter((service) => service.activo)
      .slice()
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
    if (!q) return source.slice(0, 8);
    return source.filter((service) => normalizeText(`${service.nombre} ${service.descripcion || ""} ${serviceLabel(service)}`).includes(q)).slice(0, 8);
  }, [serviceQuery, data.servicios]);

  const inventoryUploadServiceMatches = useMemo(() => {
    const q = normalizeText(inventoryServiceQuery);
    const source = data.servicios
      .filter((service) => service.activo && effectiveDeliveryType(service) !== "manual")
      .slice()
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
    if (!q) return source.slice(0, 8);
    return source.filter((service) =>
      normalizeText(`${service.nombre || ""} ${inventoryServiceLabel(service)} ${service.descripcion || ""}`).includes(q)
    ).slice(0, 8);
  }, [inventoryServiceQuery, data.servicios]);

  const clientOrderCounts = useMemo(() => {
    if (data.order_counts && Object.keys(data.order_counts).length > 0) return data.order_counts;
    const counts = {};
    for (const subscription of data.suscripciones) {
      counts[subscription.cliente_id] = (counts[subscription.cliente_id] || 0) + 1;
    }
    return counts;
  }, [data.order_counts, data.suscripciones]);

  const filteredClients = useMemo(() => {
    const q = normalizeText(clientListQuery);
    if (!q) return data.clientes;
    return data.clientes.filter((c) => normalizeText(`${c.nombre} ${c.username || ""} ${c.telefono || ""}`).includes(q));
  }, [clientListQuery, data.clientes]);

  const todayPromotions = useMemo(
    () => (data.promociones || []).filter(promotionIsToday),
    [data.promociones]
  );

  const pendingLoyaltyRewards = useMemo(() =>
    (data.premios_fidelidad || []).filter((reward) => reward.estado === "pendiente")
      .slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""))),
    [data.premios_fidelidad]
  );

  const recentDeliveredRewards = useMemo(() => {
    const cutoff = Date.now() - (2 * 24 * 60 * 60 * 1000);
    return (data.premios_fidelidad || []).filter((reward) =>
      reward.estado === "entregado" && reward.entregado_at && new Date(reward.entregado_at).getTime() >= cutoff
    ).slice().sort((a, b) => String(b.entregado_at || "").localeCompare(String(a.entregado_at || "")));
  }, [data.premios_fidelidad]);

  const assignmentCountByInventory = useMemo(() => {
    const counts = {};
    for (const assignment of (data.asignaciones || [])) {
      if (assignment.activo) counts[assignment.inventario_id] = (counts[assignment.inventario_id] || 0) + 1;
    }
    return counts;
  }, [data.asignaciones]);

  const activeAssignmentBySubscription = useMemo(() => {
    const map = {};
    for (const assignment of (data.asignaciones || [])) if (assignment.activo) map[assignment.suscripcion_id] = assignment;
    return map;
  }, [data.asignaciones]);

  const availableInventory = useMemo(() => {
    const createdTime = (item) => {
      const value = Date.parse(item?.created_at || "");
      return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
    };

    return (data.inventario || [])
      .filter((item) => !["fallida", "reemplazada"].includes(item.estado) && (assignmentCountByInventory[item.id] || 0) < Number(item.cupos_total || 1))
      .slice()
      .sort((a, b) => {
        const freeA = Math.max(0, Number(a.cupos_total || 1) - (assignmentCountByInventory[a.id] || 0));
        const freeB = Math.max(0, Number(b.cupos_total || 1) - (assignmentCountByInventory[b.id] || 0));

        // Prioridad 1: usar primero las cuentas que tengan menos perfiles/cupos libres.
        // Así terminamos una cuenta antes de empezar a consumir otra.
        if (freeA !== freeB) return freeA - freeB;

        // Prioridad 2: si tienen la misma disponibilidad, va primero la cuenta
        // creada hace más tiempo (FIFO).
        const dateDiff = createdTime(a) - createdTime(b);
        if (dateDiff !== 0) return dateDiff;

        return String(a.id || "").localeCompare(String(b.id || ""));
      });
  }, [data.inventario, assignmentCountByInventory]);

  const streamingInventory = useMemo(() => {
    const createdTime = (item) => {
      const value = Date.parse(item?.created_at || "");
      return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
    };

    return (data.inventario || []).slice().sort((a, b) => {
      // Las cuentas fallidas quedan al final de la lista.
      const unavailableA = ["fallida", "reemplazada"].includes(a.estado);
      const unavailableB = ["fallida", "reemplazada"].includes(b.estado);
      if (unavailableA !== unavailableB) return unavailableA ? 1 : -1;

      const freeA = Math.max(0, Number(a.cupos_total || 1) - (assignmentCountByInventory[a.id] || 0));
      const freeB = Math.max(0, Number(b.cupos_total || 1) - (assignmentCountByInventory[b.id] || 0));
      if (freeA !== freeB) return freeA - freeB;

      const dateDiff = createdTime(a) - createdTime(b);
      if (dateDiff !== 0) return dateDiff;

      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }, [data.inventario, assignmentCountByInventory]);

  const selectedDeliveryService = useMemo(
    () => data.servicios.find((service) => service.id === deliveryForm.servicio_id) || null,
    [data.servicios, deliveryForm.servicio_id]
  );

  const selectedDeliveryClient = useMemo(
    () => data.clientes.find((client) => client.id === deliveryForm.cliente_id) || null,
    [data.clientes, deliveryForm.cliente_id]
  );

  const deliveryClientMatches = useMemo(() => {
    const q = normalizeText(deliveryClientQuery);
    const source = data.clientes
      .slice()
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
    if (!q) return source.slice(0, 8);
    return source.filter((client) =>
      normalizeText(`${client.nombre || ""} ${client.username || ""} ${client.telefono || ""}`).includes(q)
    ).slice(0, 8);
  }, [deliveryClientQuery, data.clientes]);

  const deliveryInventoryOptions = useMemo(() => {
    if (!deliveryForm.servicio_id) return [];
    return availableInventory.filter((item) => item.servicio_id === deliveryForm.servicio_id);
  }, [availableInventory, deliveryForm.servicio_id]);

  const selectedInventoryItem = useMemo(
    () => (data.inventario || []).find((item) => item.id === deliveryForm.inventario_id) || null,
    [data.inventario, deliveryForm.inventario_id]
  );

  const selectedInventoryService = useMemo(() => {
    if (!selectedInventoryItem) return null;
    return data.servicios.find((service) => service.id === selectedInventoryItem.servicio_id) || null;
  }, [selectedInventoryItem, data.servicios]);

  const inventoryByService = useMemo(() => {
    const counts = {};
    for (const item of availableInventory) counts[item.servicio_id] = (counts[item.servicio_id] || 0) + (Number(item.cupos_total || 1) - (assignmentCountByInventory[item.id] || 0));
    return counts;
  }, [availableInventory, assignmentCountByInventory]);

  const deliveryServiceMatches = useMemo(() => {
    const q = normalizeText(deliveryServiceQuery);
    const source = data.servicios
      .filter((service) => service.activo && effectiveDeliveryType(service) !== "manual" && (inventoryByService[service.id] || 0) > 0)
      .slice()
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
    if (!q) return source.slice(0, 8);
    return source.filter((service) =>
      normalizeText(`${service.nombre || ""} ${inventoryServiceLabel(service)}`).includes(q)
    ).slice(0, 8);
  }, [deliveryServiceQuery, data.servicios, inventoryByService]);

  function availableSlots(item) {
    if (!item) return [];
    const used = new Set((data.asignaciones || []).filter((a) => a.activo && a.inventario_id === item.id).map((a) => Number(a.cupo_numero)));
    return Array.from({ length: Number(item.cupos_total || 1) }, (_, index) => index + 1).filter((slot) => !used.has(slot));
  }

  async function runAction(action, successText) {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
      setMessage(successText);
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  function selectedDeleteIds(kind) {
    return deleteSelection[kind] || [];
  }

  function toggleDeleteSelection(kind, id) {
    setDeleteSelection((prev) => {
      const current = prev[kind] || [];
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      return { ...prev, [kind]: next };
    });
  }

  function toggleAllDeleteSelection(kind, ids) {
    const validIds = ids.filter(Boolean);
    setDeleteSelection((prev) => {
      const current = prev[kind] || [];
      const allSelected = validIds.length > 0 && validIds.every((id) => current.includes(id));
      return { ...prev, [kind]: allSelected ? current.filter((id) => !validIds.includes(id)) : [...new Set([...current, ...validIds])] };
    });
  }

  function clearDeleteSelection(kind) {
    setDeleteSelection((prev) => ({ ...prev, [kind]: [] }));
    setDeleteMode((prev) => ({ ...prev, [kind]: false }));
  }

  function beginDeleteSelection(kind, id) {
    setDeleteMode((prev) => ({ ...prev, [kind]: true }));
    setDeleteSelection((prev) => ({ ...prev, [kind]: id ? [id] : (prev[kind] || []) }));
    window.setTimeout(() => document.getElementById(`bulk-delete-${kind}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }

  async function bulkDelete(kind, endpoint, label) {
    const ids = selectedDeleteIds(kind);
    if (!ids.length) return;
    if (!window.confirm(`¿Estas seguro en borrar ${ids.length} elemento(s) seleccionados?`)) return;
    setWorking(true);
    setError("");
    setMessage("");
    let deleted = 0;
    const errors = [];
    try {
      for (const id of ids) {
        try {
          await api(endpoint, { method: "DELETE", body: JSON.stringify({ id }) });
          deleted += 1;
        } catch (e) {
          errors.push(e.message);
        }
      }
      await refresh();
      clearDeleteSelection(kind);
      if (deleted) setMessage(`${deleted} ${label}${deleted === 1 ? "" : "s"} eliminado(s) correctamente.`);
      if (errors.length) setError(`${errors.length} elemento(s) no pudieron borrarse. ${errors[0]}`);
    } finally {
      setWorking(false);
    }
  }

  function bulkDeleteBar(kind, visibleIds, endpoint, label) {
    const selected = selectedDeleteIds(kind);

    if (!deleteMode[kind]) return null;

    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

    return (
      <div className="bulkDeleteBar" id={`bulk-delete-${kind}`}>
        <label className="bulkSelectAll">
          <input type="checkbox" checked={allVisibleSelected} onChange={() => toggleAllDeleteSelection(kind, visibleIds)} /> Seleccionar todos
        </label>
        {selected.length > 0 && (
          <>
            <span>{selected.length} seleccionado(s)</span>
            <button type="button" className="miniButton dangerMini" disabled={working} onClick={() => bulkDelete(kind, endpoint, label)}>Borrar seleccionados</button>
          </>
        )}
        <button type="button" className="miniButton" onClick={() => clearDeleteSelection(kind)}>Cancelar selección</button>
      </div>
    );
  }

  function chooseInventoryServiceFromText(value) {
    setInventoryServiceQuery(value);
    setShowInventoryServiceMatches(true);
    if (inventoryForm.servicio_id) {
      setInventoryForm((prev) => ({
        ...prev,
        servicio_id: "",
        correo: "", clave: "", pin: "", perfiles_pins: {}, grupo: ""
      }));
    }
  }

  function selectInventoryUploadService(service) {
    const type = effectiveDeliveryType(service);
    setInventoryServiceQuery(inventoryServiceLabel(service));
    setShowInventoryServiceMatches(false);
    setInventoryForm((prev) => ({
      ...prev,
      servicio_id: service.id,
      duracion_tipo: type === "gemini" ? "meses" : "dias",
      duracion_cantidad: type === "gemini" ? 1 : 30,
      cupos_total: prev.cupos_total || 1,
      correo: "", clave: "", pin: "", perfiles_pins: {}, grupo: ""
    }));
  }

  function chooseDeliveryServiceFromText(value) {
    setDeliveryServiceQuery(value);
    setShowDeliveryServiceMatches(true);
    // No autocompletamos mientras escribe: el servicio solo queda elegido
    // cuando toca una coincidencia del listado.
    if (deliveryForm.servicio_id) {
      setDeliveryForm((prev) => ({
        ...prev,
        servicio_id: "",
        cliente_id: "",
        inventario_id: "",
        cupo_numero: "",
        correo_cliente: ""
      }));
      setDeliveryClientQuery("");
    }
  }

  function selectDeliveryService(service) {
    setDeliveryServiceQuery(inventoryServiceLabel(service));
    setShowDeliveryServiceMatches(false);
    setDeliveryForm((prev) => ({
      ...prev,
      servicio_id: service.id,
      cliente_id: "",
      inventario_id: "",
      cupo_numero: "",
      correo_cliente: ""
    }));
    setDeliveryClientQuery("");
  }

  function chooseDeliveryClientFromText(value) {
    setDeliveryClientQuery(value);
    const normalized = normalizeText(value);
    const client = data.clientes.find((item) =>
      normalizeText(item.nombre) === normalized || normalizeText(item.username) === normalized
    );
    setDeliveryForm((prev) => ({ ...prev, cliente_id: client?.id || "", correo_cliente: "" }));
    if (client) setDeliveryClientQuery(client.nombre || client.username || "");
  }

  async function createClient(e) {
    e.preventDefault();
    await runAction(async () => {
      await api("/api/admin/clientes", { method: "POST", body: JSON.stringify(clientForm) });
      await refresh(token);
      const created = (data.clientes || []).find((c) => normalizeText(c.nombre) === normalizeText(clientForm.nombre));
      if (created) {
        setSubForm((prev) => ({ ...prev, cliente_id: created.id }));
        setClientQuery(created.nombre || created.username || "");
      }
      setClientForm({ nombre: "", username: "", telefono: "", password: "" });
      setShowClientCreateInline(false);
    }, "Cliente creado correctamente.");
  }

  async function saveClientEdit(e) {
    if (e?.preventDefault) e.preventDefault();
    await runAction(async () => {
      await api("/api/admin/clientes", { method: "PATCH", body: JSON.stringify({ id: editingClientId, ...clientEditForm }) });
      setEditingClientId("");
      setClientEditForm({ nombre: "", username: "", telefono: "", password: "" });
    }, "Datos del cliente actualizados.");
  }

  function confirmDelete() {
    return window.confirm("¿Estas seguro en borrar este elemento?");
  }

  async function deleteClient(cliente) {
    if (!confirmDelete()) return;
    await runAction(
      () => api("/api/admin/clientes", { method: "DELETE", body: JSON.stringify({ id: cliente.id }) }),
      "Cliente eliminado correctamente."
    );
    if (editingClientId === cliente.id) setEditingClientId("");
  }

  async function syncGoogleBackup() {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const result = await api("/api/admin/sync-google", { method: "POST" });
      const errors = Number(result.errores || 0);
      setMessage(
        `Respaldo sincronizado: ${result.clientes_sincronizados || 0} clientes y ${result.pedidos_ju_sincronizados || 0} pedidos JU.${errors ? ` ${errors} registro(s) no pudieron sincronizarse.` : ""}`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  async function createService(e) {
    e.preventDefault();
    await runAction(async () => {
      await api("/api/admin/servicios", { method: "POST", body: JSON.stringify(serviceForm) });
      setServiceForm({ nombre: "", descripcion: "", duracion_tipo: "meses", duracion_cantidad: 1, tipo_entrega: "estandar" });
    }, "Servicio streaming creado correctamente.");
  }

  async function saveServiceEdit(e) {
    e.preventDefault();
    await runAction(async () => {
      await api("/api/admin/servicios", { method: "PATCH", body: JSON.stringify({ id: editingServiceId, ...serviceEditForm }) });
      setEditingServiceId("");
    }, "Servicio actualizado correctamente.");
  }

  async function deleteService(service) {
    if (!confirmDelete()) return;
    await runAction(
      () => api("/api/admin/servicios", { method: "DELETE", body: JSON.stringify({ id: service.id }) }),
      "Servicio eliminado correctamente."
    );
  }

  async function createPromotion(e) {
    e.preventDefault();
    await runAction(async () => {
      await api("/api/admin/promociones", { method: "POST", body: JSON.stringify(promoForm) });
      setPromoForm({ titulo: "", descripcion: "", precio: "", fecha_inicio: todayISO(), fecha_fin: todayISO(), activo: true });
    }, "Promoción guardada correctamente.");
  }

  async function togglePromotion(promo) {
    await runAction(
      () => api("/api/admin/promociones", {
        method: "PATCH",
        body: JSON.stringify({ ...promo, activo: !promo.activo })
      }),
      promo.activo ? "Promoción oculta." : "Promoción activada."
    );
  }

  async function deletePromotion(promo) {
    if (!confirmDelete()) return;
    await runAction(
      () => api("/api/admin/promociones", { method: "DELETE", body: JSON.stringify({ id: promo.id }) }),
      "Promoción eliminada."
    );
  }

  async function markRewardDelivered(reward) {
    await runAction(
      () => api("/api/admin/premios", { method: "PATCH", body: JSON.stringify({ id: reward.id, estado: "entregado" }) }),
      "Premio marcado como entregado."
    );
  }

  async function createProvider(e) {
    e.preventDefault();
    await runAction(async () => {
      await api("/api/admin/proveedores", { method: "POST", body: JSON.stringify(providerForm) });
      setProviderForm({ iniciales: "" });
    }, "Proveedor agregado.");
  }

  async function deleteProvider(provider) {
    if (!confirmDelete()) return;
    await runAction(
      () => api("/api/admin/proveedores", { method: "DELETE", body: JSON.stringify({ id: provider.id }) }),
      "Proveedor actualizado."
    );
  }

  async function createInventoryItem(e) {
    e.preventDefault();
    await runAction(async () => {
      await api("/api/admin/inventario", { method: "POST", body: JSON.stringify(inventoryForm) });
      setInventoryForm({ servicio_id: "", proveedor_id: "", correo: "", clave: "", pin: "", perfiles_pins: {}, grupo: "", cupos_total: "", duracion_tipo: "", duracion_cantidad: "", notas: "", fecha_carga: todayISO() });
      setInventoryServiceQuery("");
      setShowInventoryServiceMatches(false);
    }, "Cuenta agregada al inventario.");
  }

  async function saveInventoryEdit(e) {
    e.preventDefault();
    await runAction(async () => {
      await api("/api/admin/inventario", { method: "PATCH", body: JSON.stringify({ id: editingInventoryId, ...inventoryEditForm }) });
      setEditingInventoryId("");
      setInventoryEditForm({});
    }, "Cuenta actualizada.");
  }

  function beginInventoryEdit(item) {
    setEditingInventoryId(item.id);
    setInventoryEditForm({
      servicio_id: item.servicio_id || "", proveedor_id: item.proveedor_id || "", correo: item.correo || "", clave: item.clave || "", pin: item.pin || "", perfiles_pins: item.perfiles_pins || {}, grupo: item.grupo || "",
      cupos_total: item.cupos_total || 1, duracion_tipo: item.duracion_tipo || "dias", duracion_cantidad: item.duracion_cantidad || 30, notas: item.notas || "", fecha_carga: item.fecha_carga || todayISO()
    });
  }

  async function deleteInventoryItem(item) {
    if (!confirmDelete()) return;
    await runAction(
      () => api("/api/admin/inventario", { method: "DELETE", body: JSON.stringify({ id: item.id }) }),
      "Cuenta eliminada del inventario."
    );
  }

  async function markInventoryFailed(item) {
    if (!window.confirm("¿Marcar esta cuenta como fallida? No se usará para nuevas entregas.")) return;
    await runAction(
      () => api("/api/admin/inventario", { method: "PATCH", body: JSON.stringify({ id: item.id, action: "marcar_fallida" }) }),
      "Cuenta marcada como fallida."
    );
  }

  async function reactivateInventory(item) {
    await runAction(
      () => api("/api/admin/inventario", { method: "PATCH", body: JSON.stringify({ id: item.id, action: "reactivar" }) }),
      "Cuenta reactivada."
    );
  }

  function buildDeliveryMessage(sub, item, assignmentData = {}) {
    if (!sub || !item) return "";
    const cliente = sub.cliente?.nombre || sub.cliente?.username || "Cliente";
    const service = sub.servicio || data.servicios.find((srv) => srv.id === sub.servicio_id);
    const type = effectiveDeliveryType(service);
    const durationLabel = inventoryDurationText(item);
    const provider = providerInitials(item);
    const providerTag = provider ? ` (${provider})` : "";
    const purchaseDate = formatLongDate(type === "gemini" && !assignmentData.garantia ? (assignmentData.fecha_entrega || todayISO()) : sub.fecha_inicio);
    const cupo = assignmentData.cupo_numero || deliveryForm.cupo_numero || 1;
    const clientEmail = assignmentData.correo_cliente || deliveryForm.correo_cliente || "";

    if (isCapcutService(service)) {
      return withPurchaseThanks(`${service?.nombre || "Capcut pro"} 1 dispositivo x${durationLabel} (${purchaseDate})${providerTag}

Correo: ${item.correo || ""}
Clave: ${item.clave || ""}

${cliente}

${String.fromCodePoint(0x2705)}Ingresar en (correo electrónico)
${String.fromCodePoint(0x1F6AB)}No en gmail.com

${String.fromCodePoint(0x1F4BB)} Cómo entrar desde tu PC:
1${String.fromCodePoint(0xFE0F, 0x20E3)} Primero inicia sesión desde el celular ${String.fromCodePoint(0x1F4F2)}.
2${String.fromCodePoint(0xFE0F, 0x20E3)} Luego escanea el código QR en tu computadora ${String.fromCodePoint(0x1F4BB)}.

${String.fromCodePoint(0x26A0, 0xFE0F)} Importante:
${String.fromCodePoint(0x1F6A8)}${String.fromCodePoint(0x1F4F8)} para reportes o ver el tiempo de caducidad.
${String.fromCodePoint(0x2705)}Envíame una captura de pantalla de:
-ingresa desde celular a la apk de capcut.
-Ver perfil
-Pro
-y ahi sale la fecha fin.
-Prohibido salir del team.

${String.fromCodePoint(0x2728)} En resumen:
${String.fromCodePoint(0x1F449)} Ingresa y usa en un único dispositivo máximo`);
    }

    if (type === "chatgpt") {
      return withPurchaseThanks(`${service?.nombre || "Chat GPT Plus"} x${durationLabel} (${purchaseDate})${providerTag}

Correo: ${item.correo || ""} (${cupo})
(Solicitar codigo)

${cliente}

-Recuerda el ingreso es para un solo dispositivo ${String.fromCodePoint(0x1F601)}
-Prohibido borrar las busquedas ${String.fromCodePoint(0x1F6AB)}
-La cuenta es compartida con otros usuarios ${String.fromCodePoint(0x1FAC2)}
-Prohibido cambiar cualquier tipo de información ${String.fromCodePoint(0x1FAE1)}
Ingresar solo en las apps oficiales, no por el navegador${String.fromCodePoint(0x1F6A8)}
(Descargar la app ya sea en PC o CEL)
Respeta las reglas para mantener tu garantía${String.fromCodePoint(0x2611, 0xFE0F)}`);
    }

    if (type === "gemini") {
      return withPurchaseThanks(`Invitación enviada al correo (Gmail). Por favor, aceptar ${String.fromCodePoint(0x2705)} ${String.fromCodePoint(0x1F4E9)}

Recuerda aceptar y verificar que quedes dentro del grupo familiar ${String.fromCodePoint(0x2611, 0xFE0F)}${String.fromCodePoint(0x1F601)}

${service?.nombre || "Gemini Pro"} x${durationLabel} (${purchaseDate})${providerTag}

Correo: ${clientEmail}
Grupo: ${item.grupo || item.correo || ""}

${cliente}`);
    }

    const profilePin = item.perfiles_pins?.[String(cupo)] || item.pin || "";
    const pinLine = profilePin ? `\nPIN: ${profilePin}` : "";
    const profileLine = cupo ? `\nPERFIL ${cupo}` : "";
    const notes = item.notas ? `\n\n${item.notas}` : "";
    return withPurchaseThanks(`${service?.nombre || "Servicio"} x${durationLabel} (${purchaseDate})${providerTag}

CORREO: ${item.correo || ""}
CLAVE: ${item.clave || ""}${profileLine}${pinLine}

¡IMPORTANTE!
• ${String.fromCodePoint(0x26A0, 0xFE0F)} Uso apropiado
${String.fromCodePoint(0x274C)} No cambiar nombres
${String.fromCodePoint(0x274C)} No usarla en más de 1 dispositivo a la vez
${String.fromCodePoint(0x274C)} Prohibido compartir la pantalla con otras personas

${String.fromCodePoint(0x1F6AB)}Si viola alguna de las reglas, la pantalla quedará suspendida.${String.fromCodePoint(0x1F6AB)}${notes}

${cliente}`);
  }

  function buildGuaranteeWhatsappMessage(item, assignment, serviceOverride = null, context = {}) {
    if (!item || !assignment) return "";
    const sub = context.sub || enrichedSubs.find((entry) => entry.id === assignment.suscripcion_id) || null;
    const cliente = sub?.cliente?.nombre || sub?.cliente?.username || "Cliente";
    const service = serviceOverride || sub?.servicio || data.servicios.find((srv) => srv.id === item.servicio_id) || null;
    const provider = providerInitials(item);

    const oldAssignment = context.oldAssignment
      || (data.asignaciones || []).find((entry) => entry.id === assignment.reemplaza_asignacion_id)
      || null;
    const oldAccount = context.oldAccount
      || (oldAssignment ? inventoryAccountById(oldAssignment.inventario_id) : null);
    const originalSlot = Number(oldAssignment?.cupo_numero || assignment.cupo_numero || 1);
    const originalPin = oldAccount?.perfiles_pins?.[String(originalSlot)]
      || oldAccount?.pin
      || item.perfiles_pins?.[String(originalSlot)]
      || item.pin
      || "";

    const access = item.correo || item.grupo || "";
    const password = item.clave || "";
    const providerText = provider ? ` ${provider}` : "";
    const pinLine = originalPin ? `\npin: ${originalPin}` : "";

    return withPurchaseThanks(`Garantia ${service?.nombre || "Servicio"}${providerText}

correo: ${access}
clave: ${password}
Perfil ${originalSlot}${pinLine}

${cliente}

Disculpa las molestias ${String.fromCodePoint(0x1F64F, 0x1F3FE)}`);
  }

  async function assignInventory() {
    if (!selectedDeliveryClient || !selectedInventoryItem || !selectedDeliveryService) {
      setError("Selecciona servicio, cuenta/perfil y cliente.");
      return;
    }
    const slots = availableSlots(selectedInventoryItem);
    const chosenSlot = Number(deliveryForm.cupo_numero || slots[0]);
    if (!chosenSlot) {
      setError("Esa cuenta ya no tiene cupos disponibles.");
      return;
    }
    if (effectiveDeliveryType(selectedInventoryService) === "gemini" && !String(deliveryForm.correo_cliente || "").trim()) {
      setError("Para Gemini escribe el correo Gmail que te proporcionó el cliente.");
      return;
    }
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const result = await api("/api/admin/inventario", {
        method: "PATCH",
        body: JSON.stringify({
  id: selectedInventoryItem.id,
  action: "asignar_nuevo_pedido",
  cliente_id: selectedDeliveryClient.id,
  fecha_inicio: deliveryForm.fecha_inicio || todayISO(),
  cupo_numero: chosenSlot,
  correo_cliente: deliveryForm.correo_cliente,
  ganancia_neta: Number(profitValue || 0),
  fecha_ganancia: deliveryForm.fecha_inicio || todayISO()
})
      });

      const newSub = {
        id: result.suscripcion?.id,
        cliente_id: selectedDeliveryClient.id,
        servicio_id: selectedDeliveryService.id,
        fecha_inicio: result.suscripcion?.fecha_inicio || deliveryForm.fecha_inicio || todayISO(),
        fecha_vencimiento: result.suscripcion?.fecha_vencimiento || addDuration(deliveryForm.fecha_inicio || todayISO(), selectedInventoryItem.duracion_tipo || "dias", selectedInventoryItem.duracion_cantidad || 1),
        activo: true,
        cliente: selectedDeliveryClient,
        servicio: selectedDeliveryService
      };
      const generated = {
        text: buildDeliveryMessage(newSub, selectedInventoryItem, { cupo_numero: chosenSlot, correo_cliente: deliveryForm.correo_cliente, fecha_entrega: todayISO() }),
        cliente: selectedDeliveryClient,
        servicio: selectedDeliveryService,
        cuenta: selectedInventoryItem,
        asignacion: result.asignacion,
        suscripcion: result.suscripcion
      };
      setGeneratedDelivery(generated);
      setDeliveryForm((prev) => ({ ...prev, servicio_id: "", cliente_id: "", inventario_id: "", cupo_numero: "", correo_cliente: "", fecha_inicio: todayISO() }));
      setSubForm({ cliente_id: "", servicio_id: "", fecha_inicio: todayISO() });
      setOrderSource("external");
      setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "" });
      setProfitValue("");
      setClientQuery("");
      setServiceQuery("");
      setDeliveryClientQuery("");
      setDeliveryServiceQuery("");
      await refresh();
      setMessage("Entrega generada y nuevo pedido agregado a Cuentas activas.");
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  function beginReplacement(item) {
    const service = (data.servicios || []).find((entry) => entry.id === item.servicio_id) || null;
    const type = effectiveDeliveryType(service);
    const activeCount = (data.asignaciones || []).filter((assignment) => assignment.activo && assignment.inventario_id === item.id).length;
    const defaultSlots = Math.max(Number(item.cupos_total || 1), activeCount || 1);
    setReplacementForm({ old_inventory_id: item.id });
    setReplacementAccountForm({
      proveedor_id: "",
      correo: "",
      clave: "",
      pin: "",
      perfiles_pins: type === "estandar" ? { ...(item.perfiles_pins || {}) } : {},
      grupo: "",
      cupos_total: defaultSlots,
      duracion_tipo: item.duracion_tipo || (type === "gemini" ? "meses" : "dias"),
      duracion_cantidad: item.duracion_cantidad || (type === "gemini" ? 1 : 30),
      notas: "",
      fecha_carga: todayISO()
    });
    setGeneratedGuarantees([]);
    setGeneratedDelivery(null);
    setError("");
    setMessage("");
    window.setTimeout(() => document.getElementById("guarantee-create-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  const replacementSourceItem = useMemo(
    () => (data.inventario || []).find((item) => item.id === replacementForm.old_inventory_id) || null,
    [data.inventario, replacementForm.old_inventory_id]
  );

  const replacementSourceAssignments = useMemo(
    () => replacementSourceItem ? (data.asignaciones || []).filter((assignment) => assignment.activo && assignment.inventario_id === replacementSourceItem.id) : [],
    [data.asignaciones, replacementSourceItem]
  );

  const replacementService = useMemo(
    () => replacementSourceItem ? (data.servicios || []).find((service) => service.id === replacementSourceItem.servicio_id) || null : null,
    [data.servicios, replacementSourceItem]
  );

  const replacementType = effectiveDeliveryType(replacementService);

  function inventoryAccountById(id) {
    return (data.inventario || []).find((account) => account.id === id)
      || (data.inventario_historico || []).find((account) => account.id === id)
      || null;
  }

  function guaranteeSourceAccount(item) {
    const replacementAssignment = (data.asignaciones || []).find((assignment) =>
      assignment.activo && assignment.inventario_id === item.id && assignment.es_reemplazo && assignment.reemplaza_asignacion_id
    );
    if (replacementAssignment) {
      const previousAssignment = (data.asignaciones || []).find((assignment) => assignment.id === replacementAssignment.reemplaza_asignacion_id);
      if (previousAssignment) {
        const previousAccount = inventoryAccountById(previousAssignment.inventario_id);
        if (previousAccount) return previousAccount;
      }
    }
    const tag = String(item?.etiqueta || "");
    if (tag.startsWith("garantia:")) return { correo: tag.slice("garantia:".length) || "cuenta anterior" };
    return null;
  }

  async function createGuaranteeAndReplace(e) {
    e?.preventDefault?.();
    if (!replacementSourceItem || !replacementService) {
      setError("Selecciona la cuenta que vas a reemplazar.");
      return;
    }
    if (!replacementSourceAssignments.length) {
      setError("La cuenta seleccionada no tiene entregas activas para reemplazar.");
      return;
    }
    if (!replacementAccountForm.proveedor_id) {
      setError("Selecciona el proveedor de la cuenta de garantía.");
      return;
    }

    const totalSlots = Number(replacementAccountForm.cupos_total || 0);
    const highestRequiredSlot = replacementSourceAssignments.reduce((max, assignment) => Math.max(max, Number(assignment.cupo_numero || 1)), 0);
    if (replacementType === "estandar" && (!Number.isInteger(totalSlots) || totalSlots < highestRequiredSlot)) {
      setError(`La cuenta de garantía necesita al menos ${highestRequiredSlot} perfiles para conservar el mismo número de perfil de cada cliente.`);
      return;
    }
    if (replacementType === "gemini" && !String(replacementAccountForm.grupo || "").trim()) {
      setError("Escribe el correo del grupo de la nueva cuenta Gemini.");
      return;
    }
    if (replacementType !== "gemini" && !String(replacementAccountForm.correo || "").trim()) {
      setError("Escribe el correo/acceso de la nueva cuenta de garantía.");
      return;
    }

    setWorking(true);
    setError("");
    setMessage("");
    let createdId = "";
    try {
      const created = await api("/api/admin/inventario", {
        method: "POST",
        body: JSON.stringify({
          servicio_id: replacementSourceItem.servicio_id,
          proveedor_id: replacementAccountForm.proveedor_id,
          correo: replacementAccountForm.correo,
          clave: replacementAccountForm.clave,
          perfiles_pins: replacementAccountForm.perfiles_pins || {},
          grupo: replacementAccountForm.grupo,
          cupos_total: totalSlots,
          duracion_tipo: replacementAccountForm.duracion_tipo,
          duracion_cantidad: replacementAccountForm.duracion_cantidad,
          notas: replacementAccountForm.notas,
          fecha_carga: replacementAccountForm.fecha_carga || todayISO()
        })
      });
      createdId = created.cuenta?.id || "";
      if (!createdId) throw new Error("No se pudo crear la cuenta de garantía.");

      const sourceAssignmentsSnapshot = replacementSourceAssignments.map((assignment) => ({ ...assignment }));
      const result = await api("/api/admin/inventario", {
        method: "PATCH",
        body: JSON.stringify({
          id: createdId,
          action: "reemplazar_cuenta_completa",
          old_inventory_id: replacementSourceItem.id
        })
      });

      const selectedProvider = (data.proveedores || []).find((provider) => provider.id === replacementAccountForm.proveedor_id) || null;
      const newAccountForMessage = {
        ...(created.cuenta || {}),
        servicios: replacementService,
        proveedores: selectedProvider,
        etiqueta: `garantia:${replacementSourceItem.grupo || replacementSourceItem.correo || "cuenta anterior"}`
      };

      const guarantees = (result.reemplazos || []).map((replacement) => {
        const oldAssignment = sourceAssignmentsSnapshot.find((assignment) => assignment.id === replacement.old_assignment_id);
        const sub = enrichedSubs.find((item) => item.id === oldAssignment?.suscripcion_id);
        if (!oldAssignment || !sub) return null;
        return {
          id: replacement.asignacion?.id || replacement.old_assignment_id,
          text: buildGuaranteeWhatsappMessage(
            newAccountForMessage,
            replacement.asignacion,
            replacementService,
            { sub, oldAssignment, oldAccount: inventoryAccountById(oldAssignment.inventario_id) }
          ),
          cliente: sub.cliente,
          servicio: sub.servicio,
          cuenta: newAccountForMessage,
          asignacion: replacement.asignacion
        };
      }).filter(Boolean);

      setGeneratedGuarantees(guarantees);
      setReplacementForm({ old_inventory_id: "" });
      setReplacementAccountForm({ proveedor_id: "", correo: "", clave: "", pin: "", perfiles_pins: {}, grupo: "", cupos_total: "", duracion_tipo: "", duracion_cantidad: "", notas: "", fecha_carga: todayISO() });
      await refresh();
      setMessage(`Cuenta de garantía creada. ${guarantees.length} entrega(s) fueron movidas desde ${replacementSourceItem.grupo || replacementSourceItem.correo || "la cuenta fallida"}.`);
    } catch (e) {
      if (createdId) {
        try {
          await api("/api/admin/inventario", { method: "DELETE", body: JSON.stringify({ id: createdId }) });
        } catch {}
      }
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  async function copyText(text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice(false);
      window.setTimeout(() => setCopyNotice(true), 10);
    } catch {
      setError("No se pudo copiar automáticamente. Mantén pulsado el texto para copiarlo.");
    }
  }

  async function copyDeliveryText() {
    await copyText(generatedDelivery?.text);
  }

  async function createSubscription(e) {
    e.preventDefault();
    if (!calculatedExpiry) {
      setError("Selecciona un servicio para calcular automáticamente el vencimiento.");
      return;
    }
    await runAction(async () => {
      await api("/api/admin/suscripciones", {
        method: "POST",
        body: JSON.stringify({ ...subForm, fecha_vencimiento: calculatedExpiry, ganancia_neta: Number(profitValue || 0), fecha_ganancia: todayISO() })
      });
      setSubForm({ cliente_id: "", servicio_id: "", fecha_inicio: todayISO() });
      setDeliveryForm((prev) => ({ ...prev, servicio_id: "", cliente_id: "", inventario_id: "", cupo_numero: "", correo_cliente: "", fecha_inicio: todayISO() }));
      setOrderSource("external");
      setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "" });
      setProfitValue("");
      setClientQuery("");
      setServiceQuery("");
      setGeneratedDelivery(null);
    }, "Pedido agregado correctamente.");
  }

  async function createExternalOrder() {
    if (!selectedClient || !selectedService) {
      setError("Selecciona cliente y servicio.");
      return;
    }
    const correo = String(externalOrderForm.correo || "").trim();
    const perfil = Number(externalOrderForm.perfil || 1);
    if (!correo) {
      setError("Escribe el correo o acceso de la cuenta externa.");
      return;
    }
    if (!Number.isInteger(perfil) || perfil < 1 || perfil > 50) {
      setError("El perfil/cupo debe estar entre 1 y 50.");
      return;
    }

    setWorking(true);
    setError("");
    setMessage("");
    try {
      const result = await api("/api/admin/externo", {
        method: "POST",
        body: JSON.stringify({
          cliente_id: selectedClient.id,
          servicio_id: selectedService.id,
          fecha_inicio: subForm.fecha_inicio || todayISO(),
          proveedor_id: externalOrderForm.proveedor_id,
          correo,
          clave: externalOrderForm.clave,
          perfil,
          pin: externalOrderForm.pin,
          ganancia_neta: Number(profitValue || 0),
          fecha_ganancia: todayISO()
        })
      });

      const provider = (data.proveedores || []).find((item) => item.id === externalOrderForm.proveedor_id) || null;
      const accountForMessage = {
        ...result.cuenta,
        proveedores: provider ? { iniciales: provider.iniciales } : null,
        servicios: selectedService
      };
      const subForMessage = {
        ...result.suscripcion,
        cliente: selectedClient,
        servicio: selectedService
      };
      const generated = {
        text: buildDeliveryMessage(subForMessage, accountForMessage, {
          cupo_numero: perfil,
          correo_cliente: effectiveDeliveryType(selectedService) === "gemini" ? correo : null,
          fecha_entrega: todayISO()
        }),
        cliente: selectedClient,
        servicio: selectedService,
        cuenta: accountForMessage,
        asignacion: result.asignacion,
        suscripcion: result.suscripcion
      };

      setGeneratedDelivery(generated);
      setSubForm({ cliente_id: "", servicio_id: "", fecha_inicio: todayISO() });
      setDeliveryForm({ servicio_id: "", cliente_id: "", inventario_id: "", cupo_numero: "", correo_cliente: "", fecha_inicio: todayISO() });
      setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "" });
      setProfitValue("");
      setOrderSource("external");
      setClientQuery("");
      setServiceQuery("");
      await refresh();
      setMessage("Pedido externo creado, credenciales asignadas y visibles en el panel del cliente.");
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  function beginSubscriptionEdit(s) {
    const assignment = activeAssignmentBySubscription[s.id];
    setEditingSubscriptionId(s.id);
    setSubscriptionEditForm({
      fecha_inicio: s.fecha_inicio || todayISO(),
      servicio_id: s.servicio_id || "",
      cupo_numero: assignment?.cupo_numero ? String(assignment.cupo_numero) : ""
    });
  }

  async function saveSubscriptionEdit(s) {
    const assignment = activeAssignmentBySubscription[s.id];
    if (!subscriptionEditForm.fecha_inicio || !subscriptionEditForm.servicio_id) {
      setError("Fecha de inicio y servicio son obligatorios.");
      return;
    }
    if (assignment && (!subscriptionEditForm.cupo_numero || Number(subscriptionEditForm.cupo_numero) < 1)) {
      setError("Escribe un perfil/cupo válido.");
      return;
    }
    await runAction(async () => {
      await api("/api/admin/suscripciones", {
        method: "PATCH",
        body: JSON.stringify({
          id: s.id,
          fecha_inicio: subscriptionEditForm.fecha_inicio,
          servicio_id: subscriptionEditForm.servicio_id,
          ...(assignment ? { cupo_numero: Number(subscriptionEditForm.cupo_numero) } : {})
        })
      });
      setEditingSubscriptionId("");
    }, "Pedido actualizado. Se recalculó la fecha final según la fecha de inicio y la duración correspondiente.");
  }

  async function toggleSubscription(s) {
    await runAction(
      () => api("/api/admin/suscripciones", { method: "PATCH", body: JSON.stringify({ id: s.id, activo: !s.activo }) }),
      s.activo ? "Suscripción suspendida." : "Suscripción activada."
    );
  }

  async function deleteSubscription(s) {
    if (!confirmDelete()) return;
    await runAction(
      () => api("/api/admin/suscripciones", { method: "DELETE", body: JSON.stringify({ id: s.id }) }),
      "Pedido eliminado y perfil/cupo liberado inmediatamente."
    );
  }

  function getRenewalDraft(id) {
    return renewalDrafts[id] || { tipo: "meses", cantidad: 1 };
  }

  function setRenewalDraft(id, changes) {
    setRenewalDrafts((prev) => ({ ...prev, [id]: { ...getRenewalDraft(id), ...changes } }));
  }

  async function renewSubscription(s) {
    const draft = getRenewalDraft(s.id);
    const max = draft.tipo === "dias" ? 30 : draft.tipo === "meses" ? 12 : 1;
    const rawQty = draft.tipo === "anios" ? 1 : Number(draft.cantidad);
    if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > max) {
      setError(`Escribe una cantidad entre 1 y ${max}.`);
      return;
    }
    const base = s.fecha_vencimiento && s.fecha_vencimiento >= todayISO() ? s.fecha_vencimiento : todayISO();
    const fecha_vencimiento = addDuration(base, draft.tipo, rawQty);
    await runAction(
      () => api("/api/admin/suscripciones", { method: "PATCH", body: JSON.stringify({ id: s.id, fecha_vencimiento, activo: true }) }),
      `Renovada hasta ${formatDate(fecha_vencimiento)}.`
    );
    setRenewMenuId("");
  }

  function getInventoryRenewalDraft(id) {
    return inventoryRenewalDrafts[id] || { tipo: "meses", cantidad: 1 };
  }

  function setInventoryRenewalDraft(id, changes) {
    setInventoryRenewalDrafts((prev) => ({ ...prev, [id]: { ...getInventoryRenewalDraft(id), ...changes } }));
  }

  async function renewInventoryAccount(item) {
    const draft = getInventoryRenewalDraft(item.id);
    const max = draft.tipo === "dias" ? 30 : 12;
    const qty = Number(draft.cantidad);
    if (!Number.isInteger(qty) || qty < 1 || qty > max) {
      setError(`Escribe una cantidad entre 1 y ${max}.`);
      return;
    }
    await runAction(async () => {
      await api("/api/admin/inventario", {
        method: "PATCH",
        body: JSON.stringify({ id: item.id, action: "renovar_cuenta", tipo: draft.tipo, cantidad: qty })
      });
    }, "Cuenta Streaming renovada correctamente.");
    setInventoryRenewMenuId("");
  }

  function selectClient(cliente) {
    setSubForm((prev) => ({ ...prev, cliente_id: cliente.id }));
    setDeliveryForm((prev) => ({ ...prev, cliente_id: cliente.id, correo_cliente: "" }));
    setClientQuery(cliente.nombre || "");
    setShowClientMatches(false);
  }

  function handleClientQuery(value) {
    setClientQuery(value);
    setShowClientMatches(true);
    const normalized = normalizeText(value);
    const exact = data.clientes.find((c) => normalizeText(c.nombre) === normalized);
    if (exact) {
      setSubForm((prev) => ({ ...prev, cliente_id: exact.id }));
      setDeliveryForm((prev) => ({ ...prev, cliente_id: exact.id }));
    } else {
      if (subForm.cliente_id) setSubForm((prev) => ({ ...prev, cliente_id: "" }));
      setDeliveryForm((prev) => ({ ...prev, cliente_id: "", correo_cliente: "" }));
    }
  }

  function selectService(service) {
    const hasStock = availableInventory.some((item) => item.servicio_id === service.id);
    setSubForm((prev) => ({ ...prev, servicio_id: service.id }));
    setDeliveryForm((prev) => ({
      ...prev,
      servicio_id: service.id,
      inventario_id: "",
      cupo_numero: "",
      correo_cliente: "",
      fecha_inicio: subForm.fecha_inicio || todayISO()
    }));
    setOrderSource(hasStock ? "stock" : "external");
    setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "" });
    setServiceQuery(serviceLabel(service));
    setShowServiceMatches(false);
    setGeneratedDelivery(null);
  }

  function handleServiceQuery(value) {
    setServiceQuery(value);
    setShowServiceMatches(true);
    const normalized = normalizeText(value);
    const exact = data.servicios.find((service) => service.activo && normalizeText(serviceLabel(service)) === normalized);
    if (exact) {
      const hasStock = availableInventory.some((item) => item.servicio_id === exact.id);
      setSubForm((prev) => ({ ...prev, servicio_id: exact.id }));
      setDeliveryForm((prev) => ({ ...prev, servicio_id: exact.id, inventario_id: "", cupo_numero: "", correo_cliente: "" }));
      setOrderSource(hasStock ? "stock" : "external");
      setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "" });
    } else {
      if (subForm.servicio_id) setSubForm((prev) => ({ ...prev, servicio_id: "" }));
      setDeliveryForm((prev) => ({ ...prev, servicio_id: "", inventario_id: "", cupo_numero: "", correo_cliente: "" }));
      setOrderSource("external");
      setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "" });
    }
    setGeneratedDelivery(null);
  }

  function beginClientEdit(cliente) {
    setEditingClientId(cliente.id);
    setClientEditForm({ nombre: cliente.nombre || "", username: cliente.username || "", telefono: cliente.telefono || "", password: "" });
  }

  function beginServiceEdit(service) {
    const duration = serviceDuration(service);
    setEditingServiceId(service.id);
    setServiceEditForm({
      nombre: service.nombre || "",
      descripcion: service.descripcion || "",
      activo: service.activo !== false,
      duracion_tipo: duration.tipo,
      duracion_cantidad: duration.cantidad,
      tipo_entrega: service.tipo_entrega || "estandar"
    });
  }

  function navigate(nextView) {
    setDeleteMode({});
    setDeleteSelection({ suscripciones: [], clientes: [], servicios: [], promociones: [], proveedores: [], inventario: [] });
    setView(nextView);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("section", nextView);
      window.history.replaceState({}, "", url);
    }
    setMenuOpen(false);
    setError("");
    setMessage("");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function durationControls(form, setter, prefix) {
    const tipo = form.duracion_tipo;
    const max = tipo === "dias" ? 30 : tipo === "meses" ? 12 : 1;
    return (
      <div className="durationControls">
        <label>Tiempo
          <select value={tipo} onChange={(e) => {
            const nextType = e.target.value;
            const nextMax = nextType === "dias" ? 30 : nextType === "meses" ? 12 : 1;
            const current = Number(form.duracion_cantidad);
            const nextQty = nextType === "anios" ? 1 : (Number.isFinite(current) && current >= 1 ? Math.min(current, nextMax) : 1);
            setter({ ...form, duracion_tipo: nextType, duracion_cantidad: nextQty });
          }}>
            <option value="dias">Días</option>
            <option value="meses">Meses</option>
            <option value="anios">1 año</option>
          </select>
        </label>
        <label>Cantidad
          <input
            aria-label={`${prefix} cantidad`}
            type="number"
            inputMode="numeric"
            min="1"
            max={max}
            required
            disabled={tipo === "anios"}
            value={tipo === "anios" ? 1 : form.duracion_cantidad}
            onChange={(e) => setter({ ...form, duracion_cantidad: e.target.value })}
            onBlur={() => {
              if (tipo === "anios") return;
              const parsed = Number(form.duracion_cantidad);
              const fixed = Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : 1;
              setter({ ...form, duracion_cantidad: fixed });
            }}
          />
        </label>
      </div>
    );
  }

  function deliveryDurationControls(form, setter, prefix) {
    const tipoEntrega = form.tipo_entrega || "estandar";
    if (tipoEntrega === "manual") return durationControls(form, setter, prefix);
    const tipo = tipoEntrega === "gemini" ? "meses" : (form.duracion_tipo === "dias" ? "dias" : "meses");
    const max = tipo === "dias" ? 30 : 12;
    return (
      <div className="durationControls">
        <label>Tiempo
          <select value={tipo} disabled={tipoEntrega === "gemini"} onChange={(e) => setter({ ...form, duracion_tipo: e.target.value, duracion_cantidad: 1 })}>
            {tipoEntrega !== "gemini" && <option value="dias">Días</option>}
            <option value="meses">Meses</option>
          </select>
        </label>
        <label>Cantidad
          <input type="number" inputMode="numeric" min="1" max={max} required value={form.duracion_cantidad} onChange={(e) => setter({ ...form, duracion_tipo: tipo, duracion_cantidad: e.target.value })} onBlur={() => {
            const parsed = Number(form.duracion_cantidad);
            const fixed = Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : 1;
            setter({ ...form, duracion_tipo: tipo, duracion_cantidad: fixed });
          }} />
        </label>
      </div>
    );
  }

  function renewalDropdown(s) {
    const draft = getRenewalDraft(s.id);
    const max = draft.tipo === "dias" ? 30 : draft.tipo === "meses" ? 12 : 1;
    const isOpen = renewMenuId === s.id;
    return (
      <div className="renewMenuWrap">
        <button type="button" className="miniButton renewTrigger" onClick={() => setRenewMenuId(isOpen ? "" : s.id)}>
          Renovar <span>{isOpen ? "▴" : "▾"}</span>
        </button>
        {isOpen && (
          <div className="renewDropdown">
            <label>Tiempo
              <select value={draft.tipo} onChange={(e) => setRenewalDraft(s.id, { tipo: e.target.value, cantidad: 1 })}>
                <option value="dias">Días</option>
                <option value="meses">Meses</option>
                <option value="anios">1 año</option>
              </select>
            </label>
            <label>Cantidad
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max={max}
                disabled={draft.tipo === "anios"}
                value={draft.tipo === "anios" ? 1 : draft.cantidad}
                onChange={(e) => setRenewalDraft(s.id, { cantidad: e.target.value })}
                onBlur={() => {
                  if (draft.tipo === "anios") return;
                  const parsed = Number(getRenewalDraft(s.id).cantidad);
                  const fixed = Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : 1;
                  setRenewalDraft(s.id, { cantidad: fixed });
                }}
              />
            </label>
            <button type="button" className="miniButton primaryMini" disabled={working} onClick={() => renewSubscription(s)}>Aplicar renovación</button>
          </div>
        )}
      </div>
    );
  }

  function inventoryAccountRenewalDropdown(item) {
    const draft = getInventoryRenewalDraft(item.id);
    const max = draft.tipo === "dias" ? 30 : 12;
    const isOpen = inventoryRenewMenuId === item.id;
    return (
      <div className="renewMenuWrap inventoryRenewMenu">
        <button type="button" className="miniButton renewTrigger" onClick={() => setInventoryRenewMenuId(isOpen ? "" : item.id)}>
          Renovar cuenta <span>{isOpen ? "▴" : "▾"}</span>
        </button>
        {isOpen && (
          <div className="renewDropdown">
            <label>Tiempo
              <select value={draft.tipo} onChange={(e) => setInventoryRenewalDraft(item.id, { tipo: e.target.value, cantidad: 1 })}>
                <option value="dias">Días</option>
                <option value="meses">Meses</option>
              </select>
            </label>
            <label>Cantidad
              <input type="number" inputMode="numeric" min="1" max={max} value={draft.cantidad} onChange={(e) => setInventoryRenewalDraft(item.id, { cantidad: e.target.value })} />
            </label>
            <button type="button" className="miniButton primaryMini" disabled={working} onClick={() => renewInventoryAccount(item)}>Aplicar renovación</button>
          </div>
        )}
      </div>
    );
  }

  function whatsappHref(s) {
    const number = whatsappNumber(s.cliente?.telefono);
    if (!number) return "";
    const cliente = s.cliente?.nombre || s.cliente?.username || "cliente";
    const servicio = s.servicio?.nombre || "servicio";
    let message = `Holaa ${cliente} \u{1F60A}`;

    if (s.days !== null && s.days <= 0) {
      message = `Hola ${cliente}, tu servicio ${servicio} ya venció, deseas renovarlo? Estoy atento a tu solicitud`;
    } else if (s.days !== null && s.days >= 1 && s.days <= 3) {
      const unit = s.days === 1 ? "día" : "días";
      message = `Holaa ${cliente}, tu servicio ${servicio} vence en ${s.days} ${unit}, si deseas renovarlo, Estoy atento a tu solicitud \u{1F60A}`;
    }

    return whatsappUrl(number, message);
  }

  function clientWhatsappHref(cliente) {
    const number = whatsappNumber(cliente?.telefono);
    return number ? `https://wa.me/${number}` : "";
  }

  function accountStatus(s) {
    if (!s.activo) return { text: "Suspendido", className: "status suspendedStatus" };
    if (s.days !== null && s.days <= 0) return { text: "Vencido", className: "status off" };
    return { text: "Activo", className: "status ok" };
  }

  function renderAccountsTable(rows, emptyText) {
    if (rows.length === 0) return <div className="card emptyState">{emptyText}</div>;
    const visibleIds = rows.map((row) => row.id);
    return (
      <>
        {bulkDeleteBar("suscripciones", visibleIds, "/api/admin/suscripciones", "pedido")}
        <div className="card accountsTableCard">
          <div className="accountsTableScroll">
            <table className="accountsTable">
              <thead>
                <tr>
                  {deleteMode["suscripciones"] && <th className="selectColumn">✓</th>}
                  <th>Cliente</th>
                  <th>Servicio</th>
                  <th>Perfil / cupo</th>
                  <th>Estado</th>
                  <th>Fecha inicio</th>
                  <th>Fecha final</th>
                  <th>Días restantes</th>
                  <th>WhatsApp</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const status = accountStatus(s);
                  const wa = whatsappHref(s);
                  const assignment = activeAssignmentBySubscription[s.id];
                  const editing = editingSubscriptionId === s.id;
                  return (
                    <tr key={s.id} className={editing ? "subscriptionEditRow" : ""}>
                      {deleteMode["suscripciones"] && (
                      <td className="selectColumn"><input type="checkbox" aria-label={`Seleccionar ${s.cliente?.nombre || "pedido"}`} checked={selectedDeleteIds("suscripciones").includes(s.id)} onChange={() => toggleDeleteSelection("suscripciones", s.id)} /></td>
                      ) }
                      <td><strong>{s.cliente?.nombre || "Cliente"}</strong>{s.cliente?.username && <small>@{s.cliente.username}</small>}</td>
                      <td>{editing ? (
                        <select value={subscriptionEditForm.servicio_id} onChange={(e) => setSubscriptionEditForm((prev) => ({ ...prev, servicio_id: e.target.value }))}>
                          {data.servicios.filter((service) => service.activo !== false).map((service) => <option key={service.id} value={service.id}>{serviceLabel(service)}</option>)}
                        </select>
                      ) : serviceLabel(s.servicio)}</td>
                      <td>{editing && assignment ? (
                        <input className="smallNumberInput" type="number" min="1" inputMode="numeric" value={subscriptionEditForm.cupo_numero} onChange={(e) => setSubscriptionEditForm((prev) => ({ ...prev, cupo_numero: e.target.value }))} />
                      ) : assignment ? `${effectiveDeliveryType(s.servicio) === "estandar" ? "Perfil" : "Cupo"} ${assignment.cupo_numero}` : "—"}</td>
                      <td><span className={status.className}>{status.text}</span></td>
                      <td>{editing ? <input type="date" value={subscriptionEditForm.fecha_inicio} onChange={(e) => setSubscriptionEditForm((prev) => ({ ...prev, fecha_inicio: e.target.value }))} /> : formatDate(s.fecha_inicio)}</td>
                      <td>{formatDate(s.fecha_vencimiento)}</td>
                      <td><span className={`daysBadge ${daysTone(s.days)}`}>{remainingText(s.days)}</span></td>
                      <td>{wa ? <a className="waTableButton" href={wa} target="_blank" rel="noreferrer">WhatsApp</a> : <span className="noPhone">Sin celular</span>}</td>
                      <td>
                        <div className="tableActions">
                          {editing ? (
                            <>
                              <button type="button" className="miniButton primaryMini" disabled={working} onClick={() => saveSubscriptionEdit(s)}>Guardar</button>
                              <button type="button" className="miniButton" onClick={() => setEditingSubscriptionId("")}>Cancelar</button>
                            </>
                          ) : (
                            <>
                              {renewalDropdown(s)}
                              <button type="button" className="miniButton" disabled={working} onClick={() => beginSubscriptionEdit(s)}>Editar</button>
                              <button type="button" className="miniButton" disabled={working} onClick={() => toggleSubscription(s)}>{s.activo ? "Suspender" : "Activar"}</button>
                              <button type="button" className="miniButton dangerMini" disabled={working} onClick={() => beginDeleteSelection("suscripciones", s.id)}>Borrar</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  function renderPedido() {
    const orderInventoryOptions = selectedService
      ? availableInventory.filter((item) => item.servicio_id === selectedService.id)
      : [];
    const orderUsesInventory = Boolean(selectedService && orderSource === "stock" && orderInventoryOptions.length > 0);
    const orderUsesExternal = Boolean(selectedService && orderSource === "external");
    const orderSlots = availableSlots(selectedInventoryItem);
    const orderExpiry = orderUsesInventory && selectedInventoryItem
      ? addDuration(
          subForm.fecha_inicio || todayISO(),
          selectedInventoryItem.duracion_tipo || "dias",
          selectedInventoryItem.duracion_cantidad || 1
        )
      : calculatedExpiry;
    const orderWhatsapp = generatedDelivery?.cliente?.telefono
      ? whatsappUrl(generatedDelivery.cliente.telefono, generatedDelivery.text)
      : "";
    const selectedType = effectiveDeliveryType(selectedService);

    function orderAccountLabel(item) {
      const used = assignmentCountByInventory[item.id] || 0;
      const provider = providerInitials(item);
      const access = item.grupo || item.correo || "Cuenta";
      return `${access} · ${provider || "Sin proveedor"} · ${Number(item.cupos_total || 1) - used}/${item.cupos_total} libres`;
    }

    return (
      <>
        <div className="pageHeading">
          <p className="muted">Ventas</p>
          <h1>Generar nuevo pedido</h1>
          <p className="pageLead">Crea pedidos con una cuenta del stock, con un perfil comprado por fuera o sin credenciales. Todo queda registrado en Cuentas activas y en el panel del cliente.</p>
        </div>

        <form className="card orderForm" onSubmit={(e) => {
          e.preventDefault();
          if (orderUsesInventory) assignInventory();
          else if (orderUsesExternal) createExternalOrder();
          else createSubscription(e);
        }}>
          <div className="formSectionTitle"><span>1</span><div><h2>Cliente</h2><p>Escribe el nombre y selecciona una coincidencia.</p></div></div>
          <div className="autocompleteWrap">
            <input autoComplete="off" placeholder="Buscar cliente por nombre, usuario o celular" value={clientQuery} onFocus={() => setShowClientMatches(true)} onBlur={() => setTimeout(() => setShowClientMatches(false), 160)} onChange={(e) => handleClientQuery(e.target.value)} required />
            {showClientMatches && clientMatches.length > 0 && (
              <div className="autocompleteMenu">
                {clientMatches.map((c) => (
                  <button type="button" key={c.id} onMouseDown={(e) => e.preventDefault()} onClick={() => selectClient(c)}>
                    <strong>{c.nombre}</strong><span>{c.username ? `@${c.username}` : "Sin usuario"} · {c.telefono || "Sin celular"}</span>
                  </button>
                ))}
              </div>
            )}
            {showClientMatches && clientQuery && clientMatches.length === 0 && (
              <button type="button" className="button secondary" onMouseDown={(e)=>e.preventDefault()} onClick={() => {
                setClientForm((prev)=>({ ...prev, nombre: clientQuery }));
                setShowClientCreateInline(true);
              }}>
                + Crear este cliente nuevo
              </button>
            )}
            {showClientCreateInline && (
              <div className="card" style={{marginTop:12}}>
                <h3>Crear cliente y continuar pedido</h3>
                <div className="twoCols">
                  <label>Nombre<input value={clientForm.nombre} onChange={(e)=>setClientForm({...clientForm,nombre:e.target.value})}/></label>
                  <label>Usuario<input value={clientForm.username} onChange={(e)=>setClientForm({...clientForm,username:e.target.value})}/></label>
                  <label>Celular<input value={clientForm.telefono} onChange={(e)=>setClientForm({...clientForm,telefono:e.target.value})}/></label>
                  <label>Contraseña<input value={clientForm.password} onChange={(e)=>setClientForm({...clientForm,password:e.target.value})}/></label>
                </div>
                <button type="button" className="button primary" onClick={createClient}>Guardar cliente y continuar pedido</button>
              </div>
            )}
          </div>

          <div className="twoCols">
            <label>Celular asignado<input value={selectedClient?.telefono || ""} readOnly placeholder="Se completa al elegir el cliente" /></label>
            <label>Usuario<input value={selectedClient?.username || ""} readOnly placeholder="Se completa al elegir el cliente" /></label>
          </div>

          <div className="formSectionTitle"><span>2</span><div><h2>Servicio comprado</h2><p>Escribe el nombre del servicio y selecciona una coincidencia.</p></div></div>
          <div className="autocompleteWrap">
            <input
              autoComplete="off"
              placeholder="Buscar servicio streaming..."
              value={serviceQuery}
              onFocus={() => setShowServiceMatches(true)}
              onBlur={() => setTimeout(() => setShowServiceMatches(false), 160)}
              onChange={(e) => handleServiceQuery(e.target.value)}
              required
            />
            {showServiceMatches && serviceMatches.length > 0 && (
              <div className="autocompleteMenu serviceAutocompleteMenu">
                {serviceMatches.map((service) => (
                  <button type="button" key={service.id} onMouseDown={(e) => e.preventDefault()} onClick={() => selectService(service)}>
                    <strong>{service.nombre}</strong>
                    <span>{durationText(serviceDuration(service).tipo, serviceDuration(service).cantidad)}{service.descripcion ? ` · ${service.descripcion}` : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedService && (
            <>
              <div className="formSectionTitle"><span>3</span><div><h2>Tipo de entrega</h2><p>Elige de dónde salen las credenciales de este pedido.</p></div></div>
              <div className="orderSourceGrid">
                {orderInventoryOptions.length > 0 && (
                  <button type="button" className={`orderSourceCard ${orderSource === "stock" ? "active" : ""}`} onClick={() => { setOrderSource("stock"); setGeneratedDelivery(null); }}>
                    <b>📦 Usar stock</b><span>{orderInventoryOptions.length} cuenta(s) con cupos disponibles</span>
                  </button>
                )}
                <button type="button" className={`orderSourceCard ${orderSource === "external" ? "active" : ""}`} onClick={() => { setOrderSource("external"); setGeneratedDelivery(null); }}>
                  <b>🔐 Cuenta externa / perfil por fuera</b><span>Ingresa aquí las credenciales compradas individualmente</span>
                </button>
                <button type="button" className={`orderSourceCard ${orderSource === "order" ? "active" : ""}`} onClick={() => { setOrderSource("order"); setGeneratedDelivery(null); }}>
                  <b>🧾 Solo crear pedido</b><span>Registra el servicio sin credenciales por ahora</span>
                </button>
              </div>
            </>
          )}

          {selectedService && orderUsesInventory && (
            <div className="orderCredentialBox">
              <h3>Cuenta del stock</h3>
              <label>Cuenta / grupo disponible
                <select value={deliveryForm.inventario_id} onChange={(e) => {
                  const item = (data.inventario || []).find((account) => account.id === e.target.value);
                  const slot = availableSlots(item)[0] || "";
                  setDeliveryForm((prev) => ({ ...prev, inventario_id: e.target.value, cupo_numero: slot }));
                  setGeneratedDelivery(null);
                }}>
                  <option value="">Seleccionar cuenta</option>
                  {orderInventoryOptions.map((item) => <option key={item.id} value={item.id}>{orderAccountLabel(item)}</option>)}
                </select>
              </label>

              {selectedInventoryItem && (
                <label>{effectiveDeliveryType(selectedInventoryService) === "estandar" ? "Perfil disponible" : "Cupo disponible"}
                  <select value={deliveryForm.cupo_numero} onChange={(e) => setDeliveryForm((prev) => ({ ...prev, cupo_numero: e.target.value }))}>
                    {orderSlots.map((slot) => <option key={slot} value={slot}>{effectiveDeliveryType(selectedInventoryService) === "estandar" ? `Perfil ${slot}` : `Cupo ${slot}`}</option>)}
                  </select>
                </label>
              )}

              {effectiveDeliveryType(selectedInventoryService) === "gemini" && (
                <label>Correo Gmail del cliente
                  <input type="email" placeholder="Correo que proporciona el cliente" value={deliveryForm.correo_cliente} onChange={(e) => setDeliveryForm((prev) => ({ ...prev, correo_cliente: e.target.value }))} required />
                </label>
              )}
            </div>
          )}

          {selectedService && orderUsesExternal && (
            <div className="orderCredentialBox externalCredentialsBox">
              <div className="externalBoxTitle"><div><b>🔐 Credenciales externas</b><span>No se agregan al stock. Quedan ligadas únicamente a este pedido y el cliente podrá consultarlas.</span></div></div>
              <div className="twoCols">
                <label>Proveedor (opcional)
                  <select value={externalOrderForm.proveedor_id} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, proveedor_id: e.target.value }))}>
                    <option value="">Sin proveedor</option>
                    {(data.proveedores || []).filter((provider) => provider.activo !== false).map((provider) => <option key={provider.id} value={provider.id}>{provider.iniciales}</option>)}
                  </select>
                </label>
                <label>{selectedType === "gemini" ? "Correo / grupo" : "Correo / acceso"}
                  <input placeholder="correo@cuenta.com" value={externalOrderForm.correo} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, correo: e.target.value }))} required />
                </label>
              </div>
              <div className="threeCols externalCredentialGrid">
                <label>Contraseña (opcional)<input placeholder="Si aplica" value={externalOrderForm.clave} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, clave: e.target.value }))} /></label>
                <label>{selectedType === "estandar" || selectedType === "manual" ? "Número de perfil" : "Número de cupo"}
                  <input type="number" inputMode="numeric" min="1" max="50" value={externalOrderForm.perfil} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, perfil: e.target.value }))} required />
                </label>
                <label>PIN (opcional)<input inputMode="numeric" placeholder="Si aplica" value={externalOrderForm.pin} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, pin: e.target.value }))} /></label>
              </div>
            </div>
          )}

          {selectedService && orderSource === "order" && (
            <div className="fieldHint">Se creará el pedido sin credenciales. Podrás gestionarlo y renovarlo normalmente desde Cuentas activas.</div>
          )}

          <div className="formSectionTitle"><span>4</span><div><h2>Fechas</h2><p>Meses conservan el mismo día del mes. Los días se suman exactamente.</p></div></div>
          <div className="twoCols">
            <label>Fecha de inicio<input type="date" value={subForm.fecha_inicio} onChange={(e) => {
              const value = e.target.value;
              setSubForm((prev) => ({ ...prev, fecha_inicio: value }));
              setDeliveryForm((prev) => ({ ...prev, fecha_inicio: value }));
            }} required /></label>
            <label>Vencimiento automático<input value={orderExpiry ? formatDate(orderExpiry) : "Selecciona un servicio"} readOnly /></label>
          </div>

          {selectedService && (
            <div className="autoDateHint">
              {orderUsesInventory && selectedInventoryItem ? inventoryServiceLabel(selectedService) : serviceLabel(selectedService)} → vence automáticamente el <strong>{formatDate(orderExpiry)}</strong>
            </div>
          )}

          <div className="formSectionTitle"><span>5</span><div><h2>Ganancia neta del pedido</h2><p>Escribe únicamente lo que este pedido te deja de ganancia en pesos. Ese será el valor usado en los reportes.</p></div></div>
          <label className="profitInputLabel">Ganancia neta (COP)
            <div className="moneyInputWrap"><span>$</span><input type="number" inputMode="numeric" min="0" step="1" placeholder="Ej. 12000" value={profitValue} onChange={(e) => setProfitValue(e.target.value)} required /></div>
          </label>

          <button className="button primary orderSubmit" disabled={working || profitValue === "" || Number(profitValue) < 0 || !subForm.cliente_id || !subForm.servicio_id || (orderUsesInventory && (!deliveryForm.inventario_id || !deliveryForm.cupo_numero)) || (orderUsesExternal && (!String(externalOrderForm.correo || "").trim() || !Number(externalOrderForm.perfil)))}>
            {working ? "Guardando..." : orderUsesInventory ? "Crear pedido y generar entrega" : orderUsesExternal ? "Crear pedido externo y generar entrega" : "Agregar pedido"}
          </button>

          {generatedDelivery && !generatedDelivery.garantia && (
            <div className="generatedDelivery">
              <div className="generatedHeader">
                <div><strong>Mensaje generado</strong><span>Cuenta asignada</span></div>
                <button type="button" className="generatedClose" aria-label="Cerrar mensaje" onClick={() => setGeneratedDelivery(null)}>×</button>
              </div>
              <textarea readOnly value={generatedDelivery.text} />
              <div className="inlineActions"><button type="button" className="miniButton primaryMini" onClick={copyDeliveryText}>Copiar texto</button>{orderWhatsapp && <a className="waTableButton" href={orderWhatsapp} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>}</div>
            </div>
          )}
        </form>

        <div className="miniStats">
          <button type="button" className="card miniStat" onClick={() => navigate("activas")}><small>Cuentas activas</small><b>{stats.activos}</b></button>
          <button type="button" className="card miniStat urgentStat" onClick={() => navigate("vencidas")}><small>Cuentas vencidas</small><b>{stats.vencidos}</b></button>
          <button type="button" className="card miniStat" onClick={() => navigate("clientes")}><small>Clientes</small><b>{stats.clientes}</b></button>
        </div>
      </>
    );
  }

  function renderActivas() {
    return (
      <>
        <div className="pageHeading"><p className="muted">Cuentas</p><h1>Cuentas activas</h1><p className="pageLead">Solo aparecen cuentas con 1 día o más restante, ordenadas de menor a mayor para que las más próximas a vencer queden arriba.</p></div>
        {renderAccountsTable(activeSubs, "No hay cuentas activas.")}
      </>
    );
  }

  function renderVencidas() {
    return (
      <>
        <div className="pageHeading"><p className="muted">Alertas</p><h1>Cuentas vencidas</h1><p className="pageLead">Aquí aparecen las cuentas vencidas desde hoy hasta 10 días atrás. Las que superan 10 días vencidas dejan de mostrarse automáticamente, sin borrar al cliente ni su historial.</p></div>
        {renderAccountsTable(expiredSubs, "No hay cuentas vencidas en los últimos 10 días.")}
      </>
    );
  }

  function renderGanancias() {
    const rows = (data.ganancias || []).filter((item) => item.ganancia_neta !== null && item.ganancia_neta !== undefined && item.ganancia_neta !== "" && Number.isFinite(Number(item.ganancia_neta)));
    const money = (value) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value || 0));
    const addDaysLocal = (iso, days) => { const date = parseISO(iso); date.setDate(date.getDate() + days); return toISO(date); };
    const weekStart = (iso) => { const date = parseISO(iso); const diff = (date.getDay() + 6) % 7; date.setDate(date.getDate() - diff); return toISO(date); };
    const longDay = (iso) => new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parseISO(iso));
    const monthName = (key) => { const value = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" }).format(parseISO(`${key}-01`)); return value.charAt(0).toUpperCase() + value.slice(1); };

    const group = (keyFn, labelFn) => {
      const map = new Map();
      for (const item of rows) {
        const date = item.fecha_ganancia || item.fecha_inicio;
        if (!date) continue;
        const key = keyFn(date);
        const current = map.get(key) || { key, total: 0, pedidos: 0 };
        current.total += Number(item.ganancia_neta || 0);
        current.pedidos += 1;
        map.set(key, current);
      }
      return [...map.values()].sort((a, b) => b.key.localeCompare(a.key)).map((item) => ({ ...item, label: labelFn(item.key) }));
    };

    const daily = group((date) => date, (key) => longDay(key));
    const weekly = group((date) => weekStart(date), (key) => `Semana del ${formatDate(key)} al ${formatDate(addDaysLocal(key, 6))}`);
    const monthly = group((date) => String(date).slice(0, 7), (key) => monthName(key));
    const visible = profitTab === "semanal" ? weekly : profitTab === "mensual" ? monthly : daily;
    const today = todayISO();
    const currentKey = profitTab === "semanal" ? weekStart(today) : profitTab === "mensual" ? today.slice(0, 7) : today;
    const current = visible.find((item) => item.key === currentKey);
    const currentTotal = current?.total || 0;
    const currentLabel = profitTab === "semanal" ? "Ganancia de esta semana" : profitTab === "mensual" ? `Ganancia de ${monthName(currentKey)}` : "Ganancia de hoy";

    return (
      <>
        <div className="pageHeading"><p className="muted">Resultados</p><h1>Ganancias</h1><p className="pageLead">Los totales salen únicamente de la ganancia neta que registras al crear cada pedido.</p></div>
        {data.ganancias_configuradas === false && <div className="card emptyState">La base de datos todavía no tiene activados los campos de ganancias. Ejecuta <strong>MIGRACION_V38_DESDE_V37.sql</strong> en Supabase. Los clientes y demás datos seguirán visibles mientras tanto.</div>}
        <div className="profitTabs">
          <button type="button" className={profitTab === "diaria" ? "active" : ""} onClick={() => setProfitTab("diaria")}>Diaria</button>
          <button type="button" className={profitTab === "semanal" ? "active" : ""} onClick={() => setProfitTab("semanal")}>Semanal</button>
          <button type="button" className={profitTab === "mensual" ? "active" : ""} onClick={() => setProfitTab("mensual")}>Mensual</button>
        </div>
        <section className="card profitHero"><span>{currentLabel}</span><strong>{money(currentTotal)}</strong><small>{current?.pedidos || 0} pedido(s) en este período · {rows.length} pedido(s) con ganancia registrada en total</small></section>
        {visible.length === 0 ? <div className="card emptyState">Todavía no hay ganancias registradas.</div> : (
          <div className="profitList">
            {visible.map((item) => <article className="card profitRow" key={item.key}><div><span>{item.label}</span><small>{item.pedidos} pedido(s)</small></div><strong>{money(item.total)}</strong></article>)}
          </div>
        )}
      </>
    );
  }

  function renderClientes() {
    return (
      <>
        <div className="pageHeading"><h1>Lista de clientes</h1></div>
        <div className="clientListToolbar">
          <button type="button" className="button primary addClientFromList" onClick={() => setShowClientCreateInline((value) => !value)}>(+) Agregar cliente</button>
          <button type="button" className="button" disabled={working} onClick={syncGoogleBackup}>{working ? "Sincronizando..." : "☁️ Sincronizar respaldo"}</button>
        </div>
        {showClientCreateInline && (
          <form className="card quickClientForm" onSubmit={createClient}>
            <div className="quickClientFormHead"><strong>Nuevo cliente</strong><button type="button" className="miniButton" onClick={() => setShowClientCreateInline(false)}>Cerrar</button></div>
            <div className="quickClientGrid">
              <input placeholder="Nombre" value={clientForm.nombre} onChange={(e) => setClientForm({ ...clientForm, nombre: e.target.value })} required />
              <input placeholder="Usuario (ej. Alejandra45)" value={clientForm.username} onChange={(e) => setClientForm({ ...clientForm, username: e.target.value })} required />
              <input placeholder="Celular" value={clientForm.telefono} onChange={(e) => setClientForm({ ...clientForm, telefono: e.target.value })} />
              <input placeholder="Contraseña inicial" type="password" minLength={6} value={clientForm.password} onChange={(e) => setClientForm({ ...clientForm, password: e.target.value })} required />
            </div>
            <button className="miniButton primaryMini" disabled={working}>{working ? "Creando..." : "Crear cliente"}</button>
          </form>
        )}
        <input className="clientSearch" placeholder="Buscar cliente..." value={clientListQuery} onChange={(e) => setClientListQuery(e.target.value)} />
        {bulkDeleteBar("clientes", filteredClients.map((cliente) => cliente.id), "/api/admin/clientes", "cliente")}
        <div className="card clientTableCard">
          <div className="accountsTableScroll">
            <table className="clientTable">
              <thead>
                <tr>
                  {deleteMode["clientes"] && <th className="selectColumn">✓</th>}
                  <th>Nombre</th>
                  <th>Usuario</th>
                  <th>Celular</th>
                  <th>Servicios pedidos</th>
                  <th>Editar</th>
                  <th>WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((cliente) => {
                  const wa = clientWhatsappHref(cliente);
                  const editing = editingClientId === cliente.id;
                  return editing ? (
                    <tr key={cliente.id} className="clientEditRow">
                      {deleteMode["clientes"] && (
                      <td className="selectColumn"><input type="checkbox" checked={selectedDeleteIds("clientes").includes(cliente.id)} onChange={() => toggleDeleteSelection("clientes", cliente.id)} /></td>
                      )}
                      <td><input value={clientEditForm.nombre} onChange={(e) => setClientEditForm({ ...clientEditForm, nombre: e.target.value })} /></td>
                      <td><input value={clientEditForm.username} onChange={(e) => setClientEditForm({ ...clientEditForm, username: e.target.value })} /></td>
                      <td><input value={clientEditForm.telefono} onChange={(e) => setClientEditForm({ ...clientEditForm, telefono: e.target.value })} /></td>
                      <td><strong>{clientOrderCounts[cliente.id] || 0}</strong><small> pedidos</small></td>
                      <td>
                        <div className="clientEditActions">
                          <input className="passwordInline" type="password" minLength="6" placeholder="Nueva contraseña (opcional)" value={clientEditForm.password} onChange={(e) => setClientEditForm({ ...clientEditForm, password: e.target.value })} />
                          <button type="button" className="miniButton primaryMini" disabled={working} onClick={saveClientEdit}>Guardar</button>
                          <button type="button" className="miniButton" onClick={() => setEditingClientId("")}>Cancelar</button>
                          <button type="button" className="miniButton dangerMini" disabled={working} onClick={() => beginDeleteSelection("clientes", cliente.id)}>Borrar</button>
                        </div>
                      </td>
                      <td>{wa ? <a className="waTableButton" href={wa} target="_blank" rel="noreferrer">WhatsApp</a> : <span className="noPhone">Sin celular</span>}</td>
                    </tr>
                  ) : (
                    <tr key={cliente.id}>
                      {deleteMode["clientes"] && (
                      <td className="selectColumn"><input type="checkbox" checked={selectedDeleteIds("clientes").includes(cliente.id)} onChange={() => toggleDeleteSelection("clientes", cliente.id)} /></td>
                      )}
                      <td><strong>{cliente.nombre}</strong></td>
                      <td>{cliente.username ? `@${cliente.username}` : "—"}</td>
                      <td>{cliente.telefono || "—"}</td>
                      <td><span className="orderCountBadge">{clientOrderCounts[cliente.id] || 0}</span></td>
                      <td>
                        <div className="clientEditActions compact">
                          <button type="button" className="miniButton" onClick={() => beginClientEdit(cliente)}>Editar</button>
                          <button type="button" className="miniButton dangerMini" disabled={working} onClick={() => beginDeleteSelection("clientes", cliente.id)}>Borrar</button>
                        </div>
                      </td>
                      <td>{wa ? <a className="waTableButton" href={wa} target="_blank" rel="noreferrer">WhatsApp</a> : <span className="noPhone">Sin celular</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        {filteredClients.length === 0 && <div className="card emptyState">No encontramos clientes con esa búsqueda.</div>}
      </>
    );
  }

  function renderCrearCliente() {
    return (
      <>
        <div className="pageHeading"><p className="muted">Clientes</p><h1>Crear cliente</h1><p className="pageLead">Crea su acceso con usuario, celular y contraseña inicial. No necesita correo.</p></div>
        <form className="card adminForm standaloneForm" onSubmit={createClient}>
          <input placeholder="Nombre" value={clientForm.nombre} onChange={(e) => setClientForm({ ...clientForm, nombre: e.target.value })} required />
          <input placeholder="Usuario (ej. Alejandra45)" value={clientForm.username} onChange={(e) => setClientForm({ ...clientForm, username: e.target.value })} required />
          <input placeholder="Celular" value={clientForm.telefono} onChange={(e) => setClientForm({ ...clientForm, telefono: e.target.value })} />
          <input placeholder="Contraseña inicial" type="password" minLength={6} value={clientForm.password} onChange={(e) => setClientForm({ ...clientForm, password: e.target.value })} required />
          <button className="button primary" disabled={working}>{working ? "Creando..." : "Crear cliente"}</button>
        </form>
      </>
    );
  }

  function renderCrearStreaming() {
    function changeServiceType(form, setter, nextType) {
      const next = { ...form, tipo_entrega: nextType };
      if (nextType === "gemini") {
        next.duracion_tipo = "meses";
        next.duracion_cantidad = Math.min(Math.max(Number(form.duracion_cantidad) || 1, 1), 12);
      } else if (nextType !== "manual" && form.duracion_tipo === "anios") {
        next.duracion_tipo = "meses";
        next.duracion_cantidad = 12;
      }
      setter(next);
    }

    return (
      <>
        <div className="pageHeading"><p className="muted">Catálogo</p><h1>Crear servicio streaming</h1><p className="pageLead">Configura duración y tipo de entrega. Los servicios manuales no necesitan cuentas guardadas; ChatGPT, Gemini y estándar sí pueden usar el inventario.</p></div>
        <form className="card adminForm standaloneForm" onSubmit={createService}>
          <input placeholder="Nombre del servicio" value={serviceForm.nombre} onChange={(e) => setServiceForm({ ...serviceForm, nombre: e.target.value })} required />
          <textarea placeholder="Descripción (opcional)" value={serviceForm.descripcion} onChange={(e) => setServiceForm({ ...serviceForm, descripcion: e.target.value })} />
          <label>Tipo de entrega
            <select value={serviceForm.tipo_entrega} onChange={(e) => changeServiceType(serviceForm, setServiceForm, e.target.value)}>
              <option value="estandar">Cuenta estándar / perfiles</option>
              <option value="chatgpt">ChatGPT por cupos</option>
              <option value="gemini">Gemini por grupo familiar</option>
              <option value="manual">Manual / generado al momento</option>
            </select>
          </label>
          {deliveryDurationControls(serviceForm, setServiceForm, "servicio")}
          <div className="serviceResultPreview"><span>Resultado</span><strong>{serviceForm.nombre || "X servicio"} · {durationText(serviceForm.duracion_tipo, serviceForm.duracion_cantidad)} · {deliveryTypeLabel(serviceForm.tipo_entrega)}</strong></div>
          <button className="button primary" disabled={working}>{working ? "Creando..." : "Crear servicio streaming"}</button>
        </form>

      

        {data.servicios.length > 0 && (
          <section className="serviceCatalog">
            <h2>Servicios disponibles</h2>    
<div className="serviceSearchWrapper">
  <span className="serviceSearchIcon">🔍</span>

  <input
    type="text"
    placeholder="Buscar servicio..."
    value={serviceSearch}
    onChange={(e) => setServiceSearch(e.target.value)}
    className="serviceSearch"
  />
</div>

            {bulkDeleteBar("servicios", data.servicios.map((service) => service.id), "/api/admin/servicios", "servicio")}
            <div className="catalogGrid">
              {filteredServices.map((s) => {
                const duration = serviceDuration(s);
                return (
                  <div className="card catalogItem serviceManageCard" key={s.id}>
                    {deleteMode["servicios"] && (
                    <label className="cardSelectCheck"><input type="checkbox" checked={selectedDeleteIds("servicios").includes(s.id)} onChange={() => toggleDeleteSelection("servicios", s.id)} /> Seleccionar</label>
                    )}
                    {editingServiceId === s.id ? (
                      <form className="serviceEditForm" onSubmit={saveServiceEdit}>
                        <input value={serviceEditForm.nombre} onChange={(e) => setServiceEditForm({ ...serviceEditForm, nombre: e.target.value })} required />
                        <textarea value={serviceEditForm.descripcion} onChange={(e) => setServiceEditForm({ ...serviceEditForm, descripcion: e.target.value })} placeholder="Descripción" />
                        <label>Tipo de entrega
                          <select value={serviceEditForm.tipo_entrega} onChange={(e) => changeServiceType(serviceEditForm, setServiceEditForm, e.target.value)}>
                            <option value="estandar">Cuenta estándar / perfiles</option>
                            <option value="chatgpt">ChatGPT por cupos</option>
                            <option value="gemini">Gemini por grupo familiar</option>
                            <option value="manual">Manual / generado al momento</option>
                          </select>
                        </label>
                        {deliveryDurationControls(serviceEditForm, setServiceEditForm, "edición")}
                        <label className="toggleLine"><input type="checkbox" checked={serviceEditForm.activo} onChange={(e) => setServiceEditForm({ ...serviceEditForm, activo: e.target.checked })} /> Servicio activo</label>
                        <div className="inlineActions"><button className="miniButton primaryMini" disabled={working}>Guardar</button><button type="button" className="miniButton" onClick={() => setEditingServiceId("")}>Cancelar</button></div>
                      </form>
                    ) : (
                      <>
                        <strong>{s.nombre}</strong>
                        <span>{s.descripcion || "Sin descripción"}</span>
                        <b className="durationBadge">{durationText(duration.tipo, duration.cantidad)}</b>
                        <b className="deliveryTypeBadge">{deliveryTypeLabel(s.tipo_entrega)}</b>
                        <em>{s.activo ? "Activo" : "Inactivo"}</em>
                        <div className="inlineActions"><button type="button" className="miniButton" onClick={() => beginServiceEdit(s)}>Editar</button><button type="button" className="miniButton dangerMini" onClick={() => beginDeleteSelection("servicios", s.id)}>Borrar</button></div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </>
    );
  }

  function renderPromociones() {
    const rewardClient = (reward) => Array.isArray(reward.clientes) ? reward.clientes[0] : reward.clientes;

    return (
      <>
        <div className="pageHeading">
          <p className="muted">Marketing y fidelidad</p>
          <h1>{promotionTab === "premios" ? "Premios de fidelidad" : "Promociones diarias"}</h1>
          <p className="pageLead">{promotionTab === "premios" ? "Administra los premios que tus clientes desbloquean cada 10 pedidos." : "Publica ofertas para que tus clientes las vean al entrar a su panel. Puedes programarlas para un día o para un rango de fechas."}</p>
        </div>

        <div className="promoTabs">
          <button type="button" className={promotionTab === "promociones" ? "active" : ""} onClick={() => setPromotionTab("promociones")}>🎉 Promociones</button>
          <button type="button" className={promotionTab === "premios" ? "active" : ""} onClick={() => setPromotionTab("premios")}>🏆 Premios <b>{pendingLoyaltyRewards.length}</b></button>
        </div>

        {promotionTab === "promociones" ? (
          <>
            <form className="card adminForm promoForm" onSubmit={createPromotion}>
              <div className="twoCols">
                <label>Título<input placeholder="Ej. Disney + Max combo" value={promoForm.titulo} onChange={(e) => setPromoForm({ ...promoForm, titulo: e.target.value })} required /></label>
                <label>Precio / llamada (opcional)<input placeholder="Ej. $18.000" value={promoForm.precio} onChange={(e) => setPromoForm({ ...promoForm, precio: e.target.value })} /></label>
              </div>
              <label>Descripción<textarea placeholder="Ej. Solo por hoy. Pregunta por disponibilidad." value={promoForm.descripcion} onChange={(e) => setPromoForm({ ...promoForm, descripcion: e.target.value })} /></label>
              <div className="twoCols">
                <label>Desde<input type="date" value={promoForm.fecha_inicio} onChange={(e) => setPromoForm({ ...promoForm, fecha_inicio: e.target.value })} required /></label>
                <label>Hasta<input type="date" value={promoForm.fecha_fin} onChange={(e) => setPromoForm({ ...promoForm, fecha_fin: e.target.value })} required /></label>
              </div>
              <button className="button primary" disabled={working}>{working ? "Guardando..." : "Publicar promoción"}</button>
            </form>

            <section className="promoAdminList">
              <div className="sectionTitleRow"><h2>Promociones guardadas</h2><span>{todayPromotions.length} visibles hoy</span></div>
              {bulkDeleteBar("promociones", (data.promociones || []).map((promo) => promo.id), "/api/admin/promociones", "promoción")}
              {(data.promociones || []).length === 0 ? (
                <div className="card emptyState">Aún no has creado promociones.</div>
              ) : (
                <div className="promoAdminGrid">
                  {(data.promociones || []).map((promo) => (
                    <article className={`card promoAdminCard ${promotionIsToday(promo) ? "today" : ""}`} key={promo.id}>
                      {deleteMode["promociones"] && (
                      <label className="cardSelectCheck"><input type="checkbox" checked={selectedDeleteIds("promociones").includes(promo.id)} onChange={() => toggleDeleteSelection("promociones", promo.id)} /> Seleccionar</label>
                      )}
                      <div>
                        <small>{formatDate(promo.fecha_inicio)} → {formatDate(promo.fecha_fin)}</small>
                        <h3>{promo.titulo}</h3>
                        {promo.descripcion && <p>{promo.descripcion}</p>}
                        {promo.precio && <b>{promo.precio}</b>}
                      </div>
                      <div className="inlineActions">
                        <span className={promo.activo ? "status ok" : "status suspendedStatus"}>{promo.activo ? "Visible" : "Oculta"}</span>
                        <button type="button" className="miniButton" onClick={() => togglePromotion(promo)}>{promo.activo ? "Ocultar" : "Activar"}</button>
                        <button type="button" className="miniButton dangerMini" onClick={() => beginDeleteSelection("promociones", promo.id)}>Borrar</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="rewardsAdminWrap">
            <section className="card rewardSummaryCard">
              <div><span>🎁 Pendientes por entregar</span><b>{pendingLoyaltyRewards.length}</b></div>
              <div><span>✅ Redimidos visibles</span><b>{recentDeliveredRewards.length}</b></div>
              <p>Los premios marcados como entregados desaparecen de esta lista automáticamente después de 2 días, pero se conservan internamente para no volver a generarlos.</p>
            </section>

            <section className="rewardSection">
              <div className="sectionTitleRow"><h2>🚨 Pendientes por entregar</h2><span>{pendingLoyaltyRewards.length}</span></div>
              {pendingLoyaltyRewards.length === 0 ? <div className="card emptyState">No hay premios pendientes.</div> : (
                <div className="rewardGrid">{pendingLoyaltyRewards.map((reward) => {
                  const client = rewardClient(reward) || {};
                  return <article className="card rewardCard pending" key={reward.id}>
                    <div><small>Premio #{reward.ciclo_numero}</small><h3>{client.nombre || "Cliente"}</h3><p>@{client.username || "sin usuario"}{client.telefono ? ` · ${client.telefono}` : ""}</p><span>Desbloqueado: {reward.created_at ? new Date(reward.created_at).toLocaleDateString("es-CO") : "—"}</span></div>
                    <button type="button" className="button rewardDeliveredButton" disabled={working} onClick={() => markRewardDelivered(reward)}>✓ Marcar entregado</button>
                  </article>;
                })}</div>
              )}
            </section>

            <section className="rewardSection">
              <div className="sectionTitleRow"><h2>✅ Redimidos</h2><span>Se ocultan a los 2 días</span></div>
              {recentDeliveredRewards.length === 0 ? <div className="card emptyState">No hay premios entregados recientemente.</div> : (
                <div className="rewardGrid">{recentDeliveredRewards.map((reward) => {
                  const client = rewardClient(reward) || {};
                  return <article className="card rewardCard delivered" key={reward.id}>
                    <div><small>Premio #{reward.ciclo_numero}</small><h3>{client.nombre || "Cliente"}</h3><p>Entregado ✅</p><span>{reward.entregado_at ? new Date(reward.entregado_at).toLocaleString("es-CO") : "—"}</span></div>
                  </article>;
                })}</div>
              )}
            </section>
          </div>
        )}
      </>
    );
  }

  function renderInventario() {
    const deliveryWhatsapp = generatedDelivery?.cliente?.telefono
      ? whatsappUrl(generatedDelivery.cliente.telefono, generatedDelivery.text)
      : "";

    const selectedUploadService = data.servicios.find((service) => service.id === inventoryForm.servicio_id) || null;
    const uploadType = effectiveDeliveryType(selectedUploadService);
    const selectedSlots = availableSlots(selectedInventoryItem);
    const uploadProfiles = Math.max(1, Number(inventoryForm.cupos_total) || 1);
    const editService = data.servicios.find((service) => service.id === inventoryEditForm.servicio_id) || null;
    const editType = effectiveDeliveryType(editService);
    const editProfiles = Math.max(1, Number(inventoryEditForm.cupos_total) || 1);
    const replacementProfiles = Math.max(1, Number(replacementAccountForm.cupos_total) || 1);

    const inventoryServices = data.servicios
      .filter((service) => service.activo && effectiveDeliveryType(service) !== "manual")
      .slice()
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));

    const activeAssignments = (data.asignaciones || []).filter((assignment) => assignment.activo).map((assignment) => {
      const sub = enrichedSubs.find((item) => item.id === assignment.suscripcion_id) || null;
      const item = (data.inventario || []).find((account) => account.id === assignment.inventario_id) || null;
      return { ...assignment, sub, item };
    }).filter((assignment) => assignment.sub && assignment.item);

    function inventoryDurationControls(form, setter, type) {
      const durationType = type === "gemini" ? "meses" : (form.duracion_tipo === "meses" ? "meses" : "dias");
      const max = durationType === "dias" ? 30 : 12;
      return (
        <div className="durationControls">
          <label>Tiempo
            <select value={durationType} disabled={type === "gemini"} onChange={(e) => setter({ ...form, duracion_tipo: e.target.value, duracion_cantidad: 1 })}>
              {type !== "gemini" && <option value="dias">Días</option>}
              <option value="meses">Meses</option>
            </select>
          </label>
          <label>Cantidad
            <input type="number" min="1" max={max} inputMode="numeric" value={form.duracion_cantidad} onChange={(e) => setter({ ...form, duracion_tipo: durationType, duracion_cantidad: e.target.value })} onBlur={() => {
              const parsed = Number(form.duracion_cantidad);
              const fixed = Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : 1;
              setter({ ...form, duracion_tipo: durationType, duracion_cantidad: fixed });
            }} required />
          </label>
        </div>
      );
    }

    function accountOptionLabel(item) {
      const used = assignmentCountByInventory[item.id] || 0;
      const provider = providerInitials(item);
      const access = item.grupo || item.correo || "Cuenta";
      return `${access} · ${provider || "Sin proveedor"} · ${Number(item.cupos_total || 1) - used}/${item.cupos_total} libres`;
    }

    function updateProfilePin(setter, form, profile, value) {
      setter({
        ...form,
        perfiles_pins: { ...(form.perfiles_pins || {}), [String(profile)]: value }
      });
    }

    return (
      <>
        <div className="pageHeading">
          <p className="muted">Operación</p>
          <h1>Inventario y cuentas Streaming</h1>
          <p className="pageLead">Organiza cada tarea por separado: proveedores, añadir cuentas, stock y garantías. La entrega al cliente ahora se hace desde Generar nuevo pedido.</p>
        </div>

        <div className="inventorySubtabs" role="tablist" aria-label="Secciones de inventario">
          <button type="button" className={inventoryTab === "proveedores" ? "active" : ""} onClick={() => setInventoryTab("proveedores")}>Proveedores</button>
          <button type="button" className={inventoryTab === "cuentas" ? "active" : ""} onClick={() => setInventoryTab("cuentas")}>Añadir cuentas</button>
          <button type="button" className={inventoryTab === "stock" ? "active" : ""} onClick={() => setInventoryTab("stock")}>Stock disponible</button>
          <button type="button" className={inventoryTab === "garantias" ? "active" : ""} onClick={() => setInventoryTab("garantias")}>Cuentas Streaming</button>
        </div>

        {inventoryTab === "proveedores" && (
          <section className="providerManager card inventoryStandalone">
            <div className="formSectionTitle"><span>P</span><div><h2>Proveedores</h2><p>Agrega solo las iniciales, por ejemplo GP, J o AXM.</p></div></div>
            <form className="providerQuickForm" onSubmit={createProvider}>
              <input maxLength={8} placeholder="Iniciales (ej. GP)" value={providerForm.iniciales} onChange={(e) => setProviderForm({ iniciales: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} required />
              <button className="miniButton primaryMini" disabled={working}>Agregar proveedor</button>
            </form>
            {bulkDeleteBar("proveedores", (data.proveedores || []).filter((provider) => provider.activo !== false).map((provider) => provider.id), "/api/admin/proveedores", "proveedor")}
            <div className="providerList">
              <div className="providerListHead"><span>{deleteMode["proveedores"] ? "Seleccionar / Iniciales" : "Iniciales"}</span><span>Acción</span></div>
              {(data.proveedores || []).filter((provider) => provider.activo !== false).map((provider) => (
                <div className="providerListRow" key={provider.id}>
                  {deleteMode["proveedores"] ? (
                    <label className="providerSelectLabel"><input type="checkbox" checked={selectedDeleteIds("proveedores").includes(provider.id)} onChange={() => toggleDeleteSelection("proveedores", provider.id)} /><strong>{provider.iniciales}</strong></label>
                  ) : <strong>{provider.iniciales}</strong>}
                  <button type="button" className="miniButton dangerMini" onClick={() => beginDeleteSelection("proveedores", provider.id)}>Quitar</button>
                </div>
              ))}
              {(data.proveedores || []).filter((provider) => provider.activo !== false).length === 0 && <div className="emptyInline">Agrega tu primer proveedor.</div>}
            </div>
          </section>
        )}

        {inventoryTab === "cuentas" && (
          <form className="card adminForm inventoryForm inventoryStandalone" onSubmit={createInventoryItem}>
            <div className="formSectionTitle"><span>1</span><div><h2>Añadir cuenta disponible</h2><p>Busca el servicio escribiendo su nombre. Verás nombre y duración completos.</p></div></div>

            <label>Servicio
              <div className="autocompleteWrap">
                <input
                  placeholder="Escribe Netflix, Disney, ChatGPT..."
                  value={inventoryServiceQuery}
                  onChange={(e) => chooseInventoryServiceFromText(e.target.value)}
                  onFocus={() => setShowInventoryServiceMatches(true)}
                  onBlur={() => window.setTimeout(() => setShowInventoryServiceMatches(false), 150)}
                  autoComplete="off"
                  required
                />
                {showInventoryServiceMatches && inventoryUploadServiceMatches.length > 0 && (
                  <div className="autocompleteMenu serviceAutocompleteMenu">
                    {inventoryUploadServiceMatches.map((service) => (
                      <button type="button" key={service.id} onMouseDown={(e) => e.preventDefault()} onClick={() => selectInventoryUploadService(service)}>
                        <strong>{inventoryServiceLabel(service)}</strong>
                        <span>{service.descripcion || deliveryTypeLabel(effectiveDeliveryType(service))}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>
            {inventoryServiceQuery && !selectedUploadService && inventoryUploadServiceMatches.length === 0 && <div className="fieldHint warningHint">No hay coincidencias.</div>}

            <label>Proveedor
              <select value={inventoryForm.proveedor_id} onChange={(e) => setInventoryForm({ ...inventoryForm, proveedor_id: e.target.value })} required>
                <option value="">Seleccionar proveedor</option>
                {(data.proveedores || []).filter((provider) => provider.activo !== false).map((provider) => <option key={provider.id} value={provider.id}>{provider.iniciales}</option>)}
              </select>
            </label>

            {selectedUploadService && <div className="typeBanner"><strong>{inventoryServiceLabel(selectedUploadService)}</strong><span>{uploadType === "chatgpt"
    ? "Cupos configurables"
    : uploadType === "gemini"
    ? "Cupos configurables"
    : "Perfiles configurables"}</span></div>}
            {selectedUploadService && inventoryDurationControls(inventoryForm, setInventoryForm, uploadType)}

            {selectedUploadService && uploadType === "gemini" ? (
              <label>Correo del grupo<input placeholder="cpro567809@gmail.com" value={inventoryForm.grupo} onChange={(e) => setInventoryForm({ ...inventoryForm, grupo: e.target.value })} required /></label>
            ) : selectedUploadService ? (
              <div className="twoCols">
                <label>Correo / acceso<input placeholder={uploadType === "chatgpt" ? "c90917058+2207@gmail.com" : "cuenta@correo.com"} value={inventoryForm.correo} onChange={(e) => setInventoryForm({ ...inventoryForm, correo: e.target.value })} required /></label>
                <label>Contraseña (opcional)<input placeholder="Si aplica" value={inventoryForm.clave} onChange={(e) => setInventoryForm({ ...inventoryForm, clave: e.target.value })} /></label>
              </div>
            ) : null}

            {selectedUploadService && (
              <>
            <label className="numberProfilesTest">
  NÚMERO DE CUPOS / PERFILES
  <input
    type="number"
    min="1"
    value={inventoryForm.cupos_total || ""}
    onChange={(e) =>
      setInventoryForm({
        ...inventoryForm,
        cupos_total: e.target.value === "" ? "" : Number(e.target.value)
      })
    }
  />
</label>   
{uploadType === "estandar" && (
                <div className="profilePinsBox">
                  <div className="profilePinsTitle"><strong>PIN por perfil</strong><span>Opcional. Cada perfil puede tener un PIN diferente.</span></div>
                  <div className="profilePinsGrid">
                    {Array.from({ length: uploadProfiles }, (_, index) => index + 1).map((profile) => (
                      <label key={profile}>Perfil {profile}
                        <input inputMode="numeric" placeholder="Sin PIN" value={inventoryForm.perfiles_pins?.[String(profile)] || ""} onChange={(e) => updateProfilePin(setInventoryForm, inventoryForm, profile, e.target.value)} />
                      </label>
                    ))}
                  </div>
                </div>
                )}
              </>
            )}
            {selectedUploadService && (
  <div className="fixedCapacity">
    Cupos totales configurables: <strong>{uploadProfiles}</strong> · puedes definir la cantidad de cupos disponibles.
  </div>
)}

            <label>Fecha de carga<input type="date" value={inventoryForm.fecha_carga} onChange={(e) => setInventoryForm({ ...inventoryForm, fecha_carga: e.target.value })} /></label>
            <label>Nota adicional<textarea placeholder="Opcional: instrucciones internas, observaciones, etc." value={inventoryForm.notas} onChange={(e) => setInventoryForm({ ...inventoryForm, notas: e.target.value })} /></label>
            <button className="button primary" disabled={working || !selectedUploadService}>{working ? "Guardando..." : "Añadir cuenta disponible"}</button>
          </form>
        )}


        {inventoryTab === "stock" && (
          <section className="inventoryStockSection inventoryStandalone">
            <div className="sectionTitleRow"><h2>Stock disponible</h2></div>
            <div className="stockCards compactStockCards">
              {inventoryServices.map((service) => (
                <div className="card stockCard compactStockCard" key={service.id}>
                  <strong>{inventoryServiceLabel(service)}</strong>
                  <b>{inventoryByService[service.id] || 0}</b>
                  <span>disponibles</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {inventoryTab === "garantias" && (
          <>
            {replacementSourceItem && (
              <form id="guarantee-create-panel" className="card adminForm guaranteePanel guaranteeCreatePanel" onSubmit={createGuaranteeAndReplace}>
                <div className="formSectionTitle"><span>G</span><div><h2>Crear cuenta de garantía</h2><p>Ingresa aquí la cuenta nueva. Al guardarla se moverán automáticamente todos los perfiles/cupos activos de la cuenta fallida y se conservarán las fechas originales de compra.</p></div></div>

                <div className="guaranteeSourceSummary">
                  <div><small>Cuenta fallida</small><strong>{replacementSourceItem.grupo || replacementSourceItem.correo || "Cuenta actual"}</strong></div>
                  <span>{replacementSourceAssignments.length} entrega(s) activa(s)</span>
                </div>

                <div className="typeBanner guaranteeServiceBanner">
                  <strong>{inventoryServiceLabel(replacementService)}</strong>
                  <span>{`${replacementProfiles} perfiles configurados`}</span>
                </div>

                <label>Proveedor
                  <select value={replacementAccountForm.proveedor_id} onChange={(e) => setReplacementAccountForm({ ...replacementAccountForm, proveedor_id: e.target.value })} required>
                    <option value="">Seleccionar proveedor</option>
                    {(data.proveedores || []).filter((provider) => provider.activo !== false).map((provider) => <option key={provider.id} value={provider.id}>{provider.iniciales}</option>)}
                  </select>
                </label>

                {replacementService && inventoryDurationControls(replacementAccountForm, setReplacementAccountForm, replacementType)}

                {replacementService && replacementType === "gemini" ? (
                  <label>Correo del grupo<input placeholder="cpro567809@gmail.com" value={replacementAccountForm.grupo} onChange={(e) => setReplacementAccountForm({ ...replacementAccountForm, grupo: e.target.value })} required /></label>
                ) : replacementService ? (
                  <div className="twoCols">
                    <label>Correo / acceso<input placeholder={replacementType === "chatgpt" ? "cuenta@gmail.com" : "cuenta@correo.com"} value={replacementAccountForm.correo} onChange={(e) => setReplacementAccountForm({ ...replacementAccountForm, correo: e.target.value })} required /></label>
                    <label>Contraseña (opcional)<input placeholder="Si aplica" value={replacementAccountForm.clave} onChange={(e) => setReplacementAccountForm({ ...replacementAccountForm, clave: e.target.value })} /></label>
                  </div>
                ) : null}

                {replacementService && replacementType === "estandar" && (
                  <>
                    <label>Número de perfiles
                      <input type="number" min={Math.max(1, replacementSourceAssignments.length)} max="50" value={replacementAccountForm.cupos_total} onChange={(e) => setReplacementAccountForm({ ...replacementAccountForm, cupos_total: e.target.value })} onBlur={() => {
                        const parsed = Number(replacementAccountForm.cupos_total);
                        const minimum = Math.max(1, replacementSourceAssignments.length);
                        setReplacementAccountForm((prev) => ({ ...prev, cupos_total: Number.isInteger(parsed) && parsed >= minimum ? Math.min(parsed, 50) : minimum }));
                      }} required />
                    </label>
                    <div className="profilePinsBox">
                      <div className="profilePinsTitle"><strong>PIN por perfil</strong><span>Opcional. Puedes configurar un PIN distinto para cada perfil de la cuenta de garantía.</span></div>
                      <div className="profilePinsGrid">
                        {Array.from({ length: replacementProfiles }, (_, index) => index + 1).map((profile) => (
                          <label key={profile}>Perfil {profile}
                            <input inputMode="numeric" placeholder="Sin PIN" value={replacementAccountForm.perfiles_pins?.[String(profile)] || ""} onChange={(e) => updateProfilePin(setReplacementAccountForm, replacementAccountForm, profile, e.target.value)} />
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {replacementService && replacementType === "chatgpt" && <div className="fixedCapacity">Cupos totales: <strong>15</strong> · se conservarán los clientes y sus pedidos actuales.</div>}
                {replacementService && replacementType === "gemini" && <div className="fixedCapacity">Cupos totales: <strong>4</strong> · se conservarán los Gmail de cliente de cada entrega.</div>}

                <label>Fecha de carga<input type="date" value={replacementAccountForm.fecha_carga} onChange={(e) => setReplacementAccountForm({ ...replacementAccountForm, fecha_carga: e.target.value })} /></label>
                <label>Nota adicional<textarea placeholder="Opcional: motivo de la garantía, observaciones, etc." value={replacementAccountForm.notas} onChange={(e) => setReplacementAccountForm({ ...replacementAccountForm, notas: e.target.value })} /></label>

                <div className="guaranteeResultHint">
                  <strong>Resultado:</strong> la cuenta nueva aparecerá como <b>Cuenta de garantía</b> y debajo mostrará <b>cambio por {replacementSourceItem.grupo || replacementSourceItem.correo || "cuenta fallida"}</b>.
                </div>

                <div className="inlineActions">
                  <button type="submit" className="miniButton primaryMini" disabled={working}>{working ? "Creando garantía..." : "Crear cuenta de garantía y reemplazar"}</button>
                  <button type="button" className="miniButton" onClick={() => { setReplacementForm({ old_inventory_id: "" }); setReplacementAccountForm({ proveedor_id: "", correo: "", clave: "", pin: "", perfiles_pins: {}, grupo: "", cupos_total: "", duracion_tipo: "", duracion_cantidad: "", notas: "", fecha_carga: todayISO() }); }}>Cancelar</button>
                </div>
              </form>
            )}

            {generatedGuarantees.length > 0 && (
              <div className="guaranteeMessagesList">
                <div className="sectionTitleRow"><h2>Mensajes de garantía</h2><span>{generatedGuarantees.length} cliente(s)</span></div>
                {generatedGuarantees.map((guarantee) => {
                  const wa = guarantee.cliente?.telefono ? whatsappUrl(guarantee.cliente.telefono, guarantee.text) : "";
                  return (
                    <div className="generatedDelivery guaranteeGeneratedMessage" key={guarantee.id}>
                      <div className="generatedHeader"><div><strong>{guarantee.cliente?.nombre || "Cliente"}</strong><span>Mensaje de garantía · fecha original conservada</span></div></div>
                      <textarea readOnly value={guarantee.text} />
                      <div className="inlineActions"><button type="button" className="miniButton primaryMini" onClick={() => copyText(guarantee.text)}>Copiar texto</button>{wa && <a className="waTableButton" href={wa} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>}</div>
                    </div>
                  );
                })}
                <button type="button" className="miniButton" onClick={() => setGeneratedGuarantees([])}>Cerrar mensajes</button>
              </div>
            )}

            <section className="inventoryListSection">
              <div className="sectionTitleRow"><h2>Cuentas Streaming</h2><span>{streamingInventory.length} cuentas / grupos</span></div>

              {editingInventoryId && (
                <form className="card adminForm inventoryEditPanel" onSubmit={saveInventoryEdit}>
                  <h3>Editar cuenta</h3>
                  <div className="twoCols">
                    <label>Proveedor<select value={inventoryEditForm.proveedor_id || ""} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, proveedor_id: e.target.value })}>{(data.proveedores || []).filter((p) => p.activo !== false).map((p) => <option key={p.id} value={p.id}>{p.iniciales}</option>)}</select></label>
                    <label>Duración<select value={inventoryEditForm.duracion_tipo || "dias"} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, duracion_tipo: e.target.value, duracion_cantidad: 1 })}><option value="dias">Días</option><option value="meses">Meses</option></select></label>
                  </div>
                  <div className="twoCols"><input placeholder="Correo / acceso" value={inventoryEditForm.correo || ""} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, correo: e.target.value })} /><input placeholder="Grupo (Gemini)" value={inventoryEditForm.grupo || ""} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, grupo: e.target.value })} /></div>
                  <div className="twoCols"><input placeholder="Clave" value={inventoryEditForm.clave || ""} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, clave: e.target.value })} /><label>Cantidad de tiempo<input type="number" min="1" max={inventoryEditForm.duracion_tipo === "dias" ? 30 : 12} value={inventoryEditForm.duracion_cantidad || 1} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, duracion_cantidad: e.target.value })} /></label></div>
                  <label>Cupos / perfiles<input type="number" min="1" max="50" value={inventoryEditForm.cupos_total || 1} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, cupos_total: e.target.value })} /></label>
                  {editType === "estandar" && (
                    <div className="profilePinsBox">
                      <div className="profilePinsTitle"><strong>PIN por perfil</strong><span>Edita cada PIN de forma independiente.</span></div>
                      <div className="profilePinsGrid">
                        {Array.from({ length: editProfiles }, (_, index) => index + 1).map((profile) => (
                          <label key={profile}>Perfil {profile}
                            <input inputMode="numeric" placeholder="Sin PIN" value={inventoryEditForm.perfiles_pins?.[String(profile)] || ""} onChange={(e) => updateProfilePin(setInventoryEditForm, inventoryEditForm, profile, e.target.value)} />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <textarea placeholder="Notas" value={inventoryEditForm.notas || ""} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, notas: e.target.value })} />
                  <div className="inlineActions"><button className="miniButton primaryMini" disabled={working}>Guardar cambios</button><button type="button" className="miniButton" onClick={() => setEditingInventoryId("")}>Cancelar</button></div>
                </form>
              )}

              {streamingInventory.length > 0 && bulkDeleteBar("inventario", streamingInventory.map((item) => item.id), "/api/admin/inventario", "cuenta")}
              {streamingInventory.length === 0 ? <div className="card emptyState">Aún no hay cuentas cargadas.</div> : (
                <div className="card accountsTableCard"><div className="accountsTableScroll"><table className="accountsTable inventoryTable">
                  <thead><tr>{deleteMode["inventario"] && <th className="selectColumn">✓</th>}<th>Servicio</th><th>Proveedor</th><th>Cuenta / grupo</th><th>Vencimiento cuenta</th><th>Días cuenta</th><th>Cupos</th><th>Estado</th><th>Entregas activas</th><th>Acciones</th></tr></thead>
                  <tbody>
                    {streamingInventory.map((item) => {
                      const service = Array.isArray(item.servicios) ? item.servicios[0] : item.servicios;
                      const assignments = activeAssignments.filter((assignment) => assignment.inventario_id === item.id);
                      const used = assignments.length;
                      const guaranteeSource = guaranteeSourceAccount(item);
                      const displayState = item.estado === "fallida" ? "fallida" : guaranteeSource ? "cuenta de garantía" : (used >= Number(item.cupos_total || 1) ? "agotada" : "disponible");
                      const pinEntries = Object.entries(item.perfiles_pins || {}).filter(([, value]) => String(value || "").trim());
                      return (
                        <tr key={item.id}>
                          {deleteMode["inventario"] && (
                          <td className="selectColumn"><input type="checkbox" checked={selectedDeleteIds("inventario").includes(item.id)} onChange={() => toggleDeleteSelection("inventario", item.id)} /></td>
                          )}
                          <td><strong>{inventoryServiceLabel(service)}</strong><small>{deliveryTypeLabel(service?.tipo_entrega)}</small></td>
                          <td><span className="providerBadge">{providerInitials(item) || "—"}</span></td>
                          <td><strong>{item.grupo || item.correo || "—"}</strong>{item.clave && <details><summary>Ver clave</summary><code>{item.clave}</code></details>}{pinEntries.length > 0 && <details><summary>PIN por perfil</summary>{pinEntries.map(([profile, pin]) => <small key={profile}>Perfil {profile}: <b>{pin}</b></small>)}</details>}</td>
                          <td><strong>{formatDate(item.fecha_vencimiento)}</strong><small>{inventoryDurationText(item)}</small></td>
                          <td><span className={`daysBadge ${daysTone(daysRemaining(item.fecha_vencimiento))}`}>{remainingText(daysRemaining(item.fecha_vencimiento))}</span></td>
                          <td><strong>{used}/{item.cupos_total}</strong><small>{Math.max(0, Number(item.cupos_total || 1) - used)} libres</small></td>
                          <td><span className={displayState === "cuenta de garantía" ? "status guaranteeStatus" : displayState === "fallida" ? "status off" : displayState === "agotada" ? "status assignedStatus" : "status ok"}>{displayState}</span>{guaranteeSource && <small className="guaranteeSourceText">cambio por {guaranteeSource.grupo || guaranteeSource.correo || "cuenta anterior"}</small>}</td>
                          <td>
                            {assignments.length === 0 ? <span className="noPhone">Sin entregas</span> : <details className="assignmentDetails"><summary>{assignments.length} cliente(s) · {remainingText(Math.min(...assignments.map((assignment) => assignment.sub?.days ?? 999999)))}</summary>{assignments.map((assignment) => {
                              const guaranteeText = guaranteeSource ? buildGuaranteeWhatsappMessage(item, assignment, service) : "";
                              const guaranteeWa = guaranteeText && assignment.sub?.cliente?.telefono
                                ? whatsappUrl(assignment.sub.cliente.telefono, guaranteeText)
                                : "";
                              return (
                                <div className="assignmentRow inventoryAssignmentRow" key={assignment.id}>
                                  <span><b>{assignment.sub?.cliente?.nombre}</b> · {effectiveDeliveryType(service) === "estandar" ? "Perfil" : "Cupo"} {assignment.cupo_numero}{assignment.correo_cliente ? ` · ${assignment.correo_cliente}` : ""}<small className={`daysBadge ${daysTone(assignment.sub?.days)}`}>{remainingText(assignment.sub?.days)}</small></span>
                                  {guaranteeSource && guaranteeWa && <a className="waTableButton guaranteeWhatsappButton" href={guaranteeWa} target="_blank" rel="noreferrer">WhatsApp garantía</a>}
                                </div>
                              );
                            })}</details>}
                          </td>
                          <td><div className="tableActions accountInventoryActions">{inventoryAccountRenewalDropdown(item)}{assignments.length > 0 && <button type="button" className="miniButton guaranteeButton" onClick={() => beginReplacement(item)}>Reemplazar cuenta / garantía</button>}<button type="button" className="miniButton" onClick={() => beginInventoryEdit(item)}>Editar</button>{item.estado === "fallida" ? <button type="button" className="miniButton" onClick={() => reactivateInventory(item)}>Reactivar</button> : <button type="button" className="miniButton warningMini" onClick={() => markInventoryFailed(item)}>Fallida</button>}<button type="button" className="miniButton dangerMini" onClick={() => beginDeleteSelection("inventario", item.id)}>Borrar</button></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div></div>
              )}
            </section>
          </>
        )}
      </>
    );
  }

  if (loading) return <main className="page"><div className="card loadingCard">Cargando administración...</div></main>;

  return (
    <main className="adminShell">
      {copyNotice && <div className="copyToast" role="status" aria-live="polite">Texto copiado <span>✓</span></div>}
      <button className="mobileMenuButton" type="button" onClick={() => setMenuOpen(true)}><NavIcon name="menu" /><span>Menú</span></button>
      {menuOpen && <button className="sidebarBackdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}
      <aside className={menuOpen ? "adminSidebar open" : "adminSidebar"}>
        <div className="sidebarBrand" onClick={() => navigate("pedido")} role="button" tabIndex={0}>
          <img className="brandLogo sidebarLogo" src="/logo.jpg" alt="Juan Cuentas Streaming AXM" />
          <div className="sidebarBrandText"><strong>JUAN <span>CUENTAS</span></strong><small>Administrador</small></div>
        </div>
        <div className="sidebarSlogan">STREAMING · AXM</div>
        <nav className="sidebarNav">
          <p className="navLabel">PEDIDOS</p>
          <button className={view === "pedido" ? "active" : ""} onClick={() => navigate("pedido")}><NavIcon name="order" /><span className="navText">Generar nuevo pedido</span></button>
          <button className={view === "activas" ? "active" : ""} onClick={() => navigate("activas")}><NavIcon name="active" /><span className="navText">Cuentas activas</span><b>{stats.activos}</b></button>
          <button className={view === "vencidas" ? "active" : ""} onClick={() => navigate("vencidas")}><NavIcon name="expired" /><span className="navText">Cuentas vencidas</span><b className="expiredCount">{stats.vencidos}</b></button>
          <button className={view === "ganancias" ? "active" : ""} onClick={() => navigate("ganancias")}><NavIcon name="profit" /><span className="navText">Ganancias</span></button>
          <button className={view === "clientes" ? "active" : ""} onClick={() => navigate("clientes")}><NavIcon name="clients" /><span className="navText">Clientes</span><b>{stats.clientes}</b></button>
          <button className={view === "promociones" ? "active" : ""} onClick={() => navigate("promociones")}><NavIcon name="gift" /><span className="navText">Promociones</span><b>{todayPromotions.length}</b></button>
          <button className={view === "inventario" ? "active" : ""} onClick={() => navigate("inventario")}><NavIcon name="inventory" /><span className="navText">Inventario / Streaming</span><b>{availableInventory.length}</b></button>
          <p className="navLabel">GESTIÓN</p>
          <button className={view === "crearCliente" ? "active" : ""} onClick={() => navigate("crearCliente")}><NavIcon name="addClient" /><span className="navText">Crear cliente</span></button>
          <button className={view === "crearStreaming" ? "active" : ""} onClick={() => navigate("crearStreaming")}><NavIcon name="stream" /><span className="navText">Crear servicio streaming</span></button>
        </nav>
        <div className="sidebarFooter"><button type="button" onClick={logout}><NavIcon name="logout" /><span>Salir</span></button></div>
      </aside>

      <section className="adminMain">
        <header className="adminMainHeader">
          <div><span>Panel administrador</span><strong>{VIEW_TITLES[view]}</strong></div>
          <button className="linkButton desktopLogout" onClick={logout}>Salir</button>
        </header>
        <div className="adminPageContent">
          {error && <div className="errorBox wide">{error}</div>}
          {message && <div className="successBox">{message}</div>}
          {view === "pedido" && renderPedido()}
          {view === "activas" && renderActivas()}
          {view === "vencidas" && renderVencidas()}
          {view === "ganancias" && renderGanancias()}
          {view === "clientes" && renderClientes()}
          {view === "promociones" && renderPromociones()}
          {view === "inventario" && renderInventario()}
          {view === "crearCliente" && renderCrearCliente()}
          {view === "crearStreaming" && renderCrearStreaming()}
        </div>
      </section>
    </main>
  );
}