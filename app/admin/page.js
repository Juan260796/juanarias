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

// Determinar el tiempo real del pedido sin utilizar la duración del inventario.
function inferOrderDuration(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end || ""))) return { tipo: "meses", cantidad: 1 };
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const months = (ey - sy) * 12 + em - sm;
  if (months >= 12 && months % 12 === 0 && addDuration(start, "anios", months / 12) === end) return { tipo: "anios", cantidad: months / 12 };
  if (months >= 1 && addDuration(start, "meses", months) === end) return { tipo: "meses", cantidad: months };
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  return { tipo: "dias", cantidad: Math.max(1, days || 1) };
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

// Los pedidos nuevos pueden tener hasta 30 dias de vencidos.
// En Cuentas vencidas solo se muestran los pedidos vencidos hace 0 a 30 dias.
// Los mas antiguos siguen en Supabase para conservar ganancias y conteo historico.
function errorFechaPedidoVencido(fechaVencimiento) {
  const dias = daysRemaining(fechaVencimiento);
  if (dias === null) return "No se pudo calcular la fecha de vencimiento del pedido.";
  return dias < -30
    ? `No se puede crear este pedido: venció hace ${Math.abs(dias)} días. El máximo permitido para registrar un pedido vencido es 5 días. Corrige la fecha de inicio.`
    : "";
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
    .trim()
    .replace(/\s+/g, " ");
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
  return service?.nombre || "Servicio";
}

function inventoryServiceLabel(service) {
  return service?.nombre || "Servicio";
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

function isYoutubeService(service) {
  return normalizeText(service?.nombre || "").includes("youtube");
}

function isYoutubeFamilyInventory(item, service) {
  return isYoutubeService(service) && Boolean(String(item?.grupo || "").trim());
}

function isCapcutService(service) {
  const name = normalizeText(service?.nombre || "");
  return name.includes("capcut");
}

function withPurchaseThanks(message) {
  return `${String(message || "").trim()}\n\nGracias por tu compra y confianza 😁`;
}

// PIN 1 fijo; los demás combinan ceros con el número del perfil.
// Cada perfil obtiene un PIN de cuatro dígitos, sin repetir dentro de la cuenta.
function generateInventoryProfilePins(total) {
  const cantidad = Math.max(1, Math.min(99, Number(total) || 1));
  const pins = { "1": "1111" };
  const used = new Set(["1111"]);
  for (let perfil = 2; perfil <= cantidad; perfil++) {
    const digit = String(perfil);
    const options = digit.length === 1
      ? [
          `0${digit}${digit}0`, `${digit}00${digit}`, `${digit}0${digit}0`,
          `0${digit}0${digit}`, `${digit}000`, `00${digit}0`, `000${digit}`,
          `${digit}${digit}00`, `00${digit}${digit}`
        ]
      : [digit.padStart(4, "0"), digit.padEnd(4, "0"), `0${digit}0`];
    const available = options.filter(pin => pin.length === 4 && !used.has(pin));
    const pool = available.length ? available : [String(perfil).padStart(4, "0")];
    const pin = pool[Math.floor(Math.random() * pool.length)];
    pins[String(perfil)] = pin;
    used.add(pin);
  }
  return pins;
}

function inventoryGroupMessage(form, service, provider) {
  const nombre = String(service?.nombre || "Cuenta").trim();
  const tiempo = durationText(form.duracion_tipo || service?.duracion_tipo || "meses", form.duracion_cantidad || service?.duracion_cantidad || 1);
  const mes = new Intl.DateTimeFormat("es-CO", {month: "long"}).format(new Date());
  const encabezado = `${nombre} ${tiempo} (${mes}) (${provider?.iniciales || "Sin proveedor"})`;
  if (isYoutubeService(service) && form.grupo) {
    return `${encabezado}\n\nGrupo familiar: ${form.grupo}\nCupos: ${Number(form.cupos_total) || 1}`;
  }
  if (normalizeText(nombre).includes("emby")) {
    return `${encabezado}\n\nServidor: ${form.servidor || ""}\nUsuario: ${form.correo || ""}\nContraseña: ${form.clave || ""}\nPerfiles: ${Number(form.cupos_total) || 1}`;
  }
  const num = Math.max(1, Number(form.cupos_total) || 1);
  const pins = Array.from({ length: num }, (_, index) => form.perfiles_pins?.[String(index + 1)] || "");
  const hasPins = pins.some(pin => String(pin).trim());
  return `${encabezado}\n\nCorreo: ${form.correo || form.grupo || ""}\nContraseña: ${form.clave || ""}\nPerfil:${hasPins ? `\n${pins.map((pin, i) => `Pin ${pin || "(sin PIN)"}`).join("\n")}` : ""}`;
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
    templates: <><path {...common} d="M8 3h9l4 4v14H8zM17 3v5h4M11 12h7M11 16h7M3 7v14h12"/></>,
    logout: <><path {...common} d="M10 17l5-5-5-5"/><path {...common} d="M15 12H3"/><path {...common} d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></>,
    bulk: <><rect {...common} x="3" y="4" width="18" height="16" rx="2"/><path {...common} d="M3 10h18M9 10v10M15 10v10"/></>,
    menu: <><path {...common} d="M4 6h16M4 12h16M4 18h16"/></>
  };
  return <span className="navIcon" aria-hidden="true"><svg viewBox="0 0 24 24">{paths[name]}</svg></span>;
}

const CATALOG_CATEGORIES = [
  { key: "streaming", title: "Streaming y entretenimiento", icon: "▶" },
  { key: "ia", title: "IA, diseño y productividad", icon: "✦" },
  { key: "educacion", title: "Educación, lectura y herramientas", icon: "▤" },
  { key: "musica", title: "Música", icon: "♫" },
  { key: "otros", title: "Otros servicios", icon: "✧" },
];
function inferCatalogCategory(title) {
  const text = String(title || "").toLowerCase();
  if (/spotify|deezer/.test(text)) return "musica";
  if (/scrib|slide.?share|audible|coursera|duolingo/.test(text)) return "educacion";
  if (/capcut|chat\s*gpt|openai|gemini|muse|perplexity|leonardo|canva|adobe|photoshop|office|microsoft\s*365|autodesk|vpn/.test(text)) return "ia";
  if (/netflix|directv|emby|prime\s*video|amazon\s*prime|crunchy|plex|vix|hbo|\bmax\b|paramount|disney|apple\s*tv|viki|mubi|youtube|flujo/.test(text)) return "streaming";
  return "otros";
}
function catalogItemCategory(item) {
  return CATALOG_CATEGORIES.some(category => category.key === item?.categoria)
    ? item.categoria : inferCatalogCategory(item?.titulo);
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
  crearStreaming: "Crear servicio streaming",
  plantillas: "Plantillas de mensajes",
  cargaMasiva: "Carga masiva",
  catalogo: "Catálogo para clientes",
  dispositivos: "Dispositivos ChatGPT",
  renovar: "Renovar pedido"
};

const VALID_VIEWS = new Set(Object.keys(VIEW_TITLES));

function whatsappNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  // Los usuarios se escriben como @usuario y se conservan sin tratar como números.
  if (raw.startsWith("@")) return "";
  // Número nacional colombiano o número internacional, con espacios y símbolos opcionales.
  if (!/^[+\d\s().-]+$/.test(raw)) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return "";
}

function whatsappUrl(contacto, message = "") {
  const raw = String(contacto || "").trim();
  if (!raw) return "";
  const number = whatsappNumber(raw);
  const username = raw.replace(/^@/, "");
  // No redirigir accidentalmente a un destinatario inválido.
  if (!number && !/^[A-Za-z0-9._]{3,50}$/.test(username)) return "";
  const target = number || username;
  return `https://wa.me/${encodeURIComponent(target)}?text=${encodeURIComponent(message || "")}`;
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

// Fecha en mensajes: "17 octubre" (sin año).
function fechaCortaMensaje(value) {
  const fecha = parseISO(String(value || "").slice(0, 10));
  if (!fecha || Number.isNaN(fecha.getTime())) return "";
  const mes = new Intl.DateTimeFormat("es-CO", { month: "long", timeZone: "UTC" }).format(fecha);
  return `${fecha.getUTCDate()} ${mes}`;
}

// La fecha final es inclusiva: el día siguiente la promoción queda oculta.
function promotionExpired(promo) {
  return Boolean(promo?.fecha_fin) && String(promo.fecha_fin).slice(0, 10) < todayISO();
}

function promotionVisibleInAdmin(promo) {
  return promo?.activo !== false && !promotionExpired(promo);
}

function promotionIsToday(promo) {
  const today = todayISO();
  return promo?.activo !== false && String(promo?.fecha_inicio || "") <= today && String(promo?.fecha_fin || "") >= today;
}

const REGLAS_PREDETERMINADAS = `¡IMPORTANTE!
•⁠  ⁠⚠️ Uso apropiado
❌ No cambiar nombres
❌ No usarla en más de 1 dispositivo a la vez
❌Prohibido compartir la pantalla con otras personas
🚫Si viola alguna de las reglas, la pantalla quedará suspendida.🚫`;

const VARIABLES_PLANTILLA = ["cliente", "servicio", "tiempo", "correo", "clave", "perfil", "pin", "proveedor", "fecha_seleccionada", "fecha_vencimiento", "grupo", "correo_cliente", "servidor"];

// Una plantilla se comparte entre las duraciones del mismo servicio.
function claveServicioPlantilla(nombre) {
  // Una cuenta cargada para 1 año puede vender perfiles de 30 días.
  // La duración identifica el producto vendido, no una cuenta distinta.
  return normalizeText(nombre)
    .replace(/\s*(?:[-–—|]\s*)?\d+\s*(?:dias?|mes(?:es)?|anos?)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function aplicarPlantilla(contenido, datos) {
  return String(contenido || "").replace(/\{([a-z_]+)\}/gi, (texto, variable) =>
    Object.prototype.hasOwnProperty.call(datos, variable.toLowerCase())
      ? String(datos[variable.toLowerCase()] ?? "") : texto
  ).trim();
}

function bloquearScrollNumerico(event) {
  if (event.currentTarget === document.activeElement) {
    event.currentTarget.blur();
  }
}


// Emby almacena el servidor en notas para mantener compatibilidad con la base existente.
function extractEmbyServer(notes) {
  return String(notes || "").split(/\r?\n/).find(line => /^Servidor:\s*/i.test(line))?.replace(/^Servidor:\s*/i, "").trim() || "";
}
function stripEmbyServer(notes) {
  return String(notes || "").split(/\r?\n/).filter(line => !/^Servidor:\s*/i.test(line)).join("\n").trim();
}
function composeEmbyNotes(server, notes) {
  const rest = stripEmbyServer(notes);
  return [String(server || "").trim() ? `Servidor: ${String(server).trim()}` : "", rest].filter(Boolean).join("\n");
}

export default function Admin() {
  const [serviceSearch, setServiceSearch] = useState("");
  const [plantillaServicioId, setPlantillaServicioId] = useState("");
  const [plantillaNombre, setPlantillaNombre] = useState("");
  const [plantillaContenido, setPlantillaContenido] = useState("");
  const [plantillaPestana, setPlantillaPestana] = useState("crear");
  const [plantillaBusquedaServicio, setPlantillaBusquedaServicio] = useState("");
  const [plantillaBusquedaLista, setPlantillaBusquedaLista] = useState("");
  const [plantillaMostrarServicios, setPlantillaMostrarServicios] = useState(false);
  const [plantillaEditandoId, setPlantillaEditandoId] = useState("");
  const router = useRouter();
  const [token, setToken] = useState("");
  const [data, setData] = useState({ clientes: [], servicios: [], suscripciones: [], ganancias: [], promociones: [], premios_fidelidad: [], inventario: [], inventario_historico: [],inventario_externo: [], proveedores: [], asignaciones: [], order_counts: {}, plantillas_mensajes: [] });
  const filteredServices = data.servicios.filter((service) =>
  service.nombre.toLowerCase().includes(serviceSearch.toLowerCase())
);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [bulkKind, setBulkKind] = useState("clientes");
  const [bulkPaste, setBulkPaste] = useState("");
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReport, setBulkReport] = useState(null);
  const [copyNotice, setCopyNotice] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("pedido");
  const [menuOpen, setMenuOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [showClientMatches, setShowClientMatches] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");
  const [showServiceMatches, setShowServiceMatches] = useState(false);
  const [stockSearch, setStockSearch] = useState("");
  const [streamSearch, setStreamSearch] = useState("");
const [streamFilter, setStreamFilter] = useState("todos");
const [providerSearch, setProviderSearch] = useState("");
  const [clientListQuery, setClientListQuery] = useState("");
  const [clientAccess, setClientAccess] = useState(null);
  const [activeSearch, setActiveSearch] = useState("");
const [expiredSearch, setExpiredSearch] = useState("");
const [activeFilterField, setActiveFilterField] = useState("todos");
const [activeFilterValue, setActiveFilterValue] = useState("");
const [expiredFilterField, setExpiredFilterField] = useState("todos");
const [expiredFilterValue, setExpiredFilterValue] = useState("");
  const [showClientCreateInline, setShowClientCreateInline] = useState(false);
  const [clientForm, setClientForm] = useState({ nombre: "", username: "", telefono: "", password: "" });
  const [serviceForm, setServiceForm] = useState({ nombre: "", descripcion: "", duracion_tipo: "meses", duracion_cantidad: 1, tipo_entrega: "estandar" });
  const [subForm, setSubForm] = useState({
  cliente_id: "",
  servicio_id: "",
  fecha_inicio: todayISO(),
  duracion_tipo: "meses",
  duracion_cantidad: 1
});
  const [profitValue, setProfitValue] = useState("");
  const [profitTab, setProfitTab] = useState("diaria");
  const [expandedProfitDay, setExpandedProfitDay] = useState("");
const [editingProfitId, setEditingProfitId] = useState("");
const [profitEditValue, setProfitEditValue] = useState("");
  const [editingClientId, setEditingClientId] = useState("");
  const [clientEditForm, setClientEditForm] = useState({ nombre: "", username: "", telefono: "", password: "" });
  const [editingServiceId, setEditingServiceId] = useState("");
  const [serviceEditForm, setServiceEditForm] = useState({ nombre: "", descripcion: "", activo: true, duracion_tipo: "meses", duracion_cantidad: 1, tipo_entrega: "estandar" });
  const [renewalDrafts, setRenewalDrafts] = useState({});
  const [renewalProfits, setRenewalProfits] = useState({});
  const [renewalDates, setRenewalDates] = useState({});
  const [renewMenuId, setRenewMenuId] = useState("");
  const [renewalTargetId, setRenewalTargetId] = useState("");
  const [renewalNoticeOrigin, setRenewalNoticeOrigin] = useState(null);
  const [renewAccountMode, setRenewAccountMode] = useState({});
  const [renewSelectedInventory,setRenewSelectedInventory] = useState({});
  const [renewSelectedSlot, setRenewSelectedSlot] = useState({});
  const [renewSameAccountSlot, setRenewSameAccountSlot] = useState({});
  const [renewExternalDetails, setRenewExternalDetails] = useState({});
  const [inventoryRenewalDrafts, setInventoryRenewalDrafts] = useState({});
  const [inventoryRenewMenuId, setInventoryRenewMenuId] = useState("");
  const [promoForm, setPromoForm] = useState({ titulo: "", descripcion: "", precio: "", fecha_inicio: todayISO(), fecha_fin: todayISO(), activo: true });
  const [editingPromotionId, setEditingPromotionId] = useState("");
  const [promotionTab, setPromotionTab] = useState("promociones");
  const [promotionSearch, setPromotionSearch] = useState("");
  const [reactivatePromotionId, setReactivatePromotionId] = useState("");
  const [reactivatePromotionDays, setReactivatePromotionDays] = useState("1");
  const [providerForm, setProviderForm] = useState({ iniciales: "" });
  const [inventoryTab, setInventoryTab] = useState("proveedores");
  const [inventoryServiceQuery, setInventoryServiceQuery] = useState("");
  const [showInventoryServiceMatches, setShowInventoryServiceMatches] = useState(false);
  const [deliveryServiceQuery, setDeliveryServiceQuery] = useState("");
  const [showDeliveryServiceMatches, setShowDeliveryServiceMatches] = useState(false);
  const [deliveryClientQuery, setDeliveryClientQuery] = useState("");
  const [generatedInventoryGroupMessage, setGeneratedInventoryGroupMessage] = useState("");
  const [inventoryForm, setInventoryForm] = useState({ servidor: "", servicio_id: "", proveedor_id: "", correo: "", clave: "", pin: "", perfiles_pins: {}, grupo: "", cupos_total: "", duracion_tipo: "", duracion_cantidad: "", notas: "", fecha_carga: todayISO() });
  const [deliveryForm, setDeliveryForm] = useState({ servicio_id: "", cliente_id: "", inventario_id: "", cupo_numero: "", correo_cliente: "", fecha_inicio: todayISO() });
  const [orderSource, setOrderSource] = useState("external");
  const [youtubeExternalMode, setYoutubeExternalMode] = useState("grupo");
  const [externalOrderForm, setExternalOrderForm] = useState({ servidor: "", proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "", grupo: "", correo_cliente: "" });
  const [generatedDelivery, setGeneratedDelivery] = useState(null);
  // Se conserva solamente durante la creación del pedido. Nunca se recupera
  // ni se almacena en la base de datos la contraseña anterior del cliente.
  const [newClientAccess, setNewClientAccess] = useState(null);
  const [renewalDelivery, setRenewalDelivery] = useState(null);
  const [generatedGuarantees, setGeneratedGuarantees] = useState([]);
  const [replacementForm, setReplacementForm] = useState({ old_inventory_id: "" });
  const [replacementAccountForm, setReplacementAccountForm] = useState({ proveedor_id: "", correo: "", clave: "", pin: "", perfiles_pins: {}, grupo: "", cupos_total: "", duracion_tipo: "", duracion_cantidad: "", notas: "", fecha_carga: todayISO() });
  const [editingInventoryId, setEditingInventoryId] = useState("");
  const [inventoryEditForm, setInventoryEditForm] = useState({});
  const [editingSubscriptionId, setEditingSubscriptionId] = useState("");
  const [editingCredentialsId, setEditingCredentialsId] = useState("");
  const [credentialsEdit, setCredentialsEdit] = useState({});
  const [managedInventoryNotices, setManagedInventoryNotices] = useState([]);
  const [selectedInventoryNotices, setSelectedInventoryNotices] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogEditId, setCatalogEditId] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState("todos");
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState("todas");
  const [catalogForm, setCatalogForm] = useState({ titulo: "", descripcion: "", duracion: "", precio: "", orden: 0, activo: true, categoria: "otros" });
  const [deviceRecords, setDeviceRecords] = useState([]);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [deviceOnlyPending, setDeviceOnlyPending] = useState(false);
  const [deviceOrderId, setDeviceOrderId] = useState("");
  const [deviceForm, setDeviceForm] = useState({ tipo: "Celular", dispositivo: "", identificador: "", notas: "" });

  const [inventoryAssignmentPage, setInventoryAssignmentPage] = useState({});
  const [subscriptionEditForm, setSubscriptionEditForm] = useState({ fecha_inicio: "", servicio_id: "", cupo_numero: "", duracion_tipo: "meses", duracion_cantidad: 1 });
  const [deleteSelection, setDeleteSelection] = useState({ suscripciones: [], clientes: [], servicios: [], promociones: [], proveedores: [], inventario: [] });
  const [deleteMode, setDeleteMode] = useState({});
  const [showCredentialsId, setShowCredentialsId] = useState("");

  // Consultar la sesión vigente en cada solicitud: Supabase renueva los tokens
  // automáticamente, pero guardar uno en estado puede dejarlo desactualizado.
  const api = useCallback(async (path, options = {}, accessToken = null) => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw new Error("No se pudo comprobar la sesión. Intenta nuevamente.");

    const send = async (bearer) => {
      const res = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
          Authorization: `Bearer ${bearer}`
        }
      });
      const json = await res.json().catch(() => ({}));
      return { res, json };
    };

    let bearer = sessionData?.session?.access_token || accessToken;
    if (!bearer) throw new Error("Tu sesión ha terminado. Inicia sesión nuevamente.");

    let { res, json } = await send(bearer);
    if (res.status === 401) {
      // Si el token venció durante la operación, renovarlo y reintentar una vez.
      const { data: renewed, error: renewError } = await supabase.auth.refreshSession();
      const freshToken = renewed?.session?.access_token;
      if (renewError || !freshToken) {
        throw new Error("Tu sesión ha terminado. Inicia sesión nuevamente.");
      }
      ({ res, json } = await send(freshToken));
    }
    if (!res.ok) throw new Error(json.error || "Ocurrió un error.");
    return json;
  }, []);

  async function marcarReportada(id) {
  try {
    

    await api("/api/admin/suscripciones", {
      method: "PATCH",
      body: JSON.stringify({
        id,
        action: "marcar_reportada"
      })
    });

    await refresh();

  } catch (error) {
    
  }
}

  const refresh = useCallback(async (accessToken = token) => {
    // Persistir como ocultas las promociones cuya fecha final ya pasó.
    // Solo afecta promociones; no cambia pedidos, clientes ni ganancias.
    await api("/api/admin/promociones/expirar", {}, accessToken);
    const result = await api(`/api/admin/data?today=${todayISO()}`, {}, accessToken);
    setData(result);
    // Estas herramientas son independientes de la carga principal.
    // Si falta la migración, siguen funcionando las demás secciones.
    const [catalogRes, deviceRes] = await Promise.allSettled([
      api("/api/admin/catalogo", {}, accessToken),
      api("/api/admin/dispositivos", {}, accessToken)
    ]);
    if (catalogRes.status === "fulfilled") setCatalogItems(catalogRes.value.items || []);
    if (deviceRes.status === "fulfilled") setDeviceRecords(deviceRes.value.dispositivos || []);

    try {
      const notices = await api("/api/admin/avisos-inventario", {}, accessToken);
      setManagedInventoryNotices(notices.gestionados || []);
    } catch (noticeError) {
      // El panel seguirá cargando si la migración de avisos aún no se ha ejecutado.
      console.warn("No se pudieron consultar los avisos gestionados:", noticeError);
    }
  }, [api, token]);

  // Si el administrador deja el panel abierto durante la noche, revisar
  // las promociones al cambiar de día sin exigir Ctrl + F5.
  useEffect(() => {
    if (!token) return undefined;
    let lastCheckedDay = todayISO();
    const timer = window.setInterval(() => {
      const nextDay = todayISO();
      if (nextDay !== lastCheckedDay) {
        lastCheckedDay = nextDay;
        refresh().catch((err) => setError(err.message || "No se pudieron actualizar las promociones."));
      }
    }, 60000);
    return () => window.clearInterval(timer);
  }, [token, refresh]);

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

  // Los avisos aparecen sin desplazar la pantalla y desaparecen suavemente.
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!error) return undefined;
    const timer = window.setTimeout(() => setError(""), 10000);
    return () => window.clearTimeout(timer);
  }, [error]);

  function iconoAviso(texto, esError = false) {
    if (esError) return "⚠️";
    const t = normalizeText(texto);
    if (/elimin|borrad|quitad/.test(t)) return "🗑️";
    if (/renovad|renovaci/.test(t)) return "🔄";
    if (/cliente/.test(t)) return "👤";
    if (/cuenta|inventario|perfil|stock/.test(t)) return "📦";
    if (/pedido|entrega/.test(t)) return "🎉";
    if (/ganancia/.test(t)) return "💰";
    if (/guardad|actualizad|cread/.test(t)) return "✅";
    return "✨";
  }


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
    const servicio = Array.isArray(s.servicio) ? s.servicio[0] : s.servicio;
    const days = daysRemaining(s.fecha_vencimiento);
    const expired = Boolean(s.fecha_vencimiento && days !== null && days <= 0);
    const active = Boolean(s.activo) && Boolean(servicio?.activo !== false) && !expired;
    return { ...s, cliente, servicio, days, expired, active };
  }), [data.suscripciones]);

  const activeSubs = useMemo(() => enrichedSubs
    .filter((s) => Boolean(s.activo) && Boolean(s.servicio?.activo !== false) && s.days !== null && s.days >= 1)
    .sort((a, b) => (a.days ?? 999999) - (b.days ?? 999999)), [enrichedSubs]);

  // Mostrar el historial completo de vencidos, incluso pedidos archivados
  // automaticamente (activo=false). El archivado solo libera los cupos.
  const expiredSubs = useMemo(() => enrichedSubs
  .filter((s) =>
    s.servicio?.activo !== false &&
    s.days !== null &&
    s.days <= 0 &&
    s.days >= -30
  )
  .sort((a, b) => (b.days ?? -999999) - (a.days ?? -999999)),
[enrichedSubs]);

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
    .filter(
      (service) =>
        service.activo &&
        effectiveDeliveryType(service) !== "manual"
    )
    .slice()
    .sort((a, b) =>
      String(a.nombre || "").localeCompare(
        String(b.nombre || ""),
        "es"
      )
    );

  // Quitar servicios duplicados por nombre
  const uniqueServices = [];
  const seenNames = new Set();

  for (const service of source) {
    const key = normalizeText(service.nombre || "");

    if (seenNames.has(key)) continue;

    seenNames.add(key);
    uniqueServices.push(service);
  }

  if (!q) {
    return uniqueServices.slice(0, 8);
  }

  return uniqueServices
    .filter((service) =>
      normalizeText(
        `${service.nombre || ""} ${inventoryServiceLabel(service)} ${service.descripcion || ""}`
      ).includes(q)
    )
    .slice(0, 8);
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

  // Avisos de baja manual: los perfiles se liberan en el panel automáticamente,
  // pero el administrador todavía debe retirarlos en la plataforma oficial.
  const inventoryExpiryNotices = useMemo(() => {
    const subscriptions = new Map(enrichedSubs.map(sub => [sub.id, sub]));
    const inventory = new Map((data.inventario_historico || data.inventario || []).map(item => [item.id, item]));
    // Escoger la última entrega de cada pedido: una cuenta antigua que ya fue
    // reemplazada no debe provocar avisos falsos.
    const latest = new Map();
    for (const assignment of data.asignaciones || []) {
      if (!assignment.suscripcion_id || latest.has(assignment.suscripcion_id)) continue;
      latest.set(assignment.suscripcion_id, assignment);
    }
    return [...latest.values()]
      .map(assignment => ({ assignment, sub: subscriptions.get(assignment.suscripcion_id), account: inventory.get(assignment.inventario_id) }))
      .filter(({ sub, account, assignment }) => sub && account && account.etiqueta !== "externa" && sub.days !== null && sub.days <= 0 && sub.days >= -30 && !managedInventoryNotices.includes(`${assignment.id}:${sub.fecha_vencimiento}`))
      .sort((a, b) => (a.sub.days ?? 0) - (b.sub.days ?? 0));
  }, [data.asignaciones, data.inventario, data.inventario_historico, enrichedSubs, managedInventoryNotices]);

  const assignmentCountByInventory = useMemo(() => {
    const counts = {};
    for (const assignment of (data.asignaciones || [])) {
      if (assignment.activo) counts[assignment.inventario_id] = (counts[assignment.inventario_id] || 0) + 1;
    }
    return counts;
  }, [data.asignaciones]);

  const activeAssignmentBySubscription = useMemo(() => {
  const map = {};

  const allInventory = [
    ...(data.inventario || []),
    ...(data.inventario_externo || [])
  ];

  for (const assignment of (data.asignaciones || [])) {
    if (!assignment.activo) continue;

    const item =
      allInventory.find(
        (account) => account.id === assignment.inventario_id
      ) || null;

    map[assignment.suscripcion_id] = {
      ...assignment,
      item,
    };
  }

  return map;
}, [
  data.asignaciones,
  data.inventario,
  data.inventario_externo
]);

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

  // El stock disponible depende de cupos realmente libres, no de la duracion
  // historica de la cuenta (que puede estar vacia o ser diferente de la venta).
  // Coincidencia por nombre normalizado para las variantes de duración del servicio.
  const deliveryInventoryOptions = useMemo(() => {
    if (!selectedDeliveryService) return [];
    const serviceKey = (nombre) => claveServicioPlantilla(nombre || "");
    const selectedKey = serviceKey(selectedDeliveryService.nombre);
    return availableInventory.filter((item) => {
      const inventarioServicio = data.servicios.find((service) => String(service.id) === String(item.servicio_id));
      const nombreInventario = inventarioServicio?.nombre || item.servicios?.nombre || "";
      return Boolean(nombreInventario && serviceKey(nombreInventario) === selectedKey);
    });
  }, [availableInventory, selectedDeliveryService, data.servicios]);

  const selectedInventoryItem = useMemo(
    () => (data.inventario || []).find((item) => item.id === deliveryForm.inventario_id) || null,
    [data.inventario, deliveryForm.inventario_id]
  );

  const inventoryByService = useMemo(() => {
  const counts = {};

  for (const item of availableInventory) {
    const service = data.servicios.find(
      (s) => s.id === item.servicio_id
    );

    if (!service) continue;

    const key = service.nombre.trim().toLowerCase();

    counts[key] = (counts[key] || 0) + 
      (item.cupos_total || 0) - 
      (assignmentCountByInventory[item.id] || 0);
  }

  return counts;
}, [availableInventory, assignmentCountByInventory, data.servicios]);

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

  async function bulkDelete(kind, endpoint, label, visibleIds) {
    // Proteger registros fuera del filtro activo: nunca borrar selección oculta.
    const visibleSet = new Set(visibleIds);
    const ids = selectedDeleteIds(kind).filter((id) => visibleSet.has(id));
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
    const visibleSet = new Set(visibleIds);
    const selected = selectedDeleteIds(kind).filter((id) => visibleSet.has(id));

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
            <button type="button" className="miniButton dangerMini" disabled={working} onClick={() => bulkDelete(kind, endpoint, label, visibleIds)}>Borrar seleccionados</button>
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
      duracion_tipo: service.duracion_tipo || (type === "gemini" ? "meses" : "dias"),
      duracion_cantidad: Number(service.duracion_cantidad || (type === "gemini" ? 1 : 30)),
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
    correo_cliente: "",
    duracion_tipo: service.duracion_tipo || "meses",
    duracion_cantidad: Number(service.duracion_cantidad || 1)
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

  const duplicateClientByName = (data.clientes || []).find(
    (cliente) => normalizeText(cliente.nombre) === normalizeText(clientForm.nombre) && normalizeText(clientForm.nombre)
  );

  async function createClient(e) {
    e.preventDefault();
    if (duplicateClientByName) {
      setError(`Ya existe un cliente con ese nombre: ${duplicateClientByName.nombre}. Busca al cliente existente antes de crear otro.`);
      return;
    }
    await runAction(async () => {
      const result = await api("/api/admin/clientes", { method: "POST", body: JSON.stringify(clientForm) });
      const created = result?.cliente;
      if (!created?.id) throw new Error("El cliente se creó, pero no se recibió su identificador. Recarga antes de crear el pedido.");
      // Contraseña temporal disponible únicamente para la primera entrega.
      setNewClientAccess({ id: created.id, password: clientForm.password });
      setSubForm((prev) => ({ ...prev, cliente_id: created.id }));
      setDeliveryForm((prev) => ({ ...prev, cliente_id: created.id }));
      setClientQuery(created.nombre || created.username || "");
      await refresh(token);
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

  function clearPromotionEdit() {
    setEditingPromotionId("");
    setPromoForm({ titulo: "", descripcion: "", precio: "", fecha_inicio: todayISO(), fecha_fin: todayISO(), activo: true });
  }

  function beginPromotionEdit(promo) {
    setEditingPromotionId(String(promo.id));
    setPromoForm({
      titulo: promo.titulo || "",
      descripcion: promo.descripcion || "",
      precio: promo.precio || "",
      fecha_inicio: promo.fecha_inicio || todayISO(),
      fecha_fin: promo.fecha_fin || todayISO(),
      activo: promo.activo !== false
    });
    document.getElementById("promocion-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function createPromotion(e) {
    e.preventDefault();
    if (promoForm.fecha_fin < promoForm.fecha_inicio) {
      setError("La fecha final no puede ser anterior a la inicial.");
      return;
    }
    await runAction(async () => {
      await api("/api/admin/promociones", {
        method: editingPromotionId ? "PATCH" : "POST",
        body: JSON.stringify(editingPromotionId
          ? { ...promoForm, activo: promotionExpired(promoForm) ? false : promoForm.activo, id: editingPromotionId }
          : { ...promoForm, activo: !promotionExpired(promoForm) })
      });
      clearPromotionEdit();
    }, editingPromotionId ? "Promoción actualizada correctamente." : "Promoción guardada correctamente.");
  }

  async function togglePromotion(promo) {
    if (!promotionVisibleInAdmin(promo) && promotionExpired(promo)) {
      setError("Esta promoción ya venció. Edita sus fechas antes de activarla nuevamente.");
      return;
    }
    await runAction(
      () => api("/api/admin/promociones", {
        method: "PATCH",
        body: JSON.stringify({ ...promo, activo: !promotionVisibleInAdmin(promo) })
      }),
      promotionVisibleInAdmin(promo) ? "Promoción oculta." : "Promoción activada."
    );
  }

  async function reactivatePromotion(promo) {
    const days = Number(reactivatePromotionDays);
    if (!Number.isSafeInteger(days) || days < 1 || days > 36500) {
      setError("Escribe una cantidad válida de días (mínimo 1).");
      return;
    }
    // Día 1 es hoy; la fecha final es inclusiva.
    const start = todayISO();
    const end = new Date(parseISO(start));
    end.setDate(end.getDate() + days - 1);
    await runAction(async () => {
      await api("/api/admin/promociones", {
        method: "PATCH",
        body: JSON.stringify({ ...promo, fecha_inicio: start, fecha_fin: toISO(end), activo: true })
      });
      setReactivatePromotionId("");
      setReactivatePromotionDays("1");
    }, `Promoción activada durante ${days} día${days === 1 ? "" : "s"}.`);
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
      const formSnapshot = { ...inventoryForm, perfiles_pins: { ...inventoryForm.perfiles_pins } };
      const serviceSnapshot = (data.servicios || []).find(s => s.id === formSnapshot.servicio_id);
      const providerSnapshot = (data.proveedores || []).find(p => p.id === formSnapshot.proveedor_id);
      if (isYoutubeService(serviceSnapshot) && !String(formSnapshot.grupo || "").trim()) {
        throw new Error("Escribe el nombre del grupo familiar de YouTube.");
      }
      if (normalizeText(serviceSnapshot?.nombre).includes("emby") && !String(formSnapshot.servidor || "").trim()) throw new Error("Escribe el servidor Emby.");
      await api("/api/admin/inventario", { method: "POST", body: JSON.stringify({ ...formSnapshot, notas: composeEmbyNotes(formSnapshot.servidor, formSnapshot.notas) }) });
      setGeneratedInventoryGroupMessage(inventoryGroupMessage(formSnapshot, serviceSnapshot, providerSnapshot));
      setInventoryForm({ servicio_id: "", proveedor_id: "", correo: "", clave: "", pin: "", perfiles_pins: {}, grupo: "", cupos_total: "", duracion_tipo: "", duracion_cantidad: "", notas: "", fecha_carga: todayISO() });
      setInventoryServiceQuery("");
      setShowInventoryServiceMatches(false);
    }, "Cuenta agregada al inventario.");
  }

  async function saveInventoryEdit(e) {
    e.preventDefault();
    await runAction(async () => {
      const editServiceData = (data.servicios || []).find(s => s.id === inventoryEditForm.servicio_id);
      await api("/api/admin/inventario", { method: "PATCH", body: JSON.stringify({ id: editingInventoryId, ...inventoryEditForm,
        ...(normalizeText(editServiceData?.nombre).includes("emby") ? { notas: composeEmbyNotes(inventoryEditForm.servidor, inventoryEditForm.notas) } : {})
      }) });
      setEditingInventoryId("");
      setInventoryEditForm({});
    }, "Cuenta actualizada.");
  }

  function beginInventoryEdit(item) {
  setEditingInventoryId(item.id);
  // Esperamos a que React muestre el formulario antes de desplazar la pantalla.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.getElementById("inventory-edit-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  setInventoryEditForm({
    servicio_id: item.servicio_id || "",
    proveedor_id: item.proveedor_id || "",
    correo: item.correo || "",
    cupos_total: item.cupos_total || 1,
    duracion_tipo: item.duracion_tipo || "dias",
    duracion_cantidad: item.duracion_cantidad || 1,
    fecha_carga: item.fecha_carga || "",
    servidor: extractEmbyServer(item.notas),
    notas: stripEmbyServer(item.notas),
    clave: item.clave || "",
    grupo: item.grupo || "",
    perfiles_pins: item.perfiles_pins || {}
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
    const durationLabel = inventoryDurationText(item);
    const provider = providerInitials(item);
    const providerTag = provider ? ` (${provider})` : "";
    const purchaseDate = formatLongDate(sub.fecha_inicio);
    const cupo = assignmentData.cupo_numero || deliveryForm.cupo_numero || 1;
    const clientEmail = assignmentData.correo_cliente || deliveryForm.correo_cliente || "";
    const profilePin = item.perfiles_pins?.[String(cupo)] || item.pin || "";
    const plantilla = (data.plantillas_mensajes || []).find((entry) => {
      if (entry.activo === false) return false;
      const servicioPlantilla = (data.servicios || []).find((srv) => srv.id === entry.servicio_id);
      return servicioPlantilla && claveServicioPlantilla(servicioPlantilla.nombre) === claveServicioPlantilla(service?.nombre);
    });
    if (plantilla?.contenido) {
      const datos = {
        cliente, servicio: service?.nombre || "Servicio", tiempo: durationLabel,
        correo: item.correo || "", clave: item.clave || "", perfil: String(cupo || ""),
        pin: profilePin, proveedor: provider,
        // Fecha elegida por el usuario para la compra (no created_at ni fecha actual).
        fecha_seleccionada: fechaCortaMensaje(sub.fecha_inicio),
        // Las plantillas antiguas siguen funcionando, pero ahora usan la fecha elegida.
        fecha_creacion: fechaCortaMensaje(sub.fecha_inicio),
        fecha_inicio: fechaCortaMensaje(sub.fecha_inicio),
        fecha_vencimiento: formatDate(sub.fecha_vencimiento), grupo: item.grupo || "",
        correo_cliente: clientEmail,
        servidor: extractEmbyServer(item.notas)
      };
      return withPurchaseThanks(aplicarPlantilla(plantilla.contenido, datos));
    }

    // Los mensajes específicos de ChatGPT, Gemini y CapCut ya no están
    // codificados aquí. Se administran desde Plantillas de mensajes en Supabase.
    // Solo se aplica el mensaje general cuando no exista plantilla personalizada.

    const pinLine = profilePin ? `\nPIN: ${profilePin}` : "";
    const profileLine = cupo ? `\nPERFIL ${cupo}` : "";
    const notes = "";
    return withPurchaseThanks(`${service?.nombre || "Servicio"} x${durationLabel} (${purchaseDate})${providerTag}

${normalizeText(service?.nombre).includes("emby") ? `SERVIDOR: ${extractEmbyServer(item.notas)}\nUSUARIO` : "CORREO"}: ${item.correo || ""}
CLAVE: ${item.clave || ""}${profileLine}${pinLine}

${REGLAS_PREDETERMINADAS}

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
    const errorFecha = errorFechaPedidoVencido(addDuration(deliveryForm.fecha_inicio || todayISO(), selectedDeliveryService?.duracion_tipo || "meses", Number(selectedDeliveryService?.duracion_cantidad || 1)));
    if (errorFecha) { setError(errorFecha); return; }
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
    if ((effectiveDeliveryType(selectedService) === "gemini" || isYoutubeFamilyInventory(selectedInventoryItem, selectedService)) && !String(deliveryForm.correo_cliente || "").trim()) {
      setError("Escribe el correo Gmail que te proporcionó el cliente para el grupo familiar.");
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
  servicio_id: selectedDeliveryService.id,
  cliente_id: selectedDeliveryClient.id,
  fecha_inicio: deliveryForm.fecha_inicio || todayISO(),
  cupo_numero: chosenSlot,
  correo_cliente: deliveryForm.correo_cliente,
  ganancia_neta: Number(profitValue || 0),
  fecha_ganancia: deliveryForm.fecha_inicio || todayISO(),
 duracion_tipo: selectedDeliveryService.duracion_tipo,
duracion_cantidad: selectedDeliveryService.duracion_cantidad
})
      });

      const newSub = {
        id: result.suscripcion?.id,
        cliente_id: selectedDeliveryClient.id,
        servicio_id: selectedDeliveryService.id,
        fecha_inicio: result.suscripcion?.fecha_inicio || deliveryForm.fecha_inicio || todayISO(),
        fecha_vencimiento:
  addDuration(
    deliveryForm.fecha_inicio || todayISO(),
    selectedDeliveryService.duracion_tipo || "meses",
    Number(selectedDeliveryService.duracion_cantidad || 1)
  ),
        activo: true,
        cliente: selectedDeliveryClient,
        servicio: selectedDeliveryService
      };
      const generated = {
  text: buildDeliveryMessage(newSub, {
    ...selectedInventoryItem,
    duracion_tipo: selectedDeliveryService.duracion_tipo,
    duracion_cantidad: selectedDeliveryService.duracion_cantidad
  }, {
    cupo_numero: chosenSlot,
    correo_cliente: deliveryForm.correo_cliente,
    fecha_entrega: todayISO()
  }),
  cliente: selectedDeliveryClient,
  servicio: selectedDeliveryService,
  cuenta: selectedInventoryItem,
  asignacion: result.asignacion,
  suscripcion: result.suscripcion
};
      setGeneratedDelivery(withOrderMessages(generated, selectedDeliveryClient));
      setNewClientAccess(null);
      setDeliveryForm((prev) => ({ ...prev, servicio_id: "", cliente_id: "", inventario_id: "", cupo_numero: "", correo_cliente: "", fecha_inicio: todayISO() }));
      setSubForm({ cliente_id: "", servicio_id: "", fecha_inicio: todayISO() });
      setOrderSource("external");
      setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "", grupo: "", correo_cliente: "" });
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

  function animateCopyButton(event) {
    const button = event?.currentTarget;
    if (!button) return;
    button.classList.remove("jcCopyPressed");
    void button.offsetWidth;
    button.classList.add("jcCopyPressed");
    window.setTimeout(() => button.classList.remove("jcCopyPressed"), 550);
  }

  function showCopyNotice() {
    setCopyNotice(false);
    window.setTimeout(() => setCopyNotice(true), 10);
  }

  function panelAccessMessage(cliente, passwordTemporal = "") {
    const nombre = String(cliente?.nombre || "cliente").trim();
    const username = String(cliente?.username || "").trim().replace(/^@+/, "");
    const ingreso = passwordTemporal
      ? `🔑 Contraseña: ${passwordTemporal}`
      : "🔑 (La contraseña es el mismo usuario)";
    return `🎉 ¡Hola, ${nombre}! Qué gusto tenerte en JUAN CUENTAS 💙\n\n🔐 Tu acceso al panel de clientes:\n👤 Usuario: ${username}\n${ingreso}\n🌐 https://juancuentas.com/cliente\n\n✨ Consulta tus servicios, vencimientos y promociones.\n🛍️ Catálogo actualizado: https://juancuentas.com/cliente/catalogo\n🎁🏆 ¡Cada compra te acerca a un premio especial!\n\n💙 ¡Gracias por confiar en JUAN CUENTAS! 😁`;
  }

  function withOrderMessages(venta, cliente) {
    const passwordTemporal = newClientAccess?.id === cliente?.id ? newClientAccess.password : "";
    return {
      ...venta,
      cliente,
      accessText: panelAccessMessage(cliente, passwordTemporal),
      accessIsNew: Boolean(passwordTemporal)
    };
  }

  function orderMessagesCombined(venta) {
    if (!venta) return "";
    return `📦 DATOS DEL PEDIDO\n\n${venta.text || ""}\n\n━━━━━━━━━━━━━━━━━━\n\n🔐 ACCESO AL PANEL\n\n${venta.accessText || ""}`;
  }

  async function copyText(text, event) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      animateCopyButton(event);
      showCopyNotice();
    } catch {
      setError("No se pudo copiar automáticamente. Revisa los permisos del portapapeles.");
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
    const errorFecha = errorFechaPedidoVencido(calculatedExpiry);
    if (errorFecha) { setError(errorFecha); return; }
    await runAction(async () => {
      const clientePedido = selectedClient;
      const servicioPedido = selectedService;
      const inicioPedido = subForm.fecha_inicio || todayISO();
      const vencimientoPedido = calculatedExpiry;
      const result = await api("/api/admin/suscripciones", {
        method: "POST",
        body: JSON.stringify({ ...subForm, fecha_vencimiento: calculatedExpiry, ganancia_neta: Number(profitValue || 0), fecha_ganancia: inicioPedido })
      });
      setGeneratedDelivery(withOrderMessages({
        text: `🎉 ¡Hola, ${clientePedido?.nombre || "cliente"}!\n\n🧾 Tu pedido ha sido registrado en JUAN CUENTAS.\n📺 Servicio: ${servicioPedido?.nombre || "Servicio"}\n📅 Inicio: ${formatDate(inicioPedido)}\n📅 Vencimiento: ${formatDate(vencimientoPedido)}\n\n🔐 Las credenciales de este servicio están pendientes de asignación. Te las enviaremos cuando estén listas.\n\nGracias por tu compra y confianza 😁`,
        cliente: clientePedido,
        servicio: servicioPedido,
        suscripcion: result?.suscripcion
      }, clientePedido));
      setNewClientAccess(null);
      setSubForm({ cliente_id: "", servicio_id: "", fecha_inicio: todayISO() });
      setDeliveryForm((prev) => ({ ...prev, servicio_id: "", cliente_id: "", inventario_id: "", cupo_numero: "", correo_cliente: "", fecha_inicio: todayISO() }));
      setOrderSource("external");
      setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "", grupo: "", correo_cliente: "" });
      setProfitValue("");
      setClientQuery("");
      setServiceQuery("");
    }, "Pedido agregado correctamente. Se generaron los mensajes del pedido y del panel.");
  }

  async function createExternalOrder() {
    const errorFecha = errorFechaPedidoVencido(calculatedExpiry);
    if (errorFecha) { setError(errorFecha); return; }
    if (!selectedClient || !selectedService) {
      setError("Selecciona cliente y servicio.");
      return;
    }
    const correoIngresado = String(externalOrderForm.correo || "").trim();
    const esYoutubeExterno = /youtube/i.test(String(selectedService?.nombre || ""));
    const grupoExterno = String(externalOrderForm.grupo || "").trim();
    const correoClienteExterno = String(externalOrderForm.correo_cliente || "").trim();
    const youtubePorGrupo = esYoutubeExterno && youtubeExternalMode === "grupo";
    const correo = youtubePorGrupo ? grupoExterno : correoIngresado;
    if (youtubePorGrupo && (!grupoExterno || !correoClienteExterno)) {
      setError("Escribe el grupo familiar y el correo Gmail del cliente.");
      return;
    }
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
          clave: youtubePorGrupo ? "" : externalOrderForm.clave,
          perfil,
          pin: externalOrderForm.pin,
          grupo: youtubePorGrupo ? grupoExterno : "",
          correo_cliente: youtubePorGrupo ? correoClienteExterno : "",
          servidor: externalOrderForm.servidor || "",
          ganancia_neta: Number(profitValue || 0),
          fecha_ganancia: subForm.fecha_inicio || todayISO()
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
          correo_cliente: youtubePorGrupo ? correoClienteExterno : (effectiveDeliveryType(selectedService) === "gemini" ? correo : null),
          fecha_entrega: todayISO()
        }),
        cliente: selectedClient,
        servicio: selectedService,
        cuenta: accountForMessage,
        asignacion: result.asignacion,
        suscripcion: result.suscripcion
      };

      setGeneratedDelivery(withOrderMessages(generated, selectedClient));
      setNewClientAccess(null);
      setSubForm({ cliente_id: "", servicio_id: "", fecha_inicio: todayISO() });
      setDeliveryForm({ servicio_id: "", cliente_id: "", inventario_id: "", cupo_numero: "", correo_cliente: "", fecha_inicio: todayISO() });
      setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "", grupo: "", correo_cliente: "" });
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

  // Los avisos no se marcan como gestionados al pulsar Renovar.
  // Primero se abre el formulario completo y solo se confirma tras guardar.
  function openRenewalFromNotice(assignment, sub) {
    setRenewalTargetId(sub.id);
    setRenewalNoticeOrigin({
      asignacion_id: assignment.id,
      suscripcion_id: sub.id,
      fecha_vencimiento: sub.fecha_vencimiento
    });
    setRenewalDelivery(null);
    setRenewMenuId(sub.id);
    setRenewAccountModeValue(sub.id, "actual");
    setRenewalDates(prev => ({...prev, [sub.id]: todayISO()}));
    navigate("renovar");
    if (typeof window !== "undefined") window.scrollTo({top:0, behavior:"smooth"});
  }

  async function markInventoryNoticeManaged(assignment, sub, tipoGestion = "retirado") {
    const clave = `${assignment.id}:${sub.fecha_vencimiento}`;
    await runAction(async () => {
      await api("/api/admin/avisos-inventario", {
        method: "POST",
        body: JSON.stringify({ asignacion_id: assignment.id, suscripcion_id: sub.id, fecha_vencimiento: sub.fecha_vencimiento, tipo_gestion: tipoGestion })
      });
      setManagedInventoryNotices((prev) => [...new Set([...prev, clave])]);
    }, "Aviso gestionado. Esta acción solo registra lo realizado en la plataforma oficial, no renueva ni cambia ganancias.");
  }

  // La selección es por aviso (asignación + vencimiento), no por cuenta.
  // Una renovación con fecha nueva constituye un aviso diferente.
  function toggleInventoryNoticeSelection(key) {
    setSelectedInventoryNotices((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  }

  async function markSelectedInventoryNoticesManaged() {
    const selected = inventoryExpiryNotices.filter(({ assignment, sub }) =>
      selectedInventoryNotices.includes(`${assignment.id}:${sub.fecha_vencimiento}`)
    );
    if (!selected.length || working) return;
    setWorking(true);
    setError("");
    setMessage("");
    const succeeded = [];
    const failed = [];
    try {
      // La API valida cada pedido y fecha para no marcar avisos de renovaciones distintas.
      for (const { assignment, sub } of selected) {
        const key = `${assignment.id}:${sub.fecha_vencimiento}`;
        try {
          await api("/api/admin/avisos-inventario", {
            method: "POST",
            body: JSON.stringify({ asignacion_id: assignment.id, suscripcion_id: sub.id, fecha_vencimiento: sub.fecha_vencimiento, tipo_gestion: "retirado" })
          });
          succeeded.push(key);
        } catch (e) {
          failed.push(`${sub.cliente?.nombre || "Cliente"}: ${e.message}`);
        }
      }
      if (succeeded.length) {
        setManagedInventoryNotices((prev) => [...new Set([...prev, ...succeeded])]);
        setSelectedInventoryNotices((prev) => prev.filter((key) => !succeeded.includes(key)));
      }
      if (failed.length) {
        setError(`${succeeded.length} gestionado(s), ${failed.length} sin gestionar. ${failed[0]}`);
      } else {
        setMessage(`${succeeded.length} aviso(s) marcados como gestionados. No se modificaron pedidos ni ganancias.`);
      }
    } finally {
      setWorking(false);
    }
  }

  function needsCustomerInvitationEmail(assignment) {
    const account = assignment?.item || {};
    const service = assignment?.sub?.servicio || account.servicios || {};
    const name = normalizeText(service.nombre || "");
    return name.includes("youtube") && Boolean(account.grupo) || name.includes("gemini") && (Boolean(account.grupo) || effectiveDeliveryType(service) === "gemini");
  }

  function beginCredentialsEdit(assignment) {
    if (!assignment?.item) return;
    const account = assignment.item;
    setEditingCredentialsId(assignment.id);
    setCredentialsEdit({
      cupo_numero: Number(assignment.cupo_numero || 1),
      inventario_destino_id: account.id,
      correo_cliente: assignment.correo_cliente || "",
      correo: account.correo || "",
      clave: account.clave || "",
      grupo: account.grupo || "",
      pin: account.perfiles_pins?.[String(assignment.cupo_numero)] || account.pin || "",
      servidor: extractEmbyServer(account.notas),
    });
  }

  async function saveCredentialsEdit(assignment) {
    if (!assignment?.item) return;
    const account = assignment.item;
    await runAction(async () => {
      await api("/api/admin/inventario", {
        method: "PATCH",
        body: JSON.stringify({
          id: account.id,
          action: "editar_entrega",
          asignacion_id: assignment.id,
          cupo_numero: Number(credentialsEdit.cupo_numero),
          ...(needsCustomerInvitationEmail(assignment) ? { correo_cliente: credentialsEdit.correo_cliente, inventario_destino_id: credentialsEdit.inventario_destino_id || account.id } : {}),
          ...(account.etiqueta === "externa" ? {
            correo: credentialsEdit.correo,
            clave: credentialsEdit.clave,
            grupo: credentialsEdit.grupo,
            pin: credentialsEdit.pin,
            servidor: credentialsEdit.servidor
          } : {})
        })
      });
      setEditingCredentialsId("");
    }, "Credenciales y asignación actualizadas. También se reflejarán en el panel del cliente.");
  }

  function renderCredentialsEditor(assignment) {
    if (!assignment?.item || editingCredentialsId !== assignment.id) return null;
    const account = assignment.item;
    const isFamilyInventory = needsCustomerInvitationEmail(assignment) && account.etiqueta !== "externa" && Boolean(account.grupo);
    const familyGroups = isFamilyInventory ? (data.inventario || []).filter((item) =>
      item.servicio_id === account.servicio_id && Boolean(item.grupo) &&
      !["fallida", "reemplazada"].includes(item.estado) &&
      (item.id === account.id || Array.from({ length: Number(item.cupos_total || 1) }, (_, index) => index + 1).some((slot) =>
        !(data.asignaciones || []).some((a) => a.activo && a.inventario_id === item.id && Number(a.cupo_numero) === slot)
      ))
    ) : [];
    const destinationAccount = familyGroups.find((item) => item.id === credentialsEdit.inventario_destino_id) || account;
    const maxSlot = account.etiqueta === "externa" ? 50 : Number(destinationAccount.cupos_total || 1);
    const availableSlots = Array.from({ length: maxSlot }, (_, i) => i + 1).filter((slot) =>
      (destinationAccount.id === account.id && slot === Number(assignment.cupo_numero)) || !(data.asignaciones || []).some((a) =>
        a.activo && a.id !== assignment.id && a.inventario_id === destinationAccount.id && Number(a.cupo_numero) === slot
      )
    );
    return (
      <div className="jcCredentialEditor">
        {needsCustomerInvitationEmail(assignment) && (
          <label>Correo del cliente (para invitación al grupo)
            <input type="email" value={credentialsEdit.correo_cliente || ""} onChange={(e) => setCredentialsEdit((prev) => ({ ...prev, correo_cliente: e.target.value }))} placeholder="cliente@gmail.com" />
          </label>
        )}
        {isFamilyInventory && (
          <label>Grupo familiar del cliente
            <select value={destinationAccount.id} onChange={(e) => {
              const target = familyGroups.find((item) => item.id === e.target.value);
              if (!target) return;
              const libres = Array.from({ length: Number(target.cupos_total || 1) }, (_, i) => i + 1).filter((slot) =>
                (target.id === account.id && slot === Number(assignment.cupo_numero)) ||
                !(data.asignaciones || []).some((a) => a.activo && a.inventario_id === target.id && Number(a.cupo_numero) === slot)
              );
              setCredentialsEdit((prev) => ({ ...prev, inventario_destino_id: target.id, cupo_numero: libres[0] || Number(assignment.cupo_numero) }));
            }}>
              {familyGroups.map((item) => <option key={item.id} value={item.id}>{item.grupo} {item.id === account.id ? "(actual)" : "(disponible)"}</option>)}
            </select>
            <small>Traslada únicamente este pedido; los demás integrantes y el nombre del grupo no cambian.</small>
          </label>
        )}
        <label>Perfil / cupo del cliente (actual y libres)
          <select value={credentialsEdit.cupo_numero} onChange={(e) => setCredentialsEdit((prev) => ({ ...prev, cupo_numero: Number(e.target.value) }))}>
            {availableSlots.map((slot) => <option key={slot} value={slot}>Perfil / cupo {slot}{destinationAccount.id === account.id && slot === Number(assignment.cupo_numero) ? " (actual)" : " (libre)"}</option>)}
          </select>
        </label>
        {account.etiqueta === "externa" && (
          <>
            {!needsCustomerInvitationEmail(assignment) && (
              <label>Correo / usuario de acceso<input value={credentialsEdit.correo || ""} onChange={(e) => setCredentialsEdit((prev) => ({ ...prev, correo: e.target.value }))} /></label>
            )}
            {!needsCustomerInvitationEmail(assignment) && (
              <label>Contraseña<input value={credentialsEdit.clave || ""} onChange={(e) => setCredentialsEdit((prev) => ({ ...prev, clave: e.target.value }))} /></label>
            )}
            {normalizeText(assignment.sub?.servicio?.nombre || account.servicios?.nombre || "").includes("emby") && <label>Servidor Emby<input value={credentialsEdit.servidor || ""} onChange={(e) => setCredentialsEdit((prev) => ({ ...prev, servidor: e.target.value }))} /></label>}
            {!needsCustomerInvitationEmail(assignment) && (
              <label>PIN<input value={credentialsEdit.pin || ""} onChange={(e) => setCredentialsEdit((prev) => ({ ...prev, pin: e.target.value }))} /></label>
            )}
          </>
        )}
        <div className="inlineActions">
          <button type="button" className="miniButton primaryMini" disabled={working} onClick={() => saveCredentialsEdit(assignment)}>Guardar cambios</button>
          <button type="button" className="miniButton" onClick={() => setEditingCredentialsId("")}>Cancelar</button>
        </div>
        <small>Solo cambia los datos de este cliente y su asignación. Las credenciales y demás integrantes del grupo original no se modifican.</small>
      </div>
    );
  }

  function beginSubscriptionEdit(s) {
    const assignment = activeAssignmentBySubscription[s.id];
    setEditingSubscriptionId(s.id);
    const duration = inferOrderDuration(s.fecha_inicio, s.fecha_vencimiento);
    setSubscriptionEditForm({
      ...duration,
      duracion_tipo: duration.tipo,
      duracion_cantidad: duration.cantidad,
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
    const qty = Number(subscriptionEditForm.duracion_cantidad);
    if (!["dias", "meses", "anios"].includes(subscriptionEditForm.duracion_tipo) || !Number.isInteger(qty) || qty < 1 || (subscriptionEditForm.duracion_tipo === "anios" && qty > 1) || (subscriptionEditForm.duracion_tipo === "meses" && qty > 12) || (subscriptionEditForm.duracion_tipo === "dias" && qty > 365)) {
      setError("Selecciona un tiempo válido: hasta 365 días, 12 meses o 1 año.");
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
          duracion_tipo: subscriptionEditForm.duracion_tipo,
          duracion_cantidad: qty,
          // Si se corrige la fecha de un pedido ya vencido y archivado,
          // permitir que la API lo reactive al quedar con días restantes.
          reactivar_al_editar: s.activo === false && s.days !== null && s.days <= 0,
          ...(assignment ? { cupo_numero: Number(subscriptionEditForm.cupo_numero) } : {})
        })
      });
      setEditingSubscriptionId("");
    }, "Pedido actualizado. Se recalculó el vencimiento con la duración elegida.");
  }

  async function toggleSubscription(s) {
    await runAction(
      () => api("/api/admin/suscripciones", { method: "PATCH", body: JSON.stringify({ id: s.id, activo: !s.activo }) }),
      s.activo ? "Suscripción suspendida y cupo/perfil liberado." : "Suscripción activada. Asigna un cupo/perfil disponible para volver a utilizarla."
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

  function getRenewAccountMode(id) {
  return renewAccountMode[id] || "actual";
}

function setRenewAccountModeValue(id, value) {
  setRenewAccountMode((prev) => ({
    ...prev,
    [id]: value
  }));
}

function setRenewSelectedSlotValue(id, value) {
  setRenewSelectedSlot((prev) => ({
    ...prev,
    [id]: value
  }));
}

function setRenewSameAccountSlotValue(id, value) {
  setRenewSameAccountSlot((prev) => ({
    ...prev,
    [id]: value
  }));
}

  function setRenewalDraft(id, changes) {
    setRenewalDrafts((prev) => ({ ...prev, [id]: { ...getRenewalDraft(id), ...changes } }));
  }

  function setRenewSelectedInventoryValue(id,value){
  setRenewSelectedInventory((prev)=>({
    ...prev,
    [id]:value
  }));
}

  async function renewSubscription(s) {


    const draft = getRenewalDraft(s.id);
    const max = draft.tipo === "dias" ? 30 : draft.tipo === "meses" ? 12 : 1;
    const rawQty = draft.tipo === "anios" ? 1 : Number(draft.cantidad);
    if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > max) {
      setError(`Escribe una cantidad entre 1 y ${max}.`);
      return;
    }
    const profitRaw = String(renewalProfits[s.id] ?? "").trim();
    const gananciaRenovacion = Number(profitRaw);
    if (profitRaw === "" || !Number.isFinite(gananciaRenovacion) || gananciaRenovacion < 0) {
      setError("Escribe la ganancia neta de esta renovación (puede ser 0).");
      return;
    }
    const fecha_inicio = renewalDates[s.id] || todayISO();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_inicio)) {
      setError("Selecciona una fecha válida para la renovación.");
      return;
    }
const fecha_vencimiento = addDuration(fecha_inicio, draft.tipo, rawQty);
const modoRenovacion = getRenewAccountMode(s.id);
const cambiarCuenta = modoRenovacion === "nueva";
const externos = renewExternalDetails[s.id] || {};
if (modoRenovacion === "externo" && !String(externos.correo || "").trim()) {
  setError("Escribe el correo o acceso del pedido por fuera.");
  return;
}
if (modoRenovacion === "externo" && (!Number.isInteger(Number(externos.perfil || 1)) || Number(externos.perfil || 1) < 1 || Number(externos.perfil || 1) > 50)) {
  setError("El perfil externo debe estar entre 1 y 50.");
  return;
}

const nuevoInventarioId = cambiarCuenta
  ? renewSelectedInventory[s.id]
  : null;

const nuevoCupo = cambiarCuenta
  ? Number(renewSelectedSlot[s.id])
  : null;

if (cambiarCuenta && (!nuevoInventarioId || !nuevoCupo)) {
  setError("Seleccione la nueva cuenta y el perfil disponible.");
  return;
}

    setWorking(true);
    setError("");
    setMessage("");
    setRenewalDelivery(null);
    try {
      // La plantilla se genera solo después de confirmar la renovación en el servidor.
      await api("/api/admin/suscripciones", { method: "PATCH", body: JSON.stringify({
        id: s.id,
        fecha_inicio,
        fecha_vencimiento,
        activo: true,
        reporte_vencimiento: false,
        fecha_reporte: null,
        es_renovacion: true,
        ganancia_renovacion: gananciaRenovacion,
        cambiar_cuenta: cambiarCuenta,
        modo_renovacion: modoRenovacion,
        duracion_tipo: draft.tipo,
        duracion_cantidad: rawQty,
        credenciales_externas: modoRenovacion === "externo" ? {
          proveedor_id: externos.proveedor_id || null,
          correo: String(externos.correo || "").trim(),
          clave: externos.clave || "",
          perfil: Number(externos.perfil || 1),
          pin: externos.pin || ""
        } : null,
        nuevo_inventario_id: nuevoInventarioId,
        nuevo_cupo: nuevoCupo,
        perfil_misma_cuenta: cambiarCuenta ? null : (renewSameAccountSlot[s.id] || "mismo")
      }) });
      // La renovación ya fue registrada con su fecha y ganancia antes de cerrar el aviso.
      // En caso de fallo al registrar el aviso, NUNCA se repite la renovación.
      let noticeWarning = "";
      if (renewalNoticeOrigin?.suscripcion_id === s.id) {
        const notice = renewalNoticeOrigin;
        try {
          await api("/api/admin/avisos-inventario", {
            method: "POST",
            body: JSON.stringify({ ...notice, tipo_gestion: "renovado" })
          });
          setManagedInventoryNotices(prev => [...new Set([...prev, `${notice.asignacion_id}:${notice.fecha_vencimiento}`])]);
          setRenewalNoticeOrigin(null);
        } catch (noticeError) {
          noticeWarning = ` Aviso: la renovación se guardó, pero no se pudo confirmar el aviso (${noticeError.message}). No pulses Aplicar renovación nuevamente.`;
          setRenewalNoticeOrigin(null);
        }
      }
      const latest = await api(`/api/admin/data?today=${todayISO()}`);
      setData(latest);
      const renewed = (latest.suscripciones || []).find((row) => row.id === s.id) || s;
      const cliente = renewed.cliente || (latest.clientes || []).find((x) => x.id === s.cliente_id) || s.cliente;
      const servicio = renewed.servicio || (latest.servicios || []).find((x) => x.id === s.servicio_id) || s.servicio;
      const assignment = (latest.asignaciones || []).find((a) => a.suscripcion_id === s.id && a.activo === true);
      const account = assignment && [ ...(latest.inventario || []), ...(latest.inventario_externo || []) ]
        .find((item) => item.id === assignment.inventario_id);
      let deliveryText;
      if (account) {
        // Usamos la misma función y las mismas plantillas que al crear un pedido.
        // La duración debe ser la de la renovación, no la duración antigua de la cuenta.
        // El catálogo se actualiza con latest antes de mostrar la entrega.
        deliveryText = buildRenewalDeliveryMessage({
          ...renewed, cliente, servicio, fecha_inicio, fecha_vencimiento
        }, { ...account, duracion_tipo: draft.tipo, duracion_cantidad: rawQty }, {
          cupo_numero: assignment.cupo_numero,
          correo_cliente: assignment.correo_cliente || ""
        }, latest);
      } else {
        // Nunca inventar credenciales o un perfil si el pedido no tiene asignación.
        deliveryText = withPurchaseThanks(`Hola ${cliente?.nombre || "Cliente"} 😁, tu servicio ${servicio?.nombre || "Servicio"} ha sido renovado por ${durationText(draft.tipo, rawQty)}.\nFecha de renovación: ${formatDate(fecha_inicio)}\nPróximo vencimiento: ${formatDate(fecha_vencimiento)}.`);
      }
      setRenewalDelivery({ id: s.id, text: deliveryText, cliente });
      // El navegador puede bloquear la escritura tras una petición asíncrona.
      // En ese caso el mensaje sigue disponible para copiar y abrir WhatsApp.
      let copiedAutomatically = false;
      try {
        await navigator.clipboard.writeText(deliveryText);
        copiedAutomatically = true;
        showCopyNotice();
      } catch (_) { /* Se ofrece botón manual justo debajo del resultado */ }
      if (modoRenovacion === "externo") setRenewExternalDetails(prev => { const next={...prev}; delete next[s.id]; return next; });
      setMessage(`Renovada hasta ${formatDate(fecha_vencimiento)}. ${copiedAutomatically ? "✅ Mensaje copiado: abre WhatsApp y pega." : "Mensaje listo: pulsa Copiar mensaje y abre WhatsApp."}${noticeWarning}`);
      setRenewMenuId(s.id);
      setRenewalDates((prev) => { const next = { ...prev }; delete next[s.id]; return next; });
    } catch (err) {
      setError(err.message || "No se pudo completar la renovación.");
    } finally {
      setWorking(false);
    }
  }

  // Igual que buildDeliveryMessage, pero usa los datos recién leídos tras renovar,
  // en vez de las listas de React que todavía pueden contener el pedido anterior.
  function buildRenewalDeliveryMessage(sub, item, assignmentData, latest) {
    const cliente = sub.cliente?.nombre || sub.cliente?.username || "Cliente";
    const service = sub.servicio;
    const durationLabel = inventoryDurationText(item);
    const provider = providerInitials(item) || (latest.proveedores || []).find((p) => p.id === item.proveedor_id)?.iniciales || "";
    const cupo = Number(assignmentData.cupo_numero || 1);
    const pin = item.perfiles_pins?.[String(cupo)] || item.pin || "";
    const plantilla = (latest.plantillas_mensajes || []).find((entry) => {
      if (entry.activo === false) return false;
      const servicioPlantilla = (latest.servicios || []).find((x) => x.id === entry.servicio_id);
      return servicioPlantilla && claveServicioPlantilla(servicioPlantilla.nombre) === claveServicioPlantilla(service?.nombre);
    });
    if (plantilla?.contenido) {
      return withPurchaseThanks(aplicarPlantilla(plantilla.contenido, {
        cliente, servicio: service?.nombre || "Servicio", tiempo: durationLabel,
        correo: item.correo || "", clave: item.clave || "", perfil: String(cupo),
        pin, proveedor: provider,
        fecha_seleccionada: fechaCortaMensaje(sub.fecha_inicio),
        fecha_creacion: fechaCortaMensaje(sub.fecha_inicio),
        fecha_inicio: fechaCortaMensaje(sub.fecha_inicio),
        fecha_vencimiento: formatDate(sub.fecha_vencimiento),
        grupo: item.grupo || "", correo_cliente: assignmentData.correo_cliente || ""
      }));
    }
    return withPurchaseThanks(`${service?.nombre || "Servicio"} x${durationLabel} (${formatLongDate(sub.fecha_inicio)})${provider ? ` (${provider})` : ""}\n\nCORREO: ${item.correo || ""}\nCLAVE: ${item.clave || ""}\nPERFIL ${cupo}${pin ? `\nPIN: ${pin}` : ""}\n\n${REGLAS_PREDETERMINADAS}\n\n${cliente}`);
  }

  function getInventoryRenewalDraft(id) {
    return inventoryRenewalDrafts[id] || { tipo: "meses", cantidad: 1 };
  }

  function setInventoryRenewalDraft(id, changes) {
    setInventoryRenewalDrafts((prev) => ({ ...prev, [id]: { ...getInventoryRenewalDraft(id), ...changes } }));
  }

  async function renewInventoryAccount(item) {
    const draft = getInventoryRenewalDraft(item.id);
    const max = draft.tipo === "dias" ? 30 : undefined;
    const qty = Number(draft.cantidad);
    if (!Number.isInteger(qty) || qty < 1 || (max !== undefined && qty > max)) {
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
    const hasStock = availableInventory.some((item) => {
      const stockService = data.servicios.find((x) => String(x.id) === String(item.servicio_id));
      return claveServicioPlantilla(stockService?.nombre || item.servicios?.nombre) === claveServicioPlantilla(service.nombre);
    });
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
    setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "", grupo: "", correo_cliente: "" });
    setServiceQuery(
  `${serviceLabel(service)} - ${durationText(serviceDuration(service).tipo, serviceDuration(service).cantidad)}`
);
    setShowServiceMatches(false);
    setGeneratedDelivery(null);
  }

  function handleServiceQuery(value) {
    setServiceQuery(value);
    setShowServiceMatches(true);
    const normalized = normalizeText(value);
    const exact = data.servicios.find((service) => service.activo && normalizeText(serviceLabel(service)) === normalized);
    if (exact) {
      const hasStock = availableInventory.some((item) => {
        const stockService = data.servicios.find((x) => String(x.id) === String(item.servicio_id));
        return claveServicioPlantilla(stockService?.nombre || item.servicios?.nombre) === claveServicioPlantilla(exact.nombre);
      });
      setSubForm((prev) => ({ ...prev, servicio_id: exact.id }));
      setDeliveryForm((prev) => ({ ...prev, servicio_id: exact.id, inventario_id: "", cupo_numero: "", correo_cliente: "" }));
      setOrderSource(hasStock ? "stock" : "external");
      setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "", grupo: "", correo_cliente: "" });
    } else {
      if (subForm.servicio_id) setSubForm((prev) => ({ ...prev, servicio_id: "" }));
      setDeliveryForm((prev) => ({ ...prev, servicio_id: "", inventario_id: "", cupo_numero: "", correo_cliente: "" }));
      setOrderSource("external");
      setExternalOrderForm({ proveedor_id: "", correo: "", clave: "", perfil: 1, pin: "", grupo: "", correo_cliente: "" });
    }
    setGeneratedDelivery(null);
  }

  function openClientAccess(cliente) {
    setClientAccess({ cliente: { id: cliente.id, nombre: cliente.nombre || "", username: cliente.username || "", telefono: cliente.telefono || "" }, password: "", text: "" });
    setError("");
  }

  async function generateClientAccess() {
    if (!clientAccess || working) return;
    const { cliente, password } = clientAccess;
    if (password.length < 6) {
      setError("Escribe una contraseña nueva de mínimo 6 caracteres para entregar un acceso válido.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      await api("/api/admin/clientes", {
        method: "PATCH",
        body: JSON.stringify({ id: cliente.id, nombre: cliente.nombre, username: cliente.username, telefono: cliente.telefono, password })
      });
      const text = `🎉 ¡Hola, ${cliente.nombre}! Qué gusto tenerte en JUAN CUENTAS 💙\n\n🔐 Tu acceso al panel de clientes:\n👤 Usuario: ${String(cliente.username || "").trim().replace(/^@+/, "")}\n🔑 Contraseña: ${password}\n🌐 Ingresa aquí: https://juancuentas.com/cliente\n\n✨ Consulta tus servicios y promociones cuando quieras.
🛍️ Mira nuestro catálogo actualizado: https://juancuentas.com/cliente/catalogo

🎁🏆 ¡Cada compra te acerca a un premio especial!

💙 ¡Gracias por confiar en JUAN CUENTAS! 😁`;
      setClientAccess((current) => current?.cliente.id === cliente.id ? { ...current, password: "", text } : current);
      setMessage("Acceso actualizado. Copia y entrega el mensaje al cliente.");
    } catch (e) {
      setError(e.message || "No se pudo actualizar el acceso del cliente.");
    } finally {
      setWorking(false);
    }
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
            type="number" onWheel={bloquearScrollNumerico}
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
    const max = tipo === "dias" ? 30 : undefined;
    return (
      <div className="durationControls">
        <label>Tiempo
          <select value={tipo} disabled={tipoEntrega === "gemini"} onChange={(e) => setter({ ...form, duracion_tipo: e.target.value, duracion_cantidad: 1 })}>
            {tipoEntrega !== "gemini" && <option value="dias">Días</option>}
            <option value="meses">Meses</option>
          </select>
        </label>
        <label>Cantidad
          <input type="number" onWheel={bloquearScrollNumerico} inputMode="numeric" min="1" max={max} required value={form.duracion_cantidad} onChange={(e) => setter({ ...form, duracion_tipo: tipo, duracion_cantidad: e.target.value })} onBlur={() => {
            const parsed = Number(form.duracion_cantidad);
            const fixed = Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : 1;
            setter({ ...form, duracion_tipo: tipo, duracion_cantidad: fixed });
          }} />
        </label>
      </div>
    );
  }

 function availableRenewalAccounts(s) {

  const inventarios = data.inventario || [];
  const asignaciones = data.asignaciones || [];

  





  return inventarios.filter((item) => {

    if (item.servicios?.nombre !== s.servicio?.nombre) return false;

    const asignacionActual = asignaciones.find(
  (a) =>
    a.suscripcion_id === s.id &&
    a.activo === true
);

if (asignacionActual && item.id === asignacionActual.inventario_id) {
  return false;
}

    if (
      item.estado === "fallida" ||
      item.estado === "reemplazada"
    ) {
      return false;
    }

    const usados = asignaciones.filter(
      (a) =>
        a.inventario_id === item.id &&
        a.activo === true
    );

    return usados.length < Number(item.cupos_total || 1);

  });
}

  function renewalDropdown(s, standalone = false) {
    const draft = getRenewalDraft(s.id);
    const max = draft.tipo === "dias" ? 30 : draft.tipo === "meses" ? 12 : 1;
    const isOpen = standalone || renewMenuId === s.id;
    
    return (
      <div className={standalone ? "renewMenuWrap jcStandaloneRenewWrap" : "renewMenuWrap"}>
        {!standalone && <button type="button" className="miniButton renewTrigger" onClick={() => setRenewMenuId(isOpen ? "" : s.id)}>
          Renovar <span>{isOpen ? "▴" : "▾"}</span>
        </button>}
        {isOpen && (
          <div className="renewDropdown jcRenewForm">
            <label className="jcRenewFull">
Cuenta para renovación

<select
 value={getRenewAccountMode(s.id)}
 onChange={(e)=>setRenewAccountModeValue(s.id,e.target.value)}
>
 <option value="actual">
  Mantener cuenta actual
 </option>

 <option value="nueva">
  Cambiar por otra cuenta disponible
 </option>
 <option value="solo">Solo pedido (sin credenciales)</option>
 <option value="externo">Pedido por fuera (credenciales propias)</option>

</select>

</label>

{getRenewAccountMode(s.id) === "actual" && (
  <label className="jcRenewFull">
    Perfil para renovación

    <select
      value={renewSameAccountSlot[s.id] || "mismo"}
      onChange={(e) =>
        setRenewSameAccountSlotValue(s.id, e.target.value)
      }
    >
      <option value="mismo">
        Mismo perfil
      </option>

      {(() => {
        const asignacionActual = (data.asignaciones || []).find(
          (a) =>
            a.suscripcion_id === s.id &&
            a.activo === true
        );

        if (!asignacionActual) return null;

        const inventarioActual = (data.inventario || []).find(
          (item) =>
            item.id === asignacionActual.inventario_id
        );

        if (!inventarioActual) return null;

        const totalPerfiles = Number(
          inventarioActual.cupos_total || 1
        );

        return Array.from(
          { length: totalPerfiles },
          (_, index) => index + 1
        )
          .filter(
            (perfil) =>
              perfil !== Number(asignacionActual.cupo_numero)
          )
          .map((perfil) => (
            <option key={perfil} value={perfil}>
              Cambiar a Perfil {perfil}
            </option>
          ));
      })()}
    </select>
  </label>
)}


{getRenewAccountMode(s.id) === "nueva" && (
  <>
    <label className="jcRenewFull">
      Nueva cuenta disponible

      <select
        value={renewSelectedInventory[s.id] || ""}
        onChange={(e) =>
          setRenewSelectedInventoryValue(s.id, e.target.value)
        }
      >
        <option value="">
          Seleccione una cuenta
        </option>

        {availableRenewalAccounts(s).map((item)=>(
          <option key={item.id} value={item.id}>
  {item.correo || "Cuenta sin correo"}
  {` (${item.cupos_total || 1} perfiles)`}
</option>
        ))}

      </select>
    </label>


    {renewSelectedInventory[s.id] && (
      <label className="jcRenewFull">
        Perfil disponible

        <select
          value={renewSelectedSlot[s.id] || ""}
          onChange={(e) =>
            setRenewSelectedSlotValue(s.id, e.target.value)
          }
        >
          <option value="">
            Seleccione perfil
          </option>

          {(() => {

  const cuentaSeleccionada = availableRenewalAccounts(s)
    .find(
      (item) =>
        item.id === renewSelectedInventory[s.id]
    );

  const cuposTotal = Number(
    cuentaSeleccionada?.cupos_total || 1
  );

  const ocupados = (data.asignaciones || [])
    .filter(
      (a) =>
        a.inventario_id === renewSelectedInventory[s.id] &&
        a.activo === true
    )
    .map(
      (a) => Number(a.cupo_numero)
    );


  const perfilesLibres = Array.from(
    { length: cuposTotal },
    (_, index) => index + 1
  )
  .filter(
    (perfil) =>
      !ocupados.includes(perfil)
  );


  return perfilesLibres.map((perfil) => (
    <option key={perfil} value={perfil}>
      Perfil {perfil}
    </option>
  ));

})()}

        </select>

      </label>
    )}
  </>
)}
            {getRenewAccountMode(s.id) === "solo" && (
              <p className="jcRenewFull" style={{fontSize:12, color:"#9fc9ed", margin:0}}>
                El pedido se renovará sin cuenta ni perfil. Se liberará cualquier cupo asignado anteriormente.
              </p>
            )}
            {getRenewAccountMode(s.id) === "externo" && (
              <div className="jcRenewFull" style={{display:"grid",gap:10,minWidth:0}}>
                <small style={{color:"#9fc9ed"}}>Credenciales compradas por fuera. No consumen cupos del inventario compartido.</small>
                <label>Proveedor (opcional)
                  <select value={(renewExternalDetails[s.id] || {}).proveedor_id || ""} onChange={(e)=>setRenewExternalDetails(prev=>({...prev,[s.id]:{...(prev[s.id] || {}),proveedor_id:e.target.value}}))}>
                    <option value="">Sin proveedor</option>
                    {(data.proveedores || []).map(p=><option key={p.id} value={p.id}>{p.iniciales || p.nombre || "Proveedor"}</option>)}
                  </select>
                </label>
                <label>Correo o acceso
                  <input value={(renewExternalDetails[s.id] || {}).correo || ""} placeholder="correo@ejemplo.com" onChange={(e)=>setRenewExternalDetails(prev=>({...prev,[s.id]:{...(prev[s.id] || {}),correo:e.target.value}}))} />
                </label>
                <label>Contraseña (opcional)
                  <input value={(renewExternalDetails[s.id] || {}).clave || ""} onChange={(e)=>setRenewExternalDetails(prev=>({...prev,[s.id]:{...(prev[s.id] || {}),clave:e.target.value}}))} />
                </label>
                <label>Perfil externo (1 a 50)
                  <input type="number" onWheel={bloquearScrollNumerico} min="1" max="50" value={(renewExternalDetails[s.id] || {}).perfil || 1} onChange={(e)=>setRenewExternalDetails(prev=>({...prev,[s.id]:{...(prev[s.id] || {}),perfil:e.target.value}}))} />
                </label>
                <label>PIN (opcional)
                  <input value={(renewExternalDetails[s.id] || {}).pin || ""} onChange={(e)=>setRenewExternalDetails(prev=>({...prev,[s.id]:{...(prev[s.id] || {}),pin:e.target.value}}))} />
                </label>
              </div>
            )}
            <label>Tiempo
              <select value={draft.tipo} onChange={(e) => setRenewalDraft(s.id, { tipo: e.target.value, cantidad: 1 })}>
                <option value="dias">Días</option>
                <option value="meses">Meses</option>
                <option value="anios">1 año</option>
              </select>
            </label>
            <label>Cantidad
              <input
                type="number" onWheel={bloquearScrollNumerico}
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
            <label className="jcRenewFull">Fecha de renovación <small>También será la fecha de la ganancia</small>
              <input type="date" value={renewalDates[s.id] || todayISO()}
                onChange={(e) => setRenewalDates((prev) => ({ ...prev, [s.id]: e.target.value }))} />
            </label>
            <label className="jcRenewFull">Ganancia neta (COP)
              <input type="number" onWheel={bloquearScrollNumerico} min="0" step="1" inputMode="numeric"
                placeholder="Ej. 8000"
                value={renewalProfits[s.id] ?? ""}
                onChange={(e) => setRenewalProfits((prev) => ({ ...prev, [s.id]: e.target.value }))}
              />
            </label>
            <button type="button" className="miniButton primaryMini" disabled={working} onClick={() => renewSubscription(s)}>Aplicar renovación</button>
            {renewalDelivery?.id === s.id && view !== "renovar" && (
              <div className="jcRenewFull generatedDelivery" style={{minWidth:0, maxWidth:"100%", overflow:"hidden", marginTop:12}}>
                <div className="generatedHeader"><strong>✅ Mensaje de entrega de la renovación</strong></div>
                <textarea aria-label="Mensaje de entrega de la renovación" readOnly value={renewalDelivery.text} style={{width:"100%", minHeight:210, boxSizing:"border-box", resize:"vertical"}} />
                <div className="inlineActions" style={{flexWrap:"wrap"}}>
                  <button type="button" className="miniButton primaryMini" onClick={(event) => copyText(renewalDelivery.text, event)}>📋 Copiar mensaje</button>
                  {renewalDelivery.cliente?.telefono && <button type="button" className="miniButton" onClick={async (event) => {
                    await copyText(renewalDelivery.text, event);
                    window.open(whatsappUrl(renewalDelivery.cliente.telefono, ""), "_blank", "noopener,noreferrer");
                  }}>WhatsApp</button>}
                </div>
                <small>El mensaje se copia para pegarlo en WhatsApp con los emojis correctos.</small>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }



  function inventoryAccountRenewalDropdown(item) {
    const draft = getInventoryRenewalDraft(item.id);
    const max = draft.tipo === "dias" ? 30 : undefined;
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
              <input type="number" onWheel={bloquearScrollNumerico} inputMode="numeric" min="1" max={max} value={draft.cantidad} onChange={(e) => setInventoryRenewalDraft(item.id, { cantidad: e.target.value })} />
            </label>
            <button type="button" className="miniButton primaryMini" disabled={working} onClick={() => renewInventoryAccount(item)}>Aplicar renovación</button>
          </div>
        )}
      </div>
    );
  }

  function whatsappMessage(s) {
    const cliente = s.cliente?.nombre || s.cliente?.username || "cliente";
    const servicio = s.servicio?.nombre || "servicio";

    // Mantener el mensaje que corresponde a los días restantes del pedido.
    if (s.days !== null && s.days <= 0) {
      const dias = Math.abs(s.days);
      return s.days === 0
        ? `Hola ${cliente} 😁, tu servicio ${servicio} ha vencido hoy. ☹️\n¿Deseas renovarlo? Estoy atento a tu solicitud 😊`
        : `Hola ${cliente} 😁, tu servicio ${servicio} se encuentra vencido hace ${dias} día(s). ☹️\n¿Deseas renovarlo? Estoy atento a tu solicitud 😊`;
    }

    if (s.days !== null && s.days >= 1 && s.days <= 3) {
      const unit = s.days === 1 ? "día" : "días";
      return `Holaa ${cliente} 😊, tu servicio ${servicio} vence en ${s.days} ${unit}. Si deseas renovarlo, estoy atento a tu solicitud.`;
    }

    return `Holaa ${cliente} 😊`;
  }

  function whatsappHref(s) {
    // Abrir la conversación SIN texto precargado, para evitar emojis dañados en PC.
    return whatsappUrl(s.cliente?.telefono).split("?text=")[0];
  }

  async function openSubscriptionWhatsapp(s, wa) {
    // Iniciar la copia mientras el clic del usuario mantiene los permisos del navegador.
    // La pestaña se abre inmediatamente para evitar bloqueadores de ventanas emergentes.
    const mensaje = whatsappMessage(s);
    let copia;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Portapapeles no disponible");
      copia = navigator.clipboard.writeText(mensaje);
    } catch {
      setError("No se pudo acceder al portapapeles. Revisa los permisos del navegador.");
      return;
    }

    window.open(wa, "_blank", "noopener,noreferrer");
    try {
      await copia;
      showCopyNotice();
      // Reportar solo si YA está vencida; nunca al avisar una próxima renovación.
      if (s.days !== null && s.days <= 0 && !s.reporte_vencimiento) {
        await marcarReportada(s.id);
      }
    } catch {
      setError("No se pudo copiar el mensaje. Autoriza el portapapeles y vuelve a pulsar WhatsApp.");
    }
  }

  function clientWhatsappHref(cliente) {
    return whatsappUrl(cliente?.telefono);
  }

  function accountStatus(s) {
    if (!s.activo) return { text: "Suspendido", className: "status suspendedStatus" };
    if (s.days !== null && s.days <= 0) return { text: "Vencido", className: "status off" };
    return { text: "Activo", className: "status ok" };
  }

  function renderAccountsTable(rows, emptyText) {
    if (rows.length === 0) return <div className="card emptyState">{emptyText}</div>;
    const visibleIds = rows.map((row) => row.id);
    // Un mismo servicio puede tener varias filas (cada una con una duración).
    // En Editar mostramos su nombre una sola vez y las duraciones reales del catálogo.
    const editServiceGroups = [];
    for (const service of data.servicios.filter((item) => item.activo !== false)) {
      const key = normalizeText(service.nombre);
      let group = editServiceGroups.find((item) => item.key === key);
      if (!group) {
        group = { key, nombre: service.nombre, servicios: [] };
        editServiceGroups.push(group);
      }
      group.servicios.push(service);
    }
    const editingService = data.servicios.find((item) => String(item.id) === String(subscriptionEditForm.servicio_id));
    const editingServiceGroupKey = normalizeText(editingService?.nombre);
    const editingServiceGroup = editServiceGroups.find((item) => item.key === editingServiceGroupKey);
    const editDurations = [];
    for (const item of editingServiceGroup?.servicios || []) {
      const tipo = item.duracion_tipo || "meses";
      const cantidad = Number(item.duracion_cantidad || 1);
      const key = `${tipo}:${cantidad}`;
      if (!editDurations.some((duration) => duration.key === key)) {
        editDurations.push({ key, tipo, cantidad, servicio_id: item.id });
      }
    }
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
                  <th>Credenciales</th>
                  <th>Estado</th>
                  <th>Fecha inicio</th>
                  <th>Fecha final</th>
                  <th>Días restantes</th>
                  <th>WhatsApp</th>
                  <th>Reporte</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const status = accountStatus(s);
                  const wa = whatsappHref(s);
                  const assignment = activeAssignmentBySubscription[s.id] || (() => {
                    const last = (data.asignaciones || []).find(a => a.suscripcion_id === s.id);
                    if (!last) return null;
                    const item = [...(data.inventario || []), ...(data.inventario_externo || [])].find(i => i.id === last.inventario_id);
                    return { ...last, item };
                  })();
                  const editing = editingSubscriptionId === s.id;
                  
                  return (
                    <tr key={s.id} className={editing ? "subscriptionEditRow" : ""}>
                      {deleteMode["suscripciones"] && (
                      <td className="selectColumn"><input type="checkbox" aria-label={`Seleccionar ${s.cliente?.nombre || "pedido"}`} checked={selectedDeleteIds("suscripciones").includes(s.id)} onChange={() => toggleDeleteSelection("suscripciones", s.id)} /></td>
                      ) }
                      <td><strong>{s.cliente?.nombre || "Cliente"}</strong>{s.cliente?.username && <small>@{s.cliente.username}</small>}</td>
                      <td>{editing ? (
  <select aria-label="Servicio" value={editingServiceGroupKey} onChange={(e) => {
    const group = editServiceGroups.find((item) => item.key === e.target.value);
    if (!group) return;
    // Mantener el servicio exacto si ya pertenece al grupo elegido.
    const first = group.servicios[0];
    setSubscriptionEditForm((prev) => ({
      ...prev,
      servicio_id: String(first.id),
      duracion_tipo: first.duracion_tipo || "meses",
      duracion_cantidad: Number(first.duracion_cantidad || 1)
    }));
  }}>
    {editServiceGroups.map((group) => (
      <option key={group.key} value={group.key}>{group.nombre}</option>
    ))}
  </select>
) : <div className="jcServiceAndDuration"><strong>{s.servicio?.nombre || "Servicio"}</strong>{view === "activas" && <small>Duración: {durationText(inferOrderDuration(s.fecha_inicio, s.fecha_vencimiento).tipo, inferOrderDuration(s.fecha_inicio, s.fecha_vencimiento).cantidad)}</small>}</div>}</td>
                      <td>{editing && assignment ? (
                        <select aria-label="Perfil o cupo libre" value={subscriptionEditForm.cupo_numero} onChange={(e) => setSubscriptionEditForm((prev) => ({ ...prev, cupo_numero: e.target.value }))}>
                          {Array.from({ length: assignment.item?.etiqueta === "externa" ? 50 : Number(assignment.item?.cupos_total || 1) }, (_, index) => index + 1)
                            .filter((slot) => slot === Number(assignment.cupo_numero) || !(data.asignaciones || []).some((a) => a.activo && a.id !== assignment.id && a.inventario_id === assignment.inventario_id && Number(a.cupo_numero) === slot))
                            .map((slot) => <option value={slot} key={slot}>{slot === Number(assignment.cupo_numero) ? `Perfil ${slot} (actual)` : `Perfil ${slot} (libre)`}</option>)}
                        </select>
                      ) : assignment ? `${effectiveDeliveryType(s.servicio) === "estandar" ? "Perfil" : "Cupo"} ${assignment.cupo_numero}` : "—"}</td>
                      <td>
  {assignment?.item ? (
    <details className="credentialsDetails" open={editingCredentialsId === assignment.id ? true : undefined}>
      <summary>🔐 Ver credenciales</summary>

      <div className="credentialsPanel">
        {needsCustomerInvitationEmail(assignment) && (
          <div><strong>Correo del grupo:</strong><span>{assignment.item.grupo || assignment.item.correo || "—"}</span></div>
        )}
        {needsCustomerInvitationEmail(assignment) && assignment.correo_cliente && (
          <div><strong>Correo del cliente:</strong><span>{assignment.correo_cliente}</span></div>
        )}
        {!needsCustomerInvitationEmail(assignment) && (
          <div><strong>{normalizeText(s.servicio?.nombre).includes("emby") ? "Usuario:" : "Cuenta:"}</strong><span>{assignment.item.correo || "—"}</span></div>
        )}
        {extractEmbyServer(assignment.item.notas) && (
          <div><strong>Servidor:</strong><span>{extractEmbyServer(assignment.item.notas)}</span></div>
        )}
        {assignment.item.clave && <div><strong>Contraseña:</strong><span>{assignment.item.clave}</span></div>}
        <div><strong>Perfil / cupo:</strong><span>{assignment.cupo_numero}</span></div>
        {(assignment.item.perfiles_pins?.[String(assignment.cupo_numero)] || assignment.item.pin) && (
          <div><strong>PIN:</strong><span>{assignment.item.perfiles_pins?.[String(assignment.cupo_numero)] || assignment.item.pin}</span></div>
        )}
        <button type="button" className="miniButton" onClick={() => beginCredentialsEdit(assignment)}>✏️ Corregir credenciales / cupo</button>
        {renderCredentialsEditor(assignment)}
      </div>
    </details>
  ) : (
    <span className="noPhone">Sin credenciales</span>
  )}
</td>
                      <td><span className={status.className}>{status.text}</span></td>
                      <td>{editing ? <input type="date" value={subscriptionEditForm.fecha_inicio} onChange={(e) => setSubscriptionEditForm((prev) => ({ ...prev, fecha_inicio: e.target.value }))} /> : formatDate(s.fecha_inicio)}</td>
                      <td>{editing ? (
                        <div style={{display:"grid",gap:6,minWidth:175}}>
                          <label style={{fontSize:12,fontWeight:600}}>Tiempo del pedido</label>
                          <select
                            aria-label="Duración configurada para el servicio"
                            style={{width:"100%",minWidth:170}}
                            value={`${subscriptionEditForm.duracion_tipo}:${Number(subscriptionEditForm.duracion_cantidad)}`}
                            onChange={(e) => {
                              const selected = editDurations.find((duration) => duration.key === e.target.value);
                              if (!selected) return;
                              setSubscriptionEditForm((prev) => ({
                                ...prev,
                                duracion_tipo: selected.tipo,
                                duracion_cantidad: selected.cantidad,
                                // Con una cuenta asignada conservamos el ID del servicio del stock.
                                // En pedidos sin asignación sí usamos la variante del catálogo.
                                servicio_id: assignment ? prev.servicio_id : String(selected.servicio_id)
                              }));
                            }}
                          >
                            {!editDurations.some((duration) => duration.key === `${subscriptionEditForm.duracion_tipo}:${Number(subscriptionEditForm.duracion_cantidad)}`) && (
                              <option value={`${subscriptionEditForm.duracion_tipo}:${Number(subscriptionEditForm.duracion_cantidad)}`}>
                                Actual: {durationText(subscriptionEditForm.duracion_tipo, subscriptionEditForm.duracion_cantidad)} (no configurada)
                              </option>
                            )}
                            {editDurations.map((duration) => (
                              <option key={duration.key} value={duration.key}>{durationText(duration.tipo, duration.cantidad)}</option>
                            ))}
                          </select>
                          <small>Nuevo vencimiento: {formatDate(addDuration(subscriptionEditForm.fecha_inicio, subscriptionEditForm.duracion_tipo, subscriptionEditForm.duracion_cantidad))}</small>
                        </div>
                      ) : formatDate(s.fecha_vencimiento)}</td>
                      <td><span className={`daysBadge ${daysTone(s.days)}`}>{remainingText(s.days)}</span></td>
                      <td>{wa ? (
  <button
    type="button"
    className="waTableButton"
    onClick={() => openSubscriptionWhatsapp(s, wa)}
    title="Copiar el mensaje correspondiente y abrir WhatsApp (pegar con Ctrl+V)"
  >
    WhatsApp
  </button>
) : (
  <span className="noPhone">Sin WhatsApp</span>
)}</td>

<td>
  {s.reporte_vencimiento ? (
    <span className="status ok">Reportada</span>
  ) : (
    <span className="status suspendedStatus">Pendiente</span>
  )}
</td>
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
    const orderInventoryOptions = deliveryInventoryOptions;
    const orderUsesInventory = Boolean(selectedService && orderSource === "stock" && orderInventoryOptions.length > 0);
    const orderUsesExternal = Boolean(selectedService && orderSource === "external");
    const orderSlots = availableSlots(selectedInventoryItem);
    
    const orderExpiry = orderUsesInventory
  ? addDuration(
      deliveryForm.fecha_inicio || todayISO(),
      selectedService?.duracion_tipo || "meses",
      Number(selectedService?.duracion_cantidad || 1)
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
            <input autoComplete="off" placeholder="Buscar cliente por nombre, usuario o WhatsApp" value={clientQuery} onFocus={() => setShowClientMatches(true)} onBlur={() => setTimeout(() => setShowClientMatches(false), 160)} onChange={(e) => handleClientQuery(e.target.value)} required />
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
                  {duplicateClientByName && <p role="alert" style={{ color: "#ff9c9c" }}>⚠️ Ya existe «{duplicateClientByName.nombre}». No se permite duplicar nombres.</p>}
                  <label>Usuario<input value={clientForm.username} onChange={(e)=>setClientForm({...clientForm,username:e.target.value})}/></label>
                  <label>Teléfono / usuario WhatsApp<input value={clientForm.telefono} onChange={(e)=>setClientForm({...clientForm,telefono:e.target.value})}/></label>
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
              <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
                <button type="button" className="miniButton" disabled={working} onClick={async (event) => {
                  setWorking(true);
                  setError("");
                  try { await refresh(); setMessage("Disponibilidad del stock actualizada."); }
                  catch (e) { setError(e.message || "No se pudo actualizar el stock."); }
                  finally { setWorking(false); }
                }}>↻ Actualizar cupos del stock</button>
              </div>
              <div className="orderSourceGrid">
                {orderInventoryOptions.length > 0 && (
                  <button type="button" className={`orderSourceCard ${orderSource === "stock" ? "active" : ""}`} onClick={() => { setOrderSource("stock"); setGeneratedDelivery(null); }}>
                    <b>📦 Usar stock</b><span>{orderInventoryOptions.length} cuenta(s) con cupos disponibles</span>
                  </button>
                )}
                <button type="button" className={`orderSourceCard ${orderSource === "external" ? "active" : ""}`} onClick={() => { setOrderSource("external"); setGeneratedDelivery(null); }}>
                  <b>🔐  / perfil por fuera</b><span>Ingresa aquí las credenciales compradas individualmente</span>
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
                <label>{effectiveDeliveryType(selectedService) === "estandar" ? "Perfil disponible" : "Cupo disponible"}
                  <select value={deliveryForm.cupo_numero} onChange={(e) => setDeliveryForm((prev) => ({ ...prev, cupo_numero: e.target.value }))}>
                    {orderSlots.map((slot) => <option key={slot} value={slot}>{effectiveDeliveryType(selectedService) === "estandar" ? `Perfil ${slot}` : `Cupo ${slot}`}</option>)}
                  </select>
                </label>
              )}

              {(effectiveDeliveryType(selectedService) === "gemini" || isYoutubeFamilyInventory(selectedInventoryItem, selectedService)) && (
                <label>Correo Gmail del cliente
                  <input type="email" placeholder="Correo que proporciona el cliente" value={deliveryForm.correo_cliente} onChange={(e) => setDeliveryForm((prev) => ({ ...prev, correo_cliente: e.target.value }))} required />
                </label>
              )}
            </div>
          )}

          {selectedService && orderUsesExternal && (
            <div className="orderCredentialBox externalCredentialsBox">
              <div className="externalBoxTitle"><div><b>🔐 Credenciales externas</b><span>No se agregan al stock. Quedan ligadas únicamente a este pedido y el cliente podrá consultarlas.</span></div></div>
              {isYoutubeService(selectedService) && (
                <div className="orderSourceGrid" style={{marginBottom:12}}>
                  <button type="button" className={`orderSourceCard ${youtubeExternalMode === "grupo" ? "active" : ""}`} onClick={() => setYoutubeExternalMode("grupo")}>👨‍👩‍👧‍👦 Grupo familiar</button>
                  <button type="button" className={`orderSourceCard ${youtubeExternalMode === "clave" ? "active" : ""}`} onClick={() => setYoutubeExternalMode("clave")}>🔑 Con contraseña</button>
                </div>
              )}
              <div className="twoCols">
                <label>Proveedor (opcional)
                  <select value={externalOrderForm.proveedor_id} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, proveedor_id: e.target.value }))}>
                    <option value="">Sin proveedor</option>
                    {(data.proveedores || []).filter((provider) => provider.activo !== false).map((provider) => <option key={provider.id} value={provider.id}>{provider.iniciales}</option>)}
                  </select>
                </label>
                {!(isYoutubeService(selectedService) && youtubeExternalMode === "grupo") && (
                  <label>{selectedType === "gemini" ? "Correo / grupo" : "Correo / acceso"}
                    <input placeholder="correo@cuenta.com" value={externalOrderForm.correo} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, correo: e.target.value }))} required />
                  </label>
                )}
              </div>
              {isYoutubeService(selectedService) && youtubeExternalMode === "grupo" && (
                <div className="twoCols" style={{marginTop: 12}}>
                  <label>Grupo familiar de YouTube
                    <input placeholder="Ej. Familia 1 / Grupo 2" value={externalOrderForm.grupo || ""} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, grupo: e.target.value }))} required />
                  </label>
                  <label>Correo Gmail del cliente (para la invitación)
                    <input type="email" placeholder="cliente@gmail.com" value={externalOrderForm.correo_cliente || ""} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, correo_cliente: e.target.value }))} required />
                  </label>
                </div>
              )}
              {normalizeText(selectedService?.nombre).includes("emby") && (
                <label>Servidor Emby
                  <input placeholder="Servidor Emby" value={externalOrderForm.servidor || ""} onChange={e => setExternalOrderForm(p => ({...p,servidor:e.target.value}))} />
                </label>
              )}
              <div className="threeCols externalCredentialGrid">
                {!(isYoutubeService(selectedService) && youtubeExternalMode === "grupo") && (
                  <label>Contraseña (opcional)<input placeholder="Si aplica" value={externalOrderForm.clave} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, clave: e.target.value }))} /></label>
                )}
                <label>{selectedType === "estandar" || selectedType === "manual" ? "Número de perfil" : "Número de cupo"}
                  <input type="number" onWheel={bloquearScrollNumerico} inputMode="numeric" min="1" max="50" value={externalOrderForm.perfil} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, perfil: e.target.value }))} required />
                </label>
                {!(isYoutubeService(selectedService) && youtubeExternalMode === "grupo") && (
                  <label>PIN (opcional)<input inputMode="numeric" placeholder="Si aplica" value={externalOrderForm.pin} onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, pin: e.target.value }))} />
                  </label>
                )}
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
            <div className="moneyInputWrap"><span>$</span><input type="number" onWheel={bloquearScrollNumerico} inputMode="numeric" min="0" step="1" placeholder="Ej. 12000" value={profitValue} onChange={(e) => setProfitValue(e.target.value)} required /></div>
          </label>

          <button className="button primary orderSubmit" disabled={working || profitValue === "" || Number(profitValue) < 0 || !subForm.cliente_id || !subForm.servicio_id || (orderUsesInventory && (!deliveryForm.inventario_id || !deliveryForm.cupo_numero)) || (orderUsesExternal && (!(isYoutubeService(selectedService) && youtubeExternalMode === "grupo" ? (String(externalOrderForm.grupo || "").trim() && String(externalOrderForm.correo_cliente || "").trim()) : String(externalOrderForm.correo || "").trim()) || !Number(externalOrderForm.perfil)))}>
            {working ? "Guardando..." : orderUsesInventory ? "Crear pedido y generar entrega" : orderUsesExternal ? "Crear pedido externo y generar entrega" : "Agregar pedido"}
          </button>

          {generatedDelivery && !generatedDelivery.garantia && (
            <div className="generatedDelivery jcOrderMessages" style={{display:"grid",gap:14,minWidth:0}}>
              <div className="generatedHeader">
                <div><strong>✅ Pedido guardado · 2 mensajes separados</strong><span>Envía el servicio y el acceso al panel por separado.</span></div>
                <button type="button" className="generatedClose" aria-label="Cerrar mensajes" onClick={() => setGeneratedDelivery(null)}>×</button>
              </div>
              <section className="jcOrderMessageCard">
                <h3>📦 Mensaje 1 — Datos del pedido</h3>
                <textarea readOnly value={generatedDelivery.text || ""} />
                <div className="inlineActions">
                  <button type="button" className="miniButton primaryMini" onClick={(event)=>copyText(generatedDelivery.text,event)}>📋 Copiar pedido</button>
                  {orderWhatsapp && <button type="button" className="waTableButton" onClick={async(event)=>{
                    const task=copyText(generatedDelivery.text,event);
                    window.open(whatsappUrl(generatedDelivery.cliente.telefono,""),"_blank","noopener,noreferrer");
                    await task;
                  }}>💬 Abrir WhatsApp</button>}
                </div>
              </section>
              <section className="jcOrderMessageCard">
                <h3>🔐 Mensaje 2 — Acceso al panel</h3>
                <p style={{fontSize:12,color:"#a9c9e8",margin:"4px 0 10px"}}>{generatedDelivery.accessIsNew
                  ? "Cliente nuevo: incluye la contraseña que acabas de crear. Compártela por privado y cierra este mensaje al terminar."
                  : "Cliente existente: conserva su contraseña actual; no la modificamos ni la mostramos."}</p>
                <textarea readOnly value={generatedDelivery.accessText || ""}/>
                <div className="inlineActions">
                  <button type="button" className="miniButton primaryMini" onClick={(event)=>copyText(generatedDelivery.accessText,event)}>📋 Copiar acceso</button>
                  {orderWhatsapp && <button type="button" className="waTableButton" onClick={async(event)=>{
                    const task=copyText(generatedDelivery.accessText,event);
                    window.open(whatsappUrl(generatedDelivery.cliente.telefono,""),"_blank","noopener,noreferrer");
                    await task;
                  }}>💬 Abrir WhatsApp</button>}
                </div>
              </section>
              <div className="inlineActions">
                <button type="button" className="miniButton" onClick={(event)=>copyText(orderMessagesCombined(generatedDelivery),event)}>📋 Copiar ambos mensajes</button>
              </div>
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

  function accountSearchText(s) {
  const assignment = activeAssignmentBySubscription[s.id];
  const item = assignment?.item || {};
  const status = accountStatus(s);

  return [
    // Cliente
    s.cliente?.nombre,
    s.cliente?.username,
    s.cliente?.telefono,

    // Servicio
    s.servicio?.nombre,
    s.servicio?.tipo_entrega,
    s.servicio?.duracion_tipo,
    s.servicio?.duracion_cantidad,

    // Pedido
    s.fecha_inicio,
    s.fecha_vencimiento,
    s.ganancia_neta,
    s.fecha_ganancia,
    s.fecha_reporte,
    s.fecha_inicio,
s.fecha_inicio ? formatDate(s.fecha_inicio) : "",
s.fecha_vencimiento,
s.fecha_vencimiento ? formatDate(s.fecha_vencimiento) : "",

    // Perfil / cupo
    assignment?.cupo_numero,

    // Credenciales
    item.correo,
    item.grupo,
    item.clave,
    item.pin,

    // PIN por perfil
    ...Object.values(item.perfiles_pins || {}),

    // Inventario
    item.fecha_carga,
    item.fecha_vencimiento,
    item.estado,
    item.etiqueta,
    item.notas,
    item.cupos_total,
    item.duracion_tipo,
    item.duracion_cantidad,

    // Estado mostrado
    status.text,
    remainingText(s.days),
    s.reporte_vencimiento ? "reportada" : "pendiente",

    // Proveedor
    item.proveedores?.iniciales,
    item.proveedor?.iniciales
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(" ")
    .toLowerCase();
}

function getAccountFilterValue(s, field) {
  const assignment = activeAssignmentBySubscription[s.id];
  const item = assignment?.item || {};

  switch (field) {
    case "cliente":
      return s.cliente?.nombre || "";

    case "usuario":
      return s.cliente?.username || "";

    case "telefono":
      return s.cliente?.telefono || "";

    case "servicio":
      return s.servicio?.nombre || "";

    case "tipo_cuenta":
      if (item.etiqueta === "externa") return "por fuera";
      if (!item.id) return "sin credenciales";
      return "stock";

    case "correo":
      return item.correo || assignment?.correo_cliente || "";

    case "perfil":
      return assignment?.cupo_numero || "";

    case "proveedor":
      return item.proveedores?.nombre || item.proveedor?.nombre || "";

    case "fecha_inicio":
      return s.fecha_inicio || "";

    case "fecha_vencimiento":
      return s.fecha_vencimiento || "";

    case "estado":
      return accountStatus(s).text || "";

    default:
      return accountSearchText(s);
  }
}

 function renderActivas() {

const filtered = activeSubs.filter((s) => {
  const value = String(
    getAccountFilterValue(s, activeFilterField)
  ).toLowerCase().trim();

  const search = activeFilterValue.toLowerCase().trim();

  if (!search) return true;

  if (activeFilterField === "fecha_inicio" ||
      activeFilterField === "fecha_vencimiento") {
    return value === search;
  }

  return value.includes(search);
});
return (
<>
<div className="pageHeading">
<p className="muted">Cuentas</p>
<h1>Cuentas activas</h1>
<p className="pageLead">
Solo aparecen cuentas con 1 día o más restante.
</p>

<div className="accountFilters">

  <select
    value={activeFilterField}
    onChange={(e) => {
      setActiveFilterField(e.target.value);
      setActiveFilterValue("");
    }}
  >
    <option value="todos">Todos</option>
    <option value="cliente">Cliente</option>
    <option value="usuario">Usuario</option>
    <option value="telefono">Teléfono</option>
    <option value="servicio">Servicio</option>
    <option value="tipo_cuenta">Tipo de cuenta</option>
    <option value="correo">Correo</option>
    <option value="perfil">Perfil / cupo</option>
    <option value="proveedor">Proveedor</option>
    <option value="fecha_inicio">Fecha de inicio</option>
    <option value="fecha_vencimiento">Fecha de vencimiento</option>
    <option value="estado">Estado</option>
  </select>

  {activeFilterField === "fecha_inicio" ||
   activeFilterField === "fecha_vencimiento" ? (
    <input
      type="date"
      value={activeFilterValue}
      onChange={(e) => setActiveFilterValue(e.target.value)}
    />
  ) : activeFilterField === "tipo_cuenta" ? (
    <select
      value={activeFilterValue}
      onChange={(e) => setActiveFilterValue(e.target.value)}
    >
      <option value="">Todas</option>
      <option value="stock">Stock</option>
      <option value="por fuera">Por fuera</option>
      <option value="sin credenciales">Sin credenciales</option>
    </select>
  ) : activeFilterField === "estado" ? (
    <select
      value={activeFilterValue}
      onChange={(e) => setActiveFilterValue(e.target.value)}
    >
      <option value="">Todos</option>
      <option value="activo">Activo</option>
      <option value="vencido">Vencido</option>
      <option value="suspendido">Suspendido</option>
    </select>
  ) : (
    <input
      className="accountSearch"
      placeholder="🔎 Escribe para buscar..."
      value={activeFilterValue}
      onChange={(e) => setActiveFilterValue(e.target.value)}
    />
  )}

</div>

</div>

{renderAccountsTable(filtered, "No hay cuentas activas.")}
</>
);
}
  function renderVencidas() {

const filtered = expiredSubs.filter((s) => {
  const value = String(
    getAccountFilterValue(s, expiredFilterField)
  ).toLowerCase().trim();

  const search = expiredFilterValue.toLowerCase().trim();

  if (!search) return true;

  if (expiredFilterField === "fecha_inicio" ||
      expiredFilterField === "fecha_vencimiento") {
    return value === search;
  }

  return value.includes(search);
});

return (
<>
<div className="pageHeading">
<p className="muted">Alertas</p>
<h1>Cuentas vencidas</h1>

<div className="accountFilters">

  <select
    value={expiredFilterField}
    onChange={(e) => {
      setExpiredFilterField(e.target.value);
      setExpiredFilterValue("");
    }}
  >
    <option value="todos">Todos</option>
    <option value="cliente">Cliente</option>
    <option value="usuario">Usuario</option>
    <option value="telefono">Teléfono</option>
    <option value="servicio">Servicio</option>
    <option value="tipo_cuenta">Tipo de cuenta</option>
    <option value="correo">Correo</option>
    <option value="perfil">Perfil / cupo</option>
    <option value="proveedor">Proveedor</option>
    <option value="fecha_inicio">Fecha de inicio</option>
    <option value="fecha_vencimiento">Fecha de vencimiento</option>
    <option value="estado">Estado</option>
  </select>

  {expiredFilterField === "fecha_inicio" ||
   expiredFilterField === "fecha_vencimiento" ? (
    <input
      type="date"
      value={expiredFilterValue}
      onChange={(e) => setExpiredFilterValue(e.target.value)}
    />
  ) : expiredFilterField === "tipo_cuenta" ? (
    <select
      value={expiredFilterValue}
      onChange={(e) => setExpiredFilterValue(e.target.value)}
    >
      <option value="">Todas</option>
      <option value="stock">Stock</option>
      <option value="por fuera">Por fuera</option>
      <option value="sin credenciales">Sin credenciales</option>
    </select>
  ) : expiredFilterField === "estado" ? (
    <select
      value={expiredFilterValue}
      onChange={(e) => setExpiredFilterValue(e.target.value)}
    >
      <option value="">Todos</option>
      <option value="activo">Activo</option>
      <option value="vencido">Vencido</option>
      <option value="suspendido">Suspendido</option>
    </select>
  ) : (
    <input
      className="accountSearch"
      placeholder="🔎 Escribe para buscar..."
      value={expiredFilterValue}
      onChange={(e) => setExpiredFilterValue(e.target.value)}
    />
  )}

</div>

</div>

{renderAccountsTable(filtered,"No hay cuentas vencidas.")}
</>
);
}

async function saveProfitEdit(item) {
  const value = Number(profitEditValue);

  if (!Number.isFinite(value) || value < 0) {
    setError("Escribe una ganancia válida.");
    return;
  }

  await runAction(
    () =>
      api("/api/admin/suscripciones", {
        method: "PATCH",
        body: JSON.stringify({
          id: item.id,
          action: "editar_ganancia",
          es_ganancia_renovacion: item.es_renovacion === true,
          ganancia_neta: value
        })
      }),
    "Ganancia actualizada correctamente."
  );

  setEditingProfitId("");
  setProfitEditValue("");
}

  function renderGanancias() {
  const rows = (data.ganancias || [])
    .filter(
      (item) =>
        item.ganancia_neta !== null &&
        item.ganancia_neta !== undefined &&
        item.ganancia_neta !== "" &&
        Number.isFinite(Number(item.ganancia_neta))
    )
    .map((item) => {
      const subscription =
        (data.suscripciones || []).find((s) => s.id === item.id) || {};

      return {
        ...item,
        cliente: item.cliente || subscription.cliente || null,
        servicio: item.servicio || subscription.servicio || null
      };
    });

  const money = (value) =>
    new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0
    }).format(Number(value || 0));

  const addDaysLocal = (iso, days) => {
    const date = parseISO(iso);
    date.setDate(date.getDate() + days);
    return toISO(date);
  };

  const weekStart = (iso) => {
    const date = parseISO(iso);
    const diff = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - diff);
    return toISO(date);
  };

  const longDay = (iso) =>
    new Intl.DateTimeFormat("es-CO", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(parseISO(iso));

  const monthName = (key) => {
    const value = new Intl.DateTimeFormat("es-CO", {
      month: "long",
      year: "numeric"
    }).format(parseISO(`${key}-01`));

    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  const group = (keyFn, labelFn) => {
    const map = new Map();

    for (const item of rows) {
      const date = item.fecha_ganancia || item.fecha_inicio;
      if (!date) continue;

      const key = keyFn(date);

      const current =
        map.get(key) || {
          key,
          total: 0,
          pedidos: 0,
          items: []
        };

      current.total += Number(item.ganancia_neta || 0);
      current.pedidos += 1;
      current.items.push(item);

      map.set(key, current);
    }

    return [...map.values()]
      .sort((a, b) => b.key.localeCompare(a.key))
      .map((item) => ({
        ...item,
        items: item.items.sort((a, b) =>
          String(a.cliente?.nombre || "").localeCompare(
            String(b.cliente?.nombre || ""),
            "es"
          )
        ),
        label: labelFn(item.key)
      }));
  };

  const daily = group(
    (date) => date,
    (key) => longDay(key)
  );

  const weekly = group(
    (date) => weekStart(date),
    (key) =>
      `Semana del ${formatDate(key)} al ${formatDate(
        addDaysLocal(key, 6)
      )}`
  );

  const monthly = group(
    (date) => String(date).slice(0, 7),
    (key) => monthName(key)
  );

  const visible =
    profitTab === "semanal"
      ? weekly
      : profitTab === "mensual"
      ? monthly
      : daily;

  const today = todayISO();

  const currentKey =
    profitTab === "semanal"
      ? weekStart(today)
      : profitTab === "mensual"
      ? today.slice(0, 7)
      : today;

  const current = visible.find(
    (item) => item.key === currentKey
  );

  const currentTotal = current?.total || 0;

  const currentLabel =
    profitTab === "semanal"
      ? "Ganancia de esta semana"
      : profitTab === "mensual"
      ? `Ganancia de ${monthName(currentKey)}`
      : "Ganancia de hoy";

  return (
    <>
      <div className="pageHeading">
        <p className="muted">Resultados</p>
        <h1>Ganancias</h1>
        <p className="pageLead">
          Los totales incluyen las ganancias netas de los pedidos y de cada renovación, sin reemplazar valores anteriores.
        </p>
      </div>

      {data.ganancias_configuradas === false && (
        <div className="card emptyState">
          La base de datos todavía no tiene activados los campos
          de ganancias. Ejecuta{" "}
          <strong>MIGRACION_V38_DESDE_V37.sql</strong>.
        </div>
      )}

      <div className="profitTabs">
        <button
          type="button"
          className={profitTab === "diaria" ? "active" : ""}
          onClick={() => {
            setProfitTab("diaria");
            setExpandedProfitDay("");
          }}
        >
          Diaria
        </button>

        <button
          type="button"
          className={profitTab === "semanal" ? "active" : ""}
          onClick={() => {
            setProfitTab("semanal");
            setExpandedProfitDay("");
          }}
        >
          Semanal
        </button>

        <button
          type="button"
          className={profitTab === "mensual" ? "active" : ""}
          onClick={() => {
            setProfitTab("mensual");
            setExpandedProfitDay("");
          }}
        >
          Mensual
        </button>
      </div>

      <section className="card profitHero">
        <span>{currentLabel}</span>
        <strong>{money(currentTotal)}</strong>
        <small>
          {current?.pedidos || 0} pedido(s) en este período ·{" "}
          {rows.length} pedido(s) con ganancia registrada en total
        </small>
      </section>

      {visible.length === 0 ? (
        <div className="card emptyState">
          Todavía no hay ganancias registradas.
        </div>
      ) : (
        <div className="profitList">
          {visible.map((item) => {
            const isDaily = profitTab === "diaria";
            const expanded =
              isDaily && expandedProfitDay === item.key;

            return (
              <article className="card profitGroup" key={item.key}>
                <button
                  type="button"
                  className={`profitRow ${
                    isDaily ? "profitRowClickable" : ""
                  }`}
                  onClick={() => {
                    if (!isDaily) return;

                    setExpandedProfitDay(
                      expanded ? "" : item.key
                    );
                  }}
                >
                  <div>
                    <span>{item.label}</span>
                    <small>
                      {item.pedidos} pedido(s)
                    </small>
                  </div>

                  <div className="profitRowAmount">
                    <strong>{money(item.total)}</strong>
                    {isDaily && (
                      <span className="profitChevron">
                        {expanded ? "▲" : "▼"}
                      </span>
                    )}
                  </div>
                </button>

                {expanded && (
                  <div className="profitDetails">
                    {item.items.map((order) => {
                      const editing =
                        editingProfitId === order.id;

                      return (
                        <div
                          className="profitDetailRow"
                          key={order.id}
                        >
                          <div className="profitDetailInfo">
                            <strong>
                              {order.cliente?.nombre ||
                                "Cliente"}
                            </strong>

                            <span>
                              {order.servicio?.nombre ||
                                "Servicio"}
                            </span>
                          </div>

                          {editing ? (
                            <div className="profitEditBox">
                              <input
                                type="number" onWheel={bloquearScrollNumerico}
                                min="0"
                                value={profitEditValue}
                                onChange={(e) =>
                                  setProfitEditValue(
                                    e.target.value
                                  )
                                }
                                autoFocus
                              />

                              <button
                                type="button"
                                className="miniButton primaryMini"
                                onClick={() =>
                                  saveProfitEdit(order)
                                }
                                disabled={working}
                              >
                                Guardar
                              </button>

                              <button
                                type="button"
                                className="miniButton"
                                onClick={() => {
                                  setEditingProfitId("");
                                  setProfitEditValue("");
                                }}
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <div className="profitDetailActions">
                              <strong>
                                {money(order.ganancia_neta)}
                              </strong>

                              <button
                                type="button"
                                className="miniButton"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingProfitId(
                                    order.id
                                  );
                                  setProfitEditValue(
                                    String(
                                      order.ganancia_neta ?? ""
                                    )
                                  );
                                }}
                              >
                                Editar
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
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
          {duplicateClientByName && <p role="alert" style={{ color: "#ff9c9c", margin: "4px 0" }}>⚠️ Ya existe «{duplicateClientByName.nombre}». No se permite duplicar nombres.</p>}
              {duplicateClientByName && <p role="alert" style={{ color: "#ff9c9c", margin: "4px 0" }}>⚠️ Ya existe «{duplicateClientByName.nombre}». No se permite duplicar nombres.</p>}
              <input placeholder="Usuario (ej. Alejandra45)" value={clientForm.username} onChange={(e) => setClientForm({ ...clientForm, username: e.target.value })} required />
              <input placeholder="Número o @usuario de WhatsApp" value={clientForm.telefono} onChange={(e) => setClientForm({ ...clientForm, telefono: e.target.value })} />
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
                  <th>Teléfono / usuario WhatsApp</th>
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
                      <td>{wa ? <a className="waTableButton" href={wa} target="_blank" rel="noreferrer">WhatsApp</a> : <span className="noPhone">Sin WhatsApp</span>}</td>
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
                          <button type="button" className="miniButton primaryMini" onClick={() => openClientAccess(cliente)}>🔐 Entregar acceso</button>
                          <button type="button" className="miniButton" onClick={() => beginClientEdit(cliente)}>Editar</button>
                          <button type="button" className="miniButton dangerMini" disabled={working} onClick={() => beginDeleteSelection("clientes", cliente.id)}>Borrar</button>
                        </div>
                      </td>
                      <td>{wa ? <a className="waTableButton" href={wa} target="_blank" rel="noreferrer">WhatsApp</a> : <span className="noPhone">Sin WhatsApp</span>}</td>
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

  // Carga masiva: se usan exclusivamente las API normales, nunca se escriben
  // tablas de Supabase directamente desde el navegador.
  function renderCargaMasiva() {
    const definitions = {
      clientes: { label: "Clientes", endpoint: "clientes", fields: ["nombre", "username", "telefono", "password"], required: ["nombre", "username", "password"], help: "Cada cliente obtiene su acceso real. La contraseña inicial debe tener al menos 6 caracteres." },
      servicios: { label: "Servicios", endpoint: "servicios", fields: ["nombre", "descripcion", "duracion_tipo", "duracion_cantidad", "tipo_entrega"], required: ["nombre", "duracion_tipo", "duracion_cantidad"], help: "Duración: dias, meses o anios. Tipo: estandar, chatgpt, gemini o manual." },
      proveedores: { label: "Proveedores", endpoint: "proveedores", fields: ["iniciales"], required: ["iniciales"], help: "Iniciales únicas (máximo 8 caracteres)." },
      inventario: { label: "Cuentas streaming", endpoint: "inventario", fields: ["servicio", "proveedor", "correo", "clave", "grupo", "cupos_total", "duracion_tipo", "duracion_cantidad", "fecha_carga", "notas", "pins_por_perfil"], required: ["servicio", "proveedor", "cupos_total"], help: "Servicio y proveedor deben existir. Formato PIN opcional: 1:1234;2:5678. El stock libre lo calcula el panel." },
      promociones: { label: "Promociones", endpoint: "promociones", fields: ["titulo", "descripcion", "precio", "fecha_inicio", "fecha_fin"], required: ["titulo", "fecha_inicio", "fecha_fin"], help: "Fechas en formato AAAA-MM-DD. El panel controlará la vigencia." }
    };
    const cfg = definitions[bulkKind];
    const normal = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    function parseRows(raw, sep) {
      const text = String(raw || "").replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").trim();
      if (!text) return [];
      const lines = []; let line = [], cell = "", quoted = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') { if (quoted && text[i+1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
        else if (c === sep && !quoted) { line.push(cell); cell = ""; }
        else if (c === "\n" && !quoted) { line.push(cell); lines.push(line); line = []; cell = ""; }
        else cell += c;
      }
      line.push(cell); lines.push(line);
      const isHeader = lines[0]?.some((value) => cfg.fields.includes(normal(value)));
      const records = isHeader ? lines.slice(1) : lines;
      const headers = isHeader ? lines[0].map(normal) : cfg.fields;
      return records.filter((values) => values.some((v) => String(v).trim())).map((values, index) => {
        const item = { _key: `${Date.now()}-${index}`, _status: "pendiente", _error: "" };
        cfg.fields.forEach((field, idx) => { const pos = isHeader ? headers.indexOf(field) : idx; item[field] = pos < 0 ? "" : String(values[pos] ?? "").trim(); });
        return item;
      });
    }
    function ingest(raw, preferred) {
      const separator = preferred || (raw.includes("\t") ? "\t" : raw.includes(";") ? ";" : ",");
      const next = parseRows(raw, separator);
      setBulkRows(next); setBulkReport(null);
      setBulkPaste("");
      if (!next.length) setError("No se encontraron filas válidas para revisar.");
      else setMessage(`${next.length} fila(s) cargadas. Revisa antes de guardar.`);
    }
    const updateRow = (key, field, value) => setBulkRows((prev) => prev.map((r) => r._key === key ? { ...r, [field]: value, _status: "pendiente", _error: "" } : r));
    function getPayload(row) {
      const fields = Object.fromEntries(cfg.fields.map((field) => [field, String(row[field] || "").trim()]));
      const missing = cfg.required.filter((field) => !fields[field]);
      if (missing.length) throw new Error(`Faltan: ${missing.join(", ")}`);
      if (bulkKind === "clientes" && fields.password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
      if (bulkKind === "servicios") return { ...fields, duracion_cantidad: Number(fields.duracion_cantidad), duracion_tipo: fields.duracion_tipo || "meses", tipo_entrega: fields.tipo_entrega || "estandar" };
      if (bulkKind === "inventario") {
        const service = data.servicios.find((s) => normal(s.nombre) === normal(fields.servicio) && s.activo !== false);
        const matches = data.servicios.filter((s) => normal(s.nombre) === normal(fields.servicio) && s.activo !== false);
        if (!service) throw new Error("Servicio no encontrado: " + fields.servicio);
        if (matches.length > 1) throw new Error("Hay varias duraciones del servicio. Usa el formulario normal de inventario para elegir con precisión.");
        const provider = data.proveedores.find((pr) => normal(pr.iniciales) === normal(fields.proveedor) && pr.activo !== false);
        if (!provider) throw new Error("Proveedor no encontrado: " + fields.proveedor);
        const pins = {};
        if (fields.pins_por_perfil) for (const part of fields.pins_por_perfil.split(";")) {
          const found = /^\s*(\d+)\s*:\s*(.+)\s*$/.exec(part);
          if (!found) throw new Error("PIN inválido; usa 1:1234;2:5678");
          pins[found[1]] = found[2].trim();
        }
        return { servicio_id: service.id, proveedor_id: provider.id, correo: fields.correo, clave: fields.clave, grupo: fields.grupo, cupos_total: Number(fields.cupos_total), duracion_tipo: fields.duracion_tipo || (effectiveDeliveryType(service) === "gemini" ? "meses" : "dias"), duracion_cantidad: Number(fields.duracion_cantidad || (effectiveDeliveryType(service) === "gemini" ? 1 : 30)), fecha_carga: fields.fecha_carga || todayISO(), notas: fields.notas, perfiles_pins: pins };
      }
      return fields;
    }
    async function saveAll() {
      const pending = bulkRows.filter((row) => row._status !== "ok");
      if (!pending.length || bulkBusy) return;
      if (!window.confirm(`Se crearán hasta ${pending.length} registros de ${cfg.label}. ¿Continuar?`)) return;
      setBulkBusy(true); setError(""); setBulkReport(null);
      let success = 0, failed = 0;
      const next = bulkRows.map((row) => ({ ...row }));
      for (const row of next) {
        if (row._status === "ok") continue;
        try {
          const payload = getPayload(row);
          await api(`/api/admin/${cfg.endpoint}`, { method: "POST", body: JSON.stringify(payload) });
          row._status = "ok"; row._error = ""; success++;
        } catch (e) { row._status = "error"; row._error = e.message || "Error al guardar"; failed++; }
        setBulkRows(next.map((r) => ({ ...r })));
      }
      try { await refresh(); } catch (e) { setError("Los registros se procesaron, pero falló la actualización: " + e.message); }
      setBulkReport({ success, failed }); setBulkBusy(false);
      setMessage(`${success} registros creados · ${failed} con errores. Los exitosos no se repetirán.`);
    }
    return <>
      <div className="pageHeading"><p className="muted">Gestión de datos</p><h1>📋 Carga masiva</h1><p className="pageLead">Copia filas desde Excel, revisa los datos y guárdalos en el panel sin alterar las automatizaciones.</p></div>
      <div className="card jcBulkPanel">
        <div className="jcBulkTop"><div><h2>¿Qué quieres registrar?</h2><p>Elige una categoría antes de pegar información.</p></div>
          <select aria-label="Tipo de carga masiva" disabled={bulkBusy} value={bulkKind} onChange={(e) => { setBulkKind(e.target.value); setBulkRows([]); setBulkReport(null); setBulkPaste(""); }}>
            {Object.entries(definitions).map(([value, v]) => <option key={value} value={value}>{v.label}</option>)}
          </select></div>
        <p className="jcBulkHint">{cfg.help}</p>
        <p className="jcBulkHint"><strong>Orden de columnas:</strong> {cfg.fields.join(" · ")}</p>
        <div className="jcBulkActions"><button type="button" className="miniButton" onClick={(event) => copyText(cfg.fields.join("\t"), event)}>📋 Copiar encabezados para Excel</button><button type="button" className="miniButton" onClick={() => { const content = '\uFEFF' + cfg.fields.join(';') + '\n'; const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href=url; a.download=`juan-cuentas-${bulkKind}.csv`; a.click(); URL.revokeObjectURL(url); }}>⬇ Descargar plantilla CSV</button></div>
        <label className="jcBulkLabel">Pega aquí tus filas copiadas desde Excel</label>
        <textarea className="jcBulkPaste" value={bulkPaste} onChange={(e) => setBulkPaste(e.target.value)} placeholder={cfg.fields.join("\t")} rows={5} disabled={bulkBusy}/>
        <div className="jcBulkActions"><button type="button" className="miniButton primaryMini" disabled={bulkBusy || !bulkPaste.trim()} onClick={() => ingest(bulkPaste)}>🔎 Revisar filas</button><label className="jcBulkFile">📂 Importar CSV <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={bulkBusy} onChange={async (e) => { const file=e.target.files?.[0]; if (file) { const contents=await file.text(); ingest(contents, file.name.toLowerCase().endsWith('.tsv') ? '\t' : undefined); } e.target.value=''; }}/></label></div>
        <p className="jcBulkNote">Para archivos .xlsx, abre Excel, selecciona las celdas y pégalas aquí. No cargues archivos con contraseñas en equipos compartidos.</p>
      </div>
      {bulkRows.length > 0 && <div className="card jcBulkPanel">
        <div className="jcBulkTop"><div><h2>Vista previa · {bulkRows.length} filas</h2><p>Corrige cualquier celda antes de guardar.</p></div><button className="miniButton" disabled={bulkBusy} onClick={() => {setBulkRows([]);setBulkReport(null);}}>Limpiar lista</button></div>
        <div className="jcBulkScroll"><table className="jcBulkTable"><thead><tr><th>#</th>{cfg.fields.map((field) => <th key={field}>{field.replaceAll('_',' ')}</th>)}<th>Resultado</th><th></th></tr></thead><tbody>
        {bulkRows.map((row, index) => <tr key={row._key}><td>{index+1}</td>{cfg.fields.map((field) => <td key={field}><input aria-label={`${field} fila ${index+1}`} type={field === 'password' || field === 'clave' ? 'password' : 'text'} disabled={bulkBusy || row._status === 'ok'} value={row[field] ?? ''} onChange={(e) => updateRow(row._key,field,e.target.value)}/></td>)}<td className={row._status === 'ok' ? 'jcBulkOk' : row._status === 'error' ? 'jcBulkError' : ''}>{row._status === 'ok' ? '✓ Guardado' : row._error || 'Pendiente'}</td><td><button type="button" className="miniButton dangerMini" disabled={bulkBusy} onClick={() => setBulkRows((prev) => prev.filter((v) => v._key !== row._key))}>Quitar</button></td></tr>)}
        </tbody></table></div>
        {bulkReport && <p className="jcBulkHint">✅ Creados: {bulkReport.success} · ⚠️ Errores: {bulkReport.failed}</p>}
        <div className="jcBulkActions"><button type="button" className="button primary" disabled={bulkBusy || !bulkRows.some((row) => row._status !== 'ok')} onClick={saveAll}>{bulkBusy ? 'Guardando…' : `Guardar ${bulkRows.filter((row) => row._status !== 'ok').length} registros`}</button></div>
      </div>}
      <div className="card jcBulkPanel"><strong>🔒 Procesos protegidos</strong><p>Esta herramienta no elimina registros, no crea pedidos ni renueva servicios, no ocupa o libera perfiles y no modifica ganancias. Todas las altas pasan por las mismas API del panel. La hoja del proveedor JU no se cambia.</p></div>
    </>;
  }

  function renderCrearCliente() {
    return (
      <>
        <div className="pageHeading"><p className="muted">Clientes</p><h1>Crear cliente</h1><p className="pageLead">Crea su acceso con usuario, celular y contraseña inicial. No necesita correo.</p></div>
        <form className="card adminForm standaloneForm" onSubmit={createClient}>
          <input placeholder="Nombre" value={clientForm.nombre} onChange={(e) => setClientForm({ ...clientForm, nombre: e.target.value })} required />
          <input placeholder="Usuario (ej. Alejandra45)" value={clientForm.username} onChange={(e) => setClientForm({ ...clientForm, username: e.target.value })} required />
          <input placeholder="Número o @usuario de WhatsApp" value={clientForm.telefono} onChange={(e) => setClientForm({ ...clientForm, telefono: e.target.value })} />
          <input placeholder="Contraseña inicial" type="password" minLength={6} value={clientForm.password} onChange={(e) => setClientForm({ ...clientForm, password: e.target.value })} required />
          <button className="button primary" disabled={working}>{working ? "Creando..." : "Crear cliente"}</button>
        </form>
      </>
    );
  }

  const gruposServiciosPlantilla = useMemo(() => {
    const porNombre = new Map();
    for (const servicio of (data.servicios || [])) {
      const clave = claveServicioPlantilla(servicio.nombre);
      if (!clave || porNombre.has(clave)) continue;
      porNombre.set(clave, { id: servicio.id, nombre: servicio.nombre, clave });
    }
    return [...porNombre.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [data.servicios]);

  function limpiarEditorPlantillas() {
    setPlantillaServicioId("");
    setPlantillaBusquedaServicio("");
    setPlantillaNombre("");
    setPlantillaContenido("");
    setPlantillaEditandoId("");
    setPlantillaMostrarServicios(false);
  }

  function elegirServicioPlantilla(grupo) {
    setPlantillaServicioId(grupo.id);
    setPlantillaBusquedaServicio(grupo.nombre);
    setPlantillaMostrarServicios(false);
  }

  function editarPlantillaGuardada(plantilla) {
    const servicio = (data.servicios || []).find((item) => item.id === plantilla.servicio_id);
    const clave = claveServicioPlantilla(servicio?.nombre);
    const grupo = gruposServiciosPlantilla.find((item) => item.clave === clave);
    setPlantillaServicioId(grupo?.id || plantilla.servicio_id);
    setPlantillaBusquedaServicio(grupo?.nombre || servicio?.nombre || "");
    setPlantillaNombre(plantilla.nombre || "Mensaje de entrega");
    setPlantillaContenido(plantilla.contenido || "");
    setPlantillaEditandoId(plantilla.id);
    setPlantillaPestana("crear");
    setPlantillaMostrarServicios(false);
    window.setTimeout(() => document.getElementById("jc-template-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  async function guardarPlantilla(e) {
    e.preventDefault();
    if (!plantillaServicioId || !plantillaContenido.trim()) {
      setError("Selecciona un servicio y escribe el contenido de la plantilla.");
      return;
    }
    const seleccion = (data.servicios || []).find((s) => s.id === plantillaServicioId);
    const clave = claveServicioPlantilla(seleccion?.nombre);
    const otra = (data.plantillas_mensajes || []).find((x) => {
      if (x.id === plantillaEditandoId) return false;
      const servicio = (data.servicios || []).find((s) => s.id === x.servicio_id);
      return claveServicioPlantilla(servicio?.nombre) === clave;
    });
    if (otra) {
      setError(`Ya existe una plantilla para ${seleccion?.nombre || "este servicio"}. Edítala desde Lista de plantillas.`);
      return;
    }
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await api("/api/admin/plantillas", {
        method: plantillaEditandoId ? "PATCH" : "POST",
        body: JSON.stringify({
          ...(plantillaEditandoId ? { id: plantillaEditandoId } : {}),
          servicio_id: plantillaServicioId,
          nombre: plantillaNombre.trim() || "Mensaje de entrega",
          contenido: plantillaContenido
        })
      });
      await refresh();
      limpiarEditorPlantillas();
      setPlantillaPestana("lista");
      setMessage(plantillaEditandoId ? "Plantilla actualizada correctamente." : "Plantilla creada correctamente.");
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  async function borrarPlantilla(plantilla) {
    if (!plantilla || !window.confirm("¿Eliminar esta plantilla? Los siguientes pedidos usarán el mensaje predeterminado.")) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await api("/api/admin/plantillas", { method: "DELETE", body: JSON.stringify({ id: plantilla.id }) });
      await refresh();
      if (plantillaEditandoId === plantilla.id) limpiarEditorPlantillas();
      setMessage("Plantilla eliminada. Se usará el mensaje predeterminado.");
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  function renderPlantillas() {
    const servicio = (data.servicios || []).find((x) => x.id === plantillaServicioId);
    const opciones = gruposServiciosPlantilla.filter((x) => normalizeText(x.nombre).includes(normalizeText(plantillaBusquedaServicio)));
    const lista = (data.plantillas_mensajes || []).filter((plantilla) => {
      const srv = (data.servicios || []).find((x) => x.id === plantilla.servicio_id);
      return normalizeText(`${plantilla.nombre} ${srv?.nombre || ""} ${plantilla.contenido}`).includes(normalizeText(plantillaBusquedaLista));
    });
    const ejemplo = {
      cliente: "María Pérez", servicio: servicio?.nombre || "Netflix", tiempo: "1 mes",
      correo: "cuenta@ejemplo.com", clave: "clave-ejemplo", perfil: "2", pin: "1234",
      proveedor: "JU", fecha_seleccionada: "17 octubre", fecha_creacion: "17 octubre", fecha_inicio: "17 octubre", fecha_vencimiento: "17/11/2026",
      grupo: "familia@ejemplo.com", correo_cliente: "cliente@gmail.com", servidor: "https://servidor-emby.ejemplo"
    };
    return (
      <>
        <div className="pageHeading">
          <p className="muted">Personalización</p>
          <h1>Plantillas de mensajes</h1>
          <p className="pageLead">Organiza mensajes por servicio. Una misma plantilla funciona para todas sus duraciones; el tiempo se obtiene del pedido.</p>
        </div>
        <div className="jcTemplateTabs">
          <button type="button" className={plantillaPestana === "crear" ? "active" : ""} onClick={() => { limpiarEditorPlantillas(); setPlantillaPestana("crear"); }}>✍️ Crear plantilla</button>
          <button type="button" className={plantillaPestana === "lista" ? "active" : ""} onClick={() => { setPlantillaMostrarServicios(false); setPlantillaPestana("lista"); }}>📚 Lista de plantillas <span>{(data.plantillas_mensajes || []).length}</span></button>
        </div>
        {plantillaPestana === "crear" ? (
          <form id="jc-template-editor" className="card adminForm jcTemplateEditor" onSubmit={guardarPlantilla}>
            <div className="jcTemplateSectionHeading"><h2>{plantillaEditandoId ? "Editar plantilla" : "Nueva plantilla"}</h2><p>{plantillaEditandoId ? "Modifica su servicio, título o mensaje y guarda los cambios." : "Selecciona el servicio y personaliza su mensaje de entrega."}</p></div>
            <label>Buscar servicio</label>
            <div className="jcTemplateSelectWrap">
              <input autoComplete="off" value={plantillaBusquedaServicio} onFocus={() => setPlantillaMostrarServicios(true)} onChange={(e) => { setPlantillaBusquedaServicio(e.target.value); setPlantillaServicioId(""); setPlantillaMostrarServicios(true); }} placeholder="🔍 Escribe Canva, Spotify, Netflix..." required />
              {plantillaMostrarServicios && (
                <div className="jcTemplateOptions">
                  {opciones.length ? opciones.map((grupo) => <button type="button" key={grupo.clave} onMouseDown={(e) => e.preventDefault()} onClick={() => elegirServicioPlantilla(grupo)}>{grupo.nombre}</button>) : <p>No encontramos ese servicio.</p>}
                </div>
              )}
            </div>
            {plantillaServicioId && (
              <>
                <p className="fieldHint">✅ La plantilla se utilizará en todos los pedidos de <strong>{servicio?.nombre}</strong>, sin importar si son de 1, 3 o 12 meses.</p>
                <label>Nombre interno
                  <input value={plantillaNombre} onChange={(e) => setPlantillaNombre(e.target.value)} placeholder="Ej. Entrega Netflix" maxLength={120} />
                </label>
                <div className="jcTemplateVariables">
                  <strong>Variables automáticas (toca para copiar)</strong>
                  <div className="jcTemplateTokens">
                    {VARIABLES_PLANTILLA.map((variable) => <button type="button" key={variable} className="miniButton" onClick={(event) => copyText(`{${variable}}`, event)}>{`{${variable}}`}</button>)}
                  </div>
                  <p className="fieldHint">Las variables se rellenan automáticamente al generar el pedido. {`{fecha_seleccionada}`} usa la fecha de inicio seleccionada en el pedido; por ejemplo, «17 octubre».</p>
                </div>
                <label>Texto del mensaje
                  <textarea rows={14} value={plantillaContenido} onChange={(e) => setPlantillaContenido(e.target.value)} placeholder={`🎬 {servicio} x{tiempo}\nCliente: {cliente}\nCorreo: {correo}\nClave: {clave}\nPerfil: {perfil}\nPIN: {pin}`} required style={{minHeight:260, whiteSpace:"pre-wrap"}} />
                </label>
                <div className="jcTemplatePreview"><strong>👀 Vista previa con datos de ejemplo</strong><pre>{plantillaContenido.trim() ? aplicarPlantilla(plantillaContenido, ejemplo) + "\n\nGracias por tu compra y confianza 😁" : REGLAS_PREDETERMINADAS}</pre></div>
                <div className="inlineActions">
                  <button className="button primary" disabled={working || !plantillaContenido.trim()}>{working ? "Guardando..." : plantillaEditandoId ? "Guardar cambios" : "Crear plantilla"}</button>
                  <button type="button" className="miniButton" onClick={limpiarEditorPlantillas}>Limpiar formulario</button>
                  {plantillaEditandoId && <button type="button" className="miniButton" onClick={() => { limpiarEditorPlantillas(); setPlantillaPestana("lista"); }}>Cancelar edición</button>}
                </div>
              </>
            )}
          </form>
        ) : (
          <section className="card jcTemplateList">
            <div className="jcTemplateSectionHeading jcTemplateListHeading"><h2>Plantillas guardadas</h2><p>Busca, edita o elimina cualquier plantilla que hayas creado.</p></div>
            <div className="jcTemplateSearchWrap">
              <span aria-hidden="true" className="jcTemplateSearchIcon">🔎</span>
              <input type="search" aria-label="Buscar plantilla o servicio" placeholder="Buscar plantilla o servicio..." value={plantillaBusquedaLista} onChange={(e) => setPlantillaBusquedaLista(e.target.value)} />
            </div>
            <div className="jcTemplateCards">
              {lista.length === 0 ? <div className="emptyState">No encontramos plantillas. Ve a Crear plantilla para agregar la primera.</div> : lista.map((plantilla) => {
                const srv = (data.servicios || []).find((x) => x.id === plantilla.servicio_id);
                return (
                  <article key={plantilla.id} className="jcTemplateCard">
                    <div className="jcTemplateCardTop"><strong><span className="jcTemplateServiceName">{claveServicioPlantilla(srv?.nombre || "Servicio")}</span><span className="jcTemplateNameSeparator"> — </span>{plantilla.nombre || "Sin nombre"}</strong></div>
                    <div className="inlineActions"><button type="button" className="miniButton primaryMini" onClick={() => editarPlantillaGuardada(plantilla)}>✏️ Editar</button><button type="button" className="miniButton dangerMini" disabled={working} onClick={() => borrarPlantilla(plantilla)}>Eliminar</button></div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
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

            {bulkDeleteBar("servicios", filteredServices.map((service) => service.id), "/api/admin/servicios", "servicio")}
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

  function renderRenovacionDesdeAviso() {
    const sub = enrichedSubs.find(item => item.id === renewalTargetId);
    return <>
      <div className="pageHeading">
        <p className="muted">AVISOS DE INVENTARIO</p>
        <h1>Renovar pedido del cliente</h1>
        <p className="pageLead">Selecciona la fecha, duración, ganancia y cuenta o perfil. El aviso se confirma únicamente cuando la renovación se guarda.</p>
      </div>
      {!sub ? <div className="card emptyState">El pedido ya no está disponible. Regresa a los avisos.</div> :
        <div className="card jcStandaloneRenewCard">
          <div className="jcRenewSummary">
            <strong>{sub.cliente?.nombre || "Cliente"}</strong>
            <span>{sub.servicio?.nombre || "Servicio"}</span>
            <small>Vencimiento anterior: {formatDate(sub.fecha_vencimiento)} · {remainingText(sub.days)}</small>
          </div>
          {renewalDelivery?.id === sub.id && <div className="generatedDelivery" style={{marginBottom:18,padding:14,border:"1px solid #3985ab",borderRadius:12,background:"#07182a"}}>
            <strong>✅ Renovación guardada · mensaje listo para enviar</strong>
            <textarea aria-label="Mensaje para enviar" readOnly value={renewalDelivery.text} style={{display:"block",width:"100%",minHeight:155,boxSizing:"border-box",marginTop:10,marginBottom:10}} />
            <div className="inlineActions"><button type="button" className="miniButton primaryMini" onClick={event=>copyText(renewalDelivery.text,event)}>📋 Copiar mensaje</button>
            {renewalDelivery.cliente?.telefono && <button type="button" className="miniButton" onClick={()=>window.open(whatsappUrl(renewalDelivery.cliente.telefono,""),"_blank","noopener,noreferrer")}>💬 Abrir WhatsApp</button>}</div>
            <small>Si el navegador permitió la copia automática, solo abre WhatsApp y pega. Si no, utiliza Copiar mensaje.</small>
          </div>}
          {renewalDropdown(sub, true)}
        </div>
      }
      <button type="button" className="miniButton" style={{marginTop:18}} onClick={() => {setRenewalNoticeOrigin(null);navigate("vencidas");}}>← Volver a cuentas vencidas</button>
    </>;
  }

  function renderCatalogo() {
    const withPrice = value => {
      const text = String(value ?? "").trim();
      if (!text || /^(consultar|sin precio|pendiente|por definir|n\/?a|gratis|no disponible)$/i.test(text)) return false;
      return (text.match(/\d+/g) || []).some(n => Number(n) > 0);
    };
    const visibleCatalogItems = catalogItems.filter(item => {
      const text = `${item.titulo || ""} ${item.duracion || ""} ${item.descripcion || ""} ${item.precio || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const query = catalogSearch.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (query && !text.includes(query)) return false;
      if (catalogCategoryFilter !== "todas" && catalogItemCategory(item) !== catalogCategoryFilter) return false;
      if (catalogFilter === "publicados") return item.activo && withPrice(item.precio);
      if (catalogFilter === "ocultos") return !item.activo;
      if (catalogFilter === "sinprecio") return !withPrice(item.precio);
      return true;
    });
    const save = async (event) => {
      event.preventDefault();
      await runAction(async () => {
        await api("/api/admin/catalogo", { method: catalogEditId ? "PATCH" : "POST", body: JSON.stringify({ ...catalogForm, ...(catalogEditId ? { id: catalogEditId } : {}) }) });
        setCatalogEditId("");
        setCatalogForm({ titulo: "", descripcion: "", duracion: "", precio: "", orden: 0, activo: true, categoria: "otros" });
        await refresh();
      }, catalogEditId ? "Producto del catálogo actualizado." : "Producto añadido al catálogo.");
    };
    const toggleCatalogVisibility = async (item) => {
      await runAction(async () => {
        await api("/api/admin/catalogo", {
          method: "PATCH",
          body: JSON.stringify({ ...item, categoria: catalogItemCategory(item), activo: !item.activo })
        });
        // Si se está editando el mismo producto, actualizar el estado del formulario.
        if (catalogEditId === item.id) setCatalogForm(previous => ({ ...previous, activo: !item.activo }));
        await refresh();
      }, item.activo ? "Servicio oculto del catálogo en línea." : "Servicio activado para el catálogo en línea.");
    };
    return <>
      <div className="pageHeading"><p className="muted">CATÁLOGO</p><h1>Catálogo para clientes</h1><p className="pageLead">Edita servicios, precios y descripciones. Los servicios sin precio, con «Consultar» o con precio $0 no aparecerán en el catálogo de clientes ni en el PDF, pero seguirán aquí para editarlos.</p><div className="inlineActions" style={{marginTop:12}}><a className="miniButton primaryMini" href="/cliente/catalogo" target="_blank" rel="noreferrer">🌐 Ver catálogo actualizado en línea</a></div></div>
      <form className="card adminForm standaloneForm" onSubmit={save}>
        <label>Nombre del servicio<input value={catalogForm.titulo} required maxLength={120} onChange={e => setCatalogForm({...catalogForm,titulo:e.target.value})}/></label>
        <label>Categoría del servicio
          <select value={catalogForm.categoria} onChange={e => setCatalogForm({...catalogForm,categoria:e.target.value})} style={{width:"100%",height:44,background:"#061a34",color:"#eff9ff",border:"1px solid #2875b4",borderRadius:11,padding:"0 12px",colorScheme:"dark"}}>
            {CATALOG_CATEGORIES.map(category => <option key={category.key} value={category.key}>{category.title}</option>)}
          </select>
          <small style={{display:"block",marginTop:5,color:"#9acdea"}}>Al guardar, el servicio aparecerá en esta categoría del catálogo público.</small>
        </label>
        <label>Duración o plan<input value={catalogForm.duracion} placeholder="Ej. 1 mes" onChange={e => setCatalogForm({...catalogForm,duracion:e.target.value})}/></label>
        <label>Precio a mostrar (opcional; sin precio no se publica)<input value={catalogForm.precio} placeholder="Ej. $12.000" onChange={e => setCatalogForm({...catalogForm,precio:e.target.value})}/></label>
        <label>Descripción<textarea value={catalogForm.descripcion} rows={3} onChange={e => setCatalogForm({...catalogForm,descripcion:e.target.value})}/></label>
        <label>Orden de aparición<input type="number" value={catalogForm.orden} onChange={e => setCatalogForm({...catalogForm,orden:Number(e.target.value)})}/></label>
        <label className="toggleLine"><input type="checkbox" checked={catalogForm.activo} onChange={e => setCatalogForm({...catalogForm,activo:e.target.checked})}/> Visible para clientes</label>
        <div className="inlineActions"><button className="miniButton primaryMini" disabled={working}>{catalogEditId ? "Guardar cambios" : "Agregar al catálogo"}</button>
          {catalogEditId && <button type="button" className="miniButton" onClick={() => {setCatalogEditId("");setCatalogForm({ titulo:"",descripcion:"",duracion:"",precio:"",orden:0,activo:true,categoria:"otros" });}}>Cancelar</button>}
        </div>
      </form>
      <h2 style={{marginTop:24}}>Servicios del catálogo ({visibleCatalogItems.length} de {catalogItems.length})</h2>
      <div className="card" style={{display:"flex",gap:14,alignItems:"flex-end",flexWrap:"wrap",padding:16,marginBottom:14,background:"linear-gradient(120deg,#0b2545,#07182f)",border:"1px solid #23629b",borderRadius:16,boxShadow:"0 5px 18px #0003"}}>
        <label style={{display:"flex",flexDirection:"column",gap:8,flex:"2 1 270px",minWidth:0,margin:0,color:"#b9dfff",fontSize:13,fontWeight:700}}>
          <span>🔎 Buscar servicio o plan</span>
          <input type="search" value={catalogSearch} onChange={e=>setCatalogSearch(e.target.value)} placeholder="Netflix, Canva, 30 días..." style={{boxSizing:"border-box",width:"100%",height:44,padding:"0 14px",borderRadius:11,border:"1px solid #2875b4",background:"#061a34",color:"#eff9ff",outlineColor:"#39b8ff",fontSize:14,boxShadow:"none"}} />
        </label>
        <label style={{display:"flex",flexDirection:"column",gap:8,flex:"1 1 220px",minWidth:0,margin:0,color:"#b9dfff",fontSize:13,fontWeight:700}}>
          <span>Filtrar por estado</span>
          <select value={catalogFilter} onChange={e=>setCatalogFilter(e.target.value)} style={{boxSizing:"border-box",width:"100%",height:44,padding:"0 12px",borderRadius:11,border:"1px solid #2875b4",background:"#061a34",color:"#eff9ff",colorScheme:"dark",fontSize:14,boxShadow:"none",cursor:"pointer"}}>
            <option value="todos">Todos los servicios</option>
            <option value="publicados">Publicados con precio</option>
            <option value="sinprecio">Sin precio</option>
            <option value="ocultos">Ocultos manualmente</option>
          </select>
        </label>
        <label style={{display:"flex",flexDirection:"column",gap:8,flex:"1 1 220px",minWidth:0,margin:0,color:"#b9dfff",fontSize:13,fontWeight:700}}>
          <span>Filtrar por categoría</span>
          <select value={catalogCategoryFilter} onChange={e=>setCatalogCategoryFilter(e.target.value)} style={{boxSizing:"border-box",width:"100%",height:44,padding:"0 12px",borderRadius:11,border:"1px solid #2875b4",background:"#061a34",color:"#eff9ff",colorScheme:"dark",fontSize:14,boxShadow:"none",cursor:"pointer"}}>
            <option value="todas">Todas las categorías</option>
            {CATALOG_CATEGORIES.map(category=><option key={category.key} value={category.key}>{category.title}</option>)}
          </select>
        </label>
        {(catalogSearch || catalogFilter !== "todos" || catalogCategoryFilter !== "todas") && <button type="button" className="miniButton" style={{height:44,background:"#103a69",border:"1px solid #3382bd",color:"#e4f6ff",borderRadius:11,padding:"0 16px"}} onClick={()=>{setCatalogSearch("");setCatalogFilter("todos");setCatalogCategoryFilter("todas");}}>✕ Limpiar</button>}
      </div>
      {!visibleCatalogItems.length && <div className="card emptyState">No hay servicios que coincidan con la búsqueda.</div>}
      <div style={{display:"grid",gap:12}}>
        {CATALOG_CATEGORIES.map(category => {
          const categoryItems = visibleCatalogItems.filter(item => catalogItemCategory(item) === category.key);
          if (!categoryItems.length) return null;
          return <details key={category.key} open={undefined} style={{border:"1px solid #245c91",borderRadius:15,background:"linear-gradient(125deg,#0a2341,#07182e)",padding:"9px 12px"}}>
            <summary style={{cursor:"pointer",padding:"10px 6px",color:"#e5f7ff",fontWeight:800,fontSize:16}}>{category.icon} {category.title} <span style={{color:"#79cfff",fontSize:13,fontWeight:600}}>({categoryItems.length})</span></summary>
      <div className="jcToolCards">{categoryItems.map(item => <article className="card jcToolCard" key={item.id}>
        <strong>{item.titulo}</strong> <small>{!item.activo ? "Oculto" : (!String(item.precio || "").trim() || /^(consultar|sin precio|pendiente|por definir|n\/?a|gratis|no disponible)$/i.test(String(item.precio).trim()) || !/\d/.test(String(item.precio)) || !String(item.precio).match(/\d+/g)?.some(n => Number(n) > 0) ? "Sin precio · no publicado" : "Visible")} · {item.duracion || "Sin duración"}</small>
        {item.descripcion && <p>{item.descripcion}</p>}{item.precio && <b>{item.precio}</b>}
        <div className="inlineActions"><button className={`miniButton ${item.activo ? "warningMini" : "primaryMini"}`} type="button" disabled={working} onClick={() => toggleCatalogVisibility(item)}>{item.activo ? "🙈 Ocultar" : "👁️ Mostrar"}</button><button className="miniButton" type="button" onClick={() => { setCatalogEditId(item.id); setCatalogForm({titulo:item.titulo,descripcion:item.descripcion || "",duracion:item.duracion || "",precio:item.precio || "",orden:item.orden || 0,activo:item.activo,categoria:catalogItemCategory(item)}); window.scrollTo({top:0,behavior:"smooth"}); }}>Editar</button>
          <button className="miniButton dangerMini" type="button" onClick={() => { if(!window.confirm(`¿Eliminar ${item.titulo} del catálogo?`)) return;runAction(async()=>{await api("/api/admin/catalogo",{method:"DELETE",body:JSON.stringify({id:item.id})}); await refresh();},"Producto eliminado del catálogo."); }}>Borrar</button>
        </div>
      </article>)}</div>
          </details>;
        })}
      </div>
    </>;
  }

  function renderDispositivos() {
    const subsById = new Map(enrichedSubs.map(item => [item.id, item]));
    const activeAssignments = (data.asignaciones || []).filter(a => a.activo);
    const accounts = new Map([...(data.inventario || []), ...(data.inventario_externo || [])].map(a => [String(a.id), a]));
    const chatOrders = new Map(enrichedSubs.filter(sub => /chat\s*gpt/i.test(sub.servicio?.nombre || "") && (sub.days === null || sub.days >= 0)).map(sub => [sub.id, sub]));
    const records = new Map(deviceRecords.map(d => [d.suscripcion_id, d]));
    const groups = new Map();
    for (const assignment of activeAssignments) {
      const sub = chatOrders.get(assignment.suscripcion_id);
      if (!sub) continue;
      const account = accounts.get(String(assignment.inventario_id));
      const accountEmail = String(account?.correo || account?.email || "").trim();
      const accountName = accountEmail || String(account?.grupo || account?.nombre || "Cuenta sin correo registrado");
      const key = String(assignment.inventario_id || `sin-cuenta-${sub.id}`);
      const searchText = normalizeText(`${accountName} ${sub.cliente?.nombre || ""} ${sub.cliente?.username || ""} ${sub.servicio?.nombre || ""} ${assignment.cupo_numero || ""}`);
      if (deviceSearch && !searchText.includes(normalizeText(deviceSearch))) continue;
      const record = records.get(sub.id);
      if (deviceOnlyPending && record) continue;
      if (!groups.has(key)) groups.set(key,{key,accountName,entries:[]});
      // Se agrupa por cuenta, no por cliente, y se evita repetir un pedido.
      if (!groups.get(key).entries.some(entry => entry.sub.id === sub.id && entry.assignment.cupo_numero === assignment.cupo_numero)) {
        groups.get(key).entries.push({sub,assignment,record});
      }
    }
    const grouped = [...groups.values()].map(group=>({
      ...group,
      entries:group.entries.sort((a,b)=>Number(a.assignment.cupo_numero || 0)-Number(b.assignment.cupo_numero || 0)),
      pending:group.entries.filter(entry=>!entry.record).length
    })).sort((a,b)=>b.pending-a.pending || a.accountName.localeCompare(b.accountName));
    const pendingTotal = [...groups.values()].reduce((n,group)=>n+group.entries.filter(entry=>!entry.record).length,0);
    const editOrder = (sub) => {
      const existing = records.get(sub.id);
      setDeviceOrderId(sub.id);
      setDeviceForm({tipo:existing?.tipo || "Celular",dispositivo:existing?.dispositivo || "",identificador:existing?.identificador || "",notas:existing?.notas || ""});
      window.requestAnimationFrame(()=>document.getElementById("jcDeviceEditor")?.scrollIntoView({behavior:"smooth",block:"center"}));
    };
    const save = async (event) => {
      event.preventDefault();
      await runAction(async() => {await api("/api/admin/dispositivos", {method:"POST", body:JSON.stringify({suscripcion_id:deviceOrderId,...deviceForm})});setDeviceOrderId(""); await refresh();},"Dispositivo registrado para este pedido.");
    };
    return <>
      <div className="pageHeading"><p className="muted">CONTROL CHATGPT</p><h1>Registro de dispositivos</h1><p className="pageLead">Cuentas agrupadas por correo. Despliega una cuenta para ver sus cupos y registrar o editar el dispositivo de cada pedido. Al liberar el cupo, su registro se elimina.</p></div>
      <div className="jcDeviceFilters">
        <input className="jcToolSearch" value={deviceSearch} onChange={e=>setDeviceSearch(e.target.value)} placeholder="🔎 Buscar correo, cliente o cupo..." />
        <label className="jcDevicePendingToggle"><input type="checkbox" checked={deviceOnlyPending} onChange={e=>setDeviceOnlyPending(e.target.checked)} /> Solo pendientes</label>
      </div>
      <p className="jcDeviceOverview">📧 {grouped.length} cuenta(s) · ⚠️ {pendingTotal} dispositivo(s) pendiente(s) {deviceOnlyPending ? "en este filtro" : "por registrar"}</p>
      {deviceOrderId && <form id="jcDeviceEditor" className="card adminForm standaloneForm" onSubmit={save}>
        <h3>Dispositivo de {subsById.get(deviceOrderId)?.cliente?.nombre || "cliente"}</h3>
        <label>Tipo de dispositivo<select value={deviceForm.tipo} onChange={e=>setDeviceForm({...deviceForm,tipo:e.target.value})}>{["Celular","PC","Tablet","Otro"].map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Dispositivo registrado<input required placeholder="Ej. Samsung A54, iPhone 13, PC Windows" value={deviceForm.dispositivo} onChange={e=>setDeviceForm({...deviceForm,dispositivo:e.target.value})}/></label>
        <label>Identificador (opcional)<input placeholder="Ej. referencia interna" value={deviceForm.identificador} onChange={e=>setDeviceForm({...deviceForm,identificador:e.target.value})}/></label>
        <label>Notas (opcional)<textarea value={deviceForm.notas} onChange={e=>setDeviceForm({...deviceForm,notas:e.target.value})}/></label>
        <div className="inlineActions"><button className="miniButton primaryMini" disabled={working}>Guardar dispositivo</button><button type="button" className="miniButton" onClick={()=>setDeviceOrderId("")}>Cancelar</button></div>
      </form>}
      {!grouped.length && <div className="card emptyState">No hay cupos ChatGPT que coincidan con la búsqueda.</div>}
      <div className="jcDeviceGroups">{grouped.map(group=><details className="card jcDeviceGroup" key={group.key}>
        <summary className="jcDeviceGroupSummary">
          <span className="jcDeviceGroupTitle">📧 {group.accountName}<small>{group.entries.length} cupo(s) con pedido vigente</small></span>
          <span className="jcDeviceCount">{group.pending ? `⚠️ ${group.pending} pendiente(s)` : "✅ Todos registrados"}</span>
          <span className="jcDeviceChevron">▾</span>
        </summary>
        <div className="jcDeviceRows">{group.entries.map(({sub,assignment,record})=><div className="jcDeviceRow" key={`${sub.id}-${assignment.id}`}>
          <div className="jcDeviceRowInfo"><strong>Cupo {assignment.cupo_numero ?? "—"} · {sub.cliente?.nombre || "Cliente"}</strong><small>Vence {formatDate(sub.fecha_vencimiento)}</small><span className={record ? "jcDeviceRegistered" : "jcDeviceMissing"}>{record ? `✅ ${record.tipo}: ${record.dispositivo}` : "⚠️ Dispositivo pendiente de registrar"}</span>{record?.identificador && <small>Referencia: {record.identificador}</small>}</div>
          <div className="inlineActions"><button type="button" className="miniButton primaryMini" onClick={()=>editOrder(sub)}>{record ? "Editar" : "Registrar"}</button>
          {record && <button type="button" className="miniButton dangerMini" onClick={()=>{if(!window.confirm("¿Borrar el registro de este dispositivo?"))return;runAction(async()=>{await api("/api/admin/dispositivos",{method:"DELETE",body:JSON.stringify({suscripcion_id:sub.id})});await refresh();},"Registro borrado.");}}>Borrar</button>}</div>
        </div>)}</div>
      </details>)}</div>
      <style jsx>{`
        .jcDeviceFilters{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:10px 0}.jcDeviceFilters .jcToolSearch{flex:1;min-width:220px;margin:0}.jcDevicePendingToggle{display:flex;align-items:center;gap:8px;font-size:13px;color:#bfdbf4;white-space:nowrap}.jcDevicePendingToggle input{width:17px;height:17px}.jcDeviceOverview{color:#a8d7fb;font-size:14px;margin:12px 0 18px}.jcDeviceGroups{display:grid;gap:11px}.jcDeviceGroup{padding:0!important;overflow:hidden}.jcDeviceGroupSummary{display:flex;align-items:center;gap:14px;cursor:pointer;padding:16px;list-style:none}.jcDeviceGroupSummary::-webkit-details-marker{display:none}.jcDeviceGroupSummary:hover{background:#123050}.jcDeviceGroupTitle{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1;overflow-wrap:anywhere;font-weight:700;color:#f3f9ff}.jcDeviceGroupTitle small{font-weight:400;color:#9fc7e6;font-size:12px}.jcDeviceCount{font-size:12px;color:#ffcb82;white-space:nowrap}.jcDeviceChevron{color:#90cffa;transition:transform .2s}.jcDeviceGroup[open] .jcDeviceChevron{transform:rotate(180deg)}.jcDeviceRows{padding:0 15px 8px;border-top:1px solid #244564}.jcDeviceRow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid #1b3c5c}.jcDeviceRow:last-child{border-bottom:0}.jcDeviceRowInfo{display:flex;flex-direction:column;gap:5px;min-width:0}.jcDeviceRowInfo strong{font-size:13px}.jcDeviceRowInfo small{font-size:11px;color:#9cbfdb}.jcDeviceMissing{font-size:12px;color:#ffcb82}.jcDeviceRegistered{font-size:12px;color:#8ae4c0}@media(max-width:600px){.jcDeviceRow{align-items:flex-start;flex-direction:column}.jcDeviceGroupSummary{flex-wrap:wrap}.jcDeviceCount{white-space:normal}}
      `}</style>
    </>;
  }

  function renderPromociones() {
    const filteredPromotions = (data.promociones || []).filter((promo) =>
      String(promo.titulo || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .includes(promotionSearch.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())
    );
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
            <form id="promocion-editor" className="card adminForm promoForm" onSubmit={createPromotion}>
              {editingPromotionId && <div className="promotionEditingNotice">✏️ Editando promoción. Modifica sus datos y guarda los cambios.</div>}
              <div className="twoCols">
                <label>Título<input placeholder="Ej. Disney + Max combo" value={promoForm.titulo} onChange={(e) => setPromoForm({ ...promoForm, titulo: e.target.value })} required /></label>
                <label>Precio / llamada (opcional)<input placeholder="Ej. $18.000" value={promoForm.precio} onChange={(e) => setPromoForm({ ...promoForm, precio: e.target.value })} /></label>
              </div>
              <label>Descripción<textarea placeholder="Ej. Solo por hoy. Pregunta por disponibilidad." value={promoForm.descripcion} onChange={(e) => setPromoForm({ ...promoForm, descripcion: e.target.value })} /></label>
              <div className="twoCols">
                <label>Desde<input type="date" value={promoForm.fecha_inicio} onChange={(e) => setPromoForm({ ...promoForm, fecha_inicio: e.target.value })} required /></label>
                <label>Hasta<input type="date" value={promoForm.fecha_fin} onChange={(e) => setPromoForm({ ...promoForm, fecha_fin: e.target.value })} required /></label>
              </div>
              <div className="promotionFormActions">
                <button className="button primary" disabled={working}>{working ? "Guardando..." : editingPromotionId ? "Guardar cambios" : "Publicar promoción"}</button>
                {editingPromotionId && <button type="button" className="button secondary" disabled={working} onClick={clearPromotionEdit}>Cancelar edición</button>}
              </div>
            </form>

            <section className="promoAdminList">
              <div className="sectionTitleRow"><h2>Promociones guardadas ({filteredPromotions.length} de {(data.promociones || []).length})</h2><span>{todayPromotions.length} visibles hoy</span></div>
              <div className="card" style={{padding:14,marginBottom:14,background:"linear-gradient(120deg,#0b2545,#07182f)",border:"1px solid #23629b",borderRadius:16}}>
                <label style={{display:"flex",flexDirection:"column",gap:8,margin:0,color:"#b9dfff",fontSize:13,fontWeight:700}}>
                  <span>🔎 Buscar promoción por nombre</span>
                  <input type="search" value={promotionSearch} onChange={(e)=>setPromotionSearch(e.target.value)} placeholder="Ej. Promo única, Netflix, Black Friday..." style={{boxSizing:"border-box",width:"100%",height:44,padding:"0 14px",borderRadius:11,border:"1px solid #2875b4",background:"#061a34",color:"#eff9ff",outlineColor:"#39b8ff",fontSize:14}} />
                </label>
                {promotionSearch && <button type="button" className="miniButton" style={{marginTop:10,background:"#103a69",border:"1px solid #3382bd",color:"#e4f6ff"}} onClick={()=>setPromotionSearch("")}>✕ Limpiar búsqueda</button>}
              </div>
              {bulkDeleteBar("promociones", filteredPromotions.map((promo) => promo.id), "/api/admin/promociones", "promoción")}
              {(data.promociones || []).length === 0 ? (
                <div className="card emptyState">Aún no has creado promociones.</div>
              ) : filteredPromotions.length === 0 ? (
                <div className="card emptyState">No se encontraron promociones con ese nombre.</div>
              ) : (
                <div className="promoAdminGrid">
                  {filteredPromotions.map((promo) => (
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
                        <span className={promotionVisibleInAdmin(promo) ? "status ok" : "status suspendedStatus"}>{promotionVisibleInAdmin(promo) ? "Visible" : "Oculta"}</span>
                        <button type="button" className="miniButton primaryMini" onClick={() => beginPromotionEdit(promo)}>✏️ Editar</button>
                        <button type="button" className="miniButton" disabled={working} onClick={() => {
                          if (promotionExpired(promo)) {
                            setReactivatePromotionId(String(promo.id));
                            setReactivatePromotionDays("1");
                          } else {
                            togglePromotion(promo);
                          }
                        }}>{promotionVisibleInAdmin(promo) ? "Ocultar" : "Activar"}</button>
                        <button type="button" className="miniButton dangerMini" onClick={() => beginDeleteSelection("promociones", promo.id)}>Borrar</button>
                      </div>
                      {reactivatePromotionId === String(promo.id) && (
                        <form onSubmit={e => { e.preventDefault();reactivatePromotion(promo); }} style={{marginTop:12,padding:13,border:"1px solid #2875b4",borderRadius:12,background:"#071b35",display:"grid",gap:9}}>
                          <label style={{display:"grid",gap:6,fontSize:13,color:"#bfddf8",fontWeight:700}}>
                            📅 ¿Por cuántos días quieres activar esta promoción?
                            <input type="number" min="1" max="36500" step="1" required value={reactivatePromotionDays} onChange={e => setReactivatePromotionDays(e.target.value)} style={{height:41,boxSizing:"border-box",width:"100%",borderRadius:9,border:"1px solid #3488c6",background:"#06162a",color:"#effaff",padding:"0 12px",fontSize:15}} />
                          </label>
                          <small style={{color:"#a6cbea"}}>Se activa desde hoy. El último día también estará visible.</small>
                          <div className="inlineActions">
                            <button type="submit" className="miniButton primaryMini" disabled={working}>✅ Confirmar activación</button>
                            <button type="button" className="miniButton" onClick={() => setReactivatePromotionId("")}>Cancelar</button>
                          </div>
                        </form>
                      )}
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

    const inventoryServices = Object.values(
  data.servicios
    .filter((service) => service.activo && effectiveDeliveryType(service) !== "manual")
    .reduce((acc, service) => {
      const key = service.nombre.toLowerCase().trim();

      if (!acc[key]) {
        acc[key] = service;
      }

      return acc;
    }, {})
).sort((a, b) =>
  String(a.nombre || "").localeCompare(String(b.nombre || ""), "es")
);
      

    const activeAssignments = (data.asignaciones || []).filter((assignment) => {

  // SOLO MOSTRAR ASIGNACIONES ACTIVAS
  if (assignment.activo !== true) return false;

  const sub = enrichedSubs.find(
    (item) => item.id === assignment.suscripcion_id
  );

  if (!sub) return false;

  if (!sub.fecha_vencimiento) return true;

  const vencimiento = parseISO(sub.fecha_vencimiento);
  const hoy = parseISO(todayISO());

  const diasVencido = Math.floor(
    (hoy - vencimiento) / (1000 * 60 * 60 * 24)
  );

  return diasVencido < 2;
}).map((assignment) => {
      const sub = enrichedSubs.find((item) => item.id === assignment.suscripcion_id) || null;
      const item = (data.inventario || []).find((account) => account.id === assignment.inventario_id) || null;
      return { ...assignment, sub, item };
    }).filter((assignment) => assignment.sub && assignment.item);

    function inventoryDurationControls(form, setter, type) {
      const durationType = type === "gemini" ? "meses" : (form.duracion_tipo === "meses" ? "meses" : "dias");
      const max = durationType === "dias" ? 30 : undefined;
      return (
        <div className="durationControls">
          <label>Tiempo
            <select value={durationType} disabled={type === "gemini"} onChange={(e) => setter({ ...form, duracion_tipo: e.target.value, duracion_cantidad: 1 })}>
              {type !== "gemini" && <option value="dias">Días</option>}
              <option value="meses">Meses</option>
            </select>
          </label>
          <label>Cantidad
            <input type="number" onWheel={bloquearScrollNumerico} min="1" max={max} inputMode="numeric" value={form.duracion_cantidad} onChange={(e) => setter({ ...form, duracion_tipo: durationType, duracion_cantidad: e.target.value })} onBlur={() => {
  const parsed = Number(form.duracion_cantidad);

  const fixed =
    Number.isInteger(parsed) && parsed >= 1
      ? (max === undefined ? parsed : Math.min(parsed, max))
      : 1;

  setter({
    ...form,
    duracion_tipo: durationType,
    duracion_cantidad: fixed
  });
}}required />
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
    perfiles_pins: { ...form.perfiles_pins || {}, [String(profile)]: value }
  });
}


// PEGA AQUÍ EL FILTRO

const filteredStreamingInventory = streamingInventory.filter((item) => {

  const service = Array.isArray(item.servicios)
    ? item.servicios[0]
    : item.servicios;

  const texto = `
    ${service?.nombre || ""}
    ${item.correo || ""}
    ${item.grupo || ""}
    ${item.estado || ""}
  `.toLowerCase();


  // BUSCADOR
  if (!texto.includes(streamSearch.toLowerCase())) {
    return false;
  }


  // FILTRO DISPONIBLES
  if (streamFilter === "disponible") {

    const usados = activeAssignments.filter(
      (a) => a.inventario_id === item.id
    ).length;

    return usados < Number(item.cupos_total || 1);
  }


  // FILTRO OCUPADAS
  if (streamFilter === "ocupada") {

    const usados = activeAssignments.filter(
      (a) => a.inventario_id === item.id
    ).length;

    return usados >= Number(item.cupos_total || 1);
  }


  // FILTRO VENCIDAS
  if (streamFilter === "vencida") {
    return item.estado === "vencida" || item.estado === "fallida";
  }


  return true;
});
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

            <input
  className="providerSearchInput"
  placeholder="🔍 Buscar proveedor..."
  value={providerSearch}
  onChange={(e) => setProviderSearch(e.target.value)}
/>

            {bulkDeleteBar("proveedores", (data.proveedores || []).filter((provider) => provider.activo !== false && String(provider.iniciales || "").toLowerCase().includes(providerSearch.toLowerCase())).map((provider) => provider.id), "/api/admin/proveedores", "proveedor")}
            <div className="providerList">
              <div className="providerListHead"><span>{deleteMode["proveedores"] ? "Seleccionar / Iniciales" : "Iniciales"}</span><span>Acción</span></div>
             
              
              {(data.proveedores || [])
.filter((provider) => provider.activo !== false)
.filter((provider) =>
  provider.iniciales
    .toLowerCase()
    .includes(providerSearch.toLowerCase())
)
.map((provider) => (
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
            {selectedUploadService && !isYoutubeService(selectedUploadService) && inventoryDurationControls(inventoryForm, setInventoryForm, uploadType)}

            {selectedUploadService && isYoutubeService(selectedUploadService) ? (
              <label>Nombre del grupo familiar de YouTube
                <input placeholder="Ej. Familia 1 / Grupo A" value={inventoryForm.grupo} onChange={(e) => setInventoryForm({ ...inventoryForm, grupo: e.target.value, correo: "", clave: "", perfiles_pins: {} })} required />
              </label>
            ) : selectedUploadService && uploadType === "gemini" ? (
              <label>Correo del grupo<input placeholder="Correo del grupo" value={inventoryForm.grupo} onChange={(e) => setInventoryForm({ ...inventoryForm, grupo: e.target.value })} required /></label>
            ) : selectedUploadService ? (
              <div className="twoCols">
                <label>{normalizeText(selectedUploadService.nombre).includes("emby") ? "Usuario Emby" : "Correo / acceso"}<input placeholder={normalizeText(selectedUploadService.nombre).includes("emby") ? "Usuario Emby" : (uploadType === "chatgpt" ? "c90917058+2207@gmail.com" : "cuenta@correo.com")} value={inventoryForm.correo} onChange={(e) => setInventoryForm({ ...inventoryForm, correo: e.target.value })} required /></label>
                <label>Contraseña (opcional)<input placeholder="Si aplica" value={inventoryForm.clave} onChange={(e) => setInventoryForm({ ...inventoryForm, clave: e.target.value })} /></label>
              </div>
            ) : null}

            {selectedUploadService && normalizeText(selectedUploadService.nombre).includes("emby") && (
              <label>Servidor Emby
                <input placeholder="Dirección o URL del servidor" value={inventoryForm.servidor || ""} onChange={e => setInventoryForm(p => ({...p, servidor:e.target.value}))} required />
              </label>
            )}
            {selectedUploadService && (
              <>
            <label className="numberProfilesTest">
  NÚMERO DE CUPOS / PERFILES
  <input
    type="number" onWheel={bloquearScrollNumerico}
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
{uploadType === "estandar" && !isYoutubeService(selectedUploadService) && (
                <div className="profilePinsBox">
                  <div className="profilePinsTitle"><strong>PIN por perfil</strong><span>Opcional. Perfil 1 siempre será 1111 si generas PIN.</span></div>
                  <div className="inlineActions" style={{marginBottom:12, flexWrap:"wrap"}}>
                    <button type="button" className="miniButton primaryMini" onClick={() => setInventoryForm(prev => ({...prev, pin: "", perfiles_pins: generateInventoryProfilePins(prev.cupos_total)}))}>
                      🎲 Generar PIN automáticamente
                    </button>
                    <button type="button" className="miniButton" onClick={() => setInventoryForm(prev => ({...prev, pin: "", perfiles_pins: {}}))}>
                      Sin PIN
                    </button>
                  </div>
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
            {generatedInventoryGroupMessage && (
              <div className="generatedDelivery" style={{minWidth:0, maxWidth:"100%"}}>
                <div className="generatedHeader">
                  <div><strong>Mensaje para tu grupo de WhatsApp</strong><span>Cuenta guardada. Copia todo en un clic.</span></div>
                  <button type="button" className="generatedClose" aria-label="Cerrar mensaje" onClick={() => setGeneratedInventoryGroupMessage("")}>×</button>
                </div>
                <textarea readOnly rows={11} value={generatedInventoryGroupMessage} style={{width:"100%",boxSizing:"border-box",whiteSpace:"pre-wrap"}} />
                <div className="inlineActions"><button type="button" className="miniButton primaryMini" onClick={(event) => copyText(generatedInventoryGroupMessage, event)}>📋 Copiar mensaje completo</button></div>
              </div>
            )}
          </form>
        )}


        {inventoryTab === "stock" && (
          <section className="inventoryStockSection inventoryStandalone">
            <div className="sectionTitleRow"><h2>Stock disponible</h2></div>
            <input
  className="stockSearchInput"
  placeholder="🔍 Buscar servicio..."
  value={stockSearch}
  onChange={(e) => setStockSearch(e.target.value)}
/>


            <div className="stockCards compactStockCards">
  {[...inventoryServices]
  .filter((service) => {
    const name = inventoryServiceLabel(service)
      .toLowerCase()
      .trim();

    const search = stockSearch
      .toLowerCase()
      .trim();

    return name.includes(search);
  })
  .sort((a, b) => {
  const stockA = inventoryByService[a.nombre.trim().toLowerCase()] || 0;
  const stockB = inventoryByService[b.nombre.trim().toLowerCase()] || 0;

  return stockB - stockA;
})
  .map((service) => (
      <div className="card stockCard compactStockCard" key={service.id}>
        <strong>{inventoryServiceLabel(service)}</strong>
        <b>
 {inventoryByService[service.nombre.trim().toLowerCase()] || 0}
</b>
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
                  <label>Correo del grupo<input placeholder="Correo del grupo"value={replacementAccountForm.grupo} onChange={(e) => setReplacementAccountForm({ ...replacementAccountForm, grupo: e.target.value })} required /></label>
                ) : replacementService ? (
                  <div className="twoCols">
                    <label>Correo / acceso<input placeholder={replacementType === "chatgpt" ? "cuenta@gmail.com" : "cuenta@correo.com"} value={replacementAccountForm.correo} onChange={(e) => setReplacementAccountForm({ ...replacementAccountForm, correo: e.target.value })} required /></label>
                    <label>Contraseña (opcional)<input placeholder="Si aplica" value={replacementAccountForm.clave} onChange={(e) => setReplacementAccountForm({ ...replacementAccountForm, clave: e.target.value })} /></label>
                  </div>
                ) : null}

                {replacementService && replacementType === "estandar" && (
                  <>
                    <label>Número de perfiles
                      <input type="number" onWheel={bloquearScrollNumerico} min={Math.max(1, replacementSourceAssignments.length)} max="50" value={replacementAccountForm.cupos_total} onChange={(e) => setReplacementAccountForm({ ...replacementAccountForm, cupos_total: e.target.value })} onBlur={() => {
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
                      <div className="inlineActions"><button type="button" className="miniButton primaryMini" onClick={(event) => copyText(guarantee.text, event)}>Copiar texto</button>{wa && <a className="waTableButton" href={wa} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>}</div>
                    </div>
                  );
                })}
                <button type="button" className="miniButton" onClick={() => setGeneratedGuarantees([])}>Cerrar mensajes</button>
              </div>
            )}

            <section className="inventoryListSection">
              <div className="sectionTitleRow"><h2>Cuentas Streaming</h2><span>{filteredStreamingInventory.length} cuentas / grupos</span></div>
              <div className="streamingSearchBox">
  <div className="streamingSearchBox">
  <input
    className="streamingSearchInput"
    placeholder="🔍 Buscar cuenta, correo o servicio..."
    value={streamSearch}
    onChange={(e) => setStreamSearch(e.target.value)}
  />

  <div className="streamFilters">

  <button
    className={streamFilter === "todos" ? "active" : ""}
    onClick={() => setStreamFilter("todos")}
  >
    Todas
  </button>

  <button
    className={streamFilter === "disponible" ? "active" : ""}
    onClick={() => setStreamFilter("disponible")}
  >
    Disponibles
  </button>

  <button
    className={streamFilter === "ocupada" ? "active" : ""}
    onClick={() => setStreamFilter("ocupada")}
  >
    Ocupadas
  </button>

  <button
    className={streamFilter === "vencida" ? "active" : ""}
    onClick={() => setStreamFilter("vencida")}
  >
    Vencidas
  </button>

</div>
</div>
</div>

              {editingInventoryId && (
                <form id="inventory-edit-form" className="card adminForm inventoryEditPanel" style={{ scrollMarginTop: "100px" }} onSubmit={saveInventoryEdit}>
                  <h3>Editar cuenta</h3>
                  <p className="pageLead" style={{ marginTop: "-6px", marginBottom: "14px" }}>Servicio: <strong>{editService?.nombre || "Servicio no identificado"}</strong></p>
                  <div className="twoCols">

  <label>
    Proveedor
    <select
      value={inventoryEditForm.proveedor_id || ""}
      onChange={(e) =>
        setInventoryEditForm({
          ...inventoryEditForm,
          proveedor_id: e.target.value
        })
      }
    >
      {(data.proveedores || [])
        .filter((p) => p.activo !== false)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.iniciales}
          </option>
        ))}
    </select>
  </label>

  <label>
    Fecha de creación
    <input
      type="date"
      value={inventoryEditForm.fecha_carga || ""}
      onChange={(e) =>
        setInventoryEditForm({
          ...inventoryEditForm,
          fecha_carga: e.target.value
        })
      }
    />
  </label>

</div>

<div className="twoCols">

  <label>
    Duración
    <select
      value={inventoryEditForm.duracion_tipo || "dias"}
      onChange={(e) =>
        setInventoryEditForm({
          ...inventoryEditForm,
          duracion_tipo: e.target.value,
          duracion_cantidad: 1
        })
      }
    >
      <option value="dias">Días</option>
      <option value="meses">Meses</option>
    </select>
  </label>

  <label>
    Cantidad de tiempo
    <input
      type="number" onWheel={bloquearScrollNumerico}
      min="1"
      max={inventoryForm.duracion_tipo === "dias" ? 30 : undefined}
      value={inventoryEditForm.duracion_cantidad ?? ""}
      onChange={(e) =>
        setInventoryEditForm({
          ...inventoryEditForm,
          duracion_cantidad: e.target.value
        })
      }
    />
  </label>

</div>
                  {normalizeText(editService?.nombre).includes("emby") && (
                    <label>Servidor Emby<input value={inventoryEditForm.servidor || ""} onChange={e=>setInventoryEditForm(p=>({...p,servidor:e.target.value}))}/></label>
                  )}
                  <div className="twoCols"><input placeholder="Correo / acceso" value={inventoryEditForm.correo || ""} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, correo: e.target.value })} /><input placeholder="Grupo (Gemini)" value={inventoryEditForm.grupo || ""} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, grupo: e.target.value })} /></div>
                  <div className="twoCols"><input placeholder="Clave" value={inventoryEditForm.clave || ""} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, clave: e.target.value })} /><label>Cantidad de tiempo<input type="number" onWheel={bloquearScrollNumerico} min="1" max={inventoryEditForm.duracion_tipo === "dias" ? 30 : undefined} value={inventoryEditForm.duracion_cantidad || 1} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, duracion_cantidad: e.target.value })} /></label></div>
                  <label>Cupos / perfiles<input type="number" onWheel={bloquearScrollNumerico} min="1" max="50" value={inventoryEditForm.cupos_total || 1} onChange={(e) => setInventoryEditForm({ ...inventoryEditForm, cupos_total: e.target.value })} /></label>
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
              

              {streamingInventory.length > 0 && bulkDeleteBar("inventario", filteredStreamingInventory.map((item) => item.id), "/api/admin/inventario", "cuenta")}
              {filteredStreamingInventory.length === 0 ? <div className="card emptyState">Aún no hay cuentas cargadas.</div> : (
                <div className="card accountsTableCard"><div className="accountsTableScroll"><table className="accountsTable inventoryTable">
                  <thead><tr>{deleteMode["inventario"] && <th className="selectColumn">✓</th>}<th>Servicio</th><th>Proveedor</th><th>Cuenta / grupo</th><th>Vencimiento cuenta</th><th>Días cuenta</th><th>Cupos</th><th>Estado</th><th>Entregas activas</th><th>Acciones</th></tr></thead>
                  <tbody>
                    {filteredStreamingInventory.map((item) => {
            
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
                            {assignments.length === 0 ? <span className="noPhone">Sin entregas</span> : <details className="assignmentDetails jcCompactAssignments"><summary>{assignments.length} cliente(s) · Ver cupos</summary>
                              <div className="jcAssignmentPager">
                                <span>Mostrando {Math.min((Math.min(Number(inventoryAssignmentPage[item.id] || 0), Math.ceil(assignments.length / 5) - 1) * 5) + 1, assignments.length)}–{Math.min((Math.min(Number(inventoryAssignmentPage[item.id] || 0), Math.ceil(assignments.length / 5) - 1) + 1) * 5, assignments.length)} de {assignments.length}</span>
                                <div>
                                  <button type="button" className="miniButton" disabled={!Number(inventoryAssignmentPage[item.id] || 0)} onClick={() => {setEditingCredentialsId("");setInventoryAssignmentPage(prev => ({...prev,[item.id]:Math.max(0,Number(prev[item.id] || 0)-1)}));}}>Anterior</button>
                                  <button type="button" className="miniButton" disabled={(Number(inventoryAssignmentPage[item.id] || 0)+1)*5>=assignments.length} onClick={() => {setEditingCredentialsId("");setInventoryAssignmentPage(prev => ({...prev,[item.id]:Number(prev[item.id] || 0)+1}));}}>Siguiente</button>
                                </div>
                              </div>
                              {assignments.slice(Math.min(Number(inventoryAssignmentPage[item.id] || 0), Math.ceil(assignments.length / 5) - 1)*5, (Math.min(Number(inventoryAssignmentPage[item.id] || 0), Math.ceil(assignments.length / 5) - 1)+1)*5).map((assignment) => {
                              const guaranteeText = guaranteeSource ? buildGuaranteeWhatsappMessage(item, assignment, service) : "";
                              const guaranteeWa = guaranteeText && assignment.sub?.cliente?.telefono
                                ? whatsappUrl(assignment.sub.cliente.telefono, guaranteeText)
                                : "";
                              return (
                                <div className="assignmentRow inventoryAssignmentRow" key={assignment.id}>
                                  <span><b>{assignment.sub?.cliente?.nombre}</b> · {effectiveDeliveryType(service) === "estandar" ? "Perfil" : "Cupo"} {assignment.cupo_numero}{assignment.correo_cliente ? ` · Correo del cliente: ${assignment.correo_cliente}` : ""}<small className={`daysBadge ${daysTone(assignment.sub?.days)}`}>{remainingText(assignment.sub?.days)}</small></span>
                                  <button type="button" className="miniButton" onClick={() => {
                                    if (editingCredentialsId === assignment.id) setEditingCredentialsId("");
                                    else beginCredentialsEdit({ ...assignment, item });
                                  }}>✏️ {editingCredentialsId === assignment.id ? "Cerrar edición" : "Editar correo / cupo"}</button>
                                  {renderCredentialsEditor({ ...assignment, item })}
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
      <style jsx global>{`
        .jcStandaloneRenewCard { max-width:720px; padding:24px; border:1px solid #28577d; border-radius:16px; background:#0b2036; }
        .jcRenewSummary {display:flex; flex-direction:column; gap:6px; margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid #28577d;}
        .jcRenewSummary strong {color:#eefaff;font-size:20px;}
        .jcRenewSummary span {color:#74caff;}
        .jcRenewSummary small {color:#a4c2db;}
        .jcStandaloneRenewWrap {display:block!important; width:100%; position:static!important;}
        .jcStandaloneRenewWrap .renewDropdown.jcRenewForm { position:static!important; transform:none!important; inset:auto!important; width:100%!important; max-width:100%!important; box-shadow:none!important; grid-template-columns:repeat(2,minmax(0,1fr)); }
        .jcStandaloneRenewWrap .renewDropdown.jcRenewForm label {font-size:14px;}
        @media(max-width:640px) {.jcStandaloneRenewCard {padding:12px;}.jcStandaloneRenewWrap .renewDropdown.jcRenewForm {grid-template-columns:minmax(0,1fr);}.jcStandaloneRenewWrap .renewDropdown.jcRenewForm > * {grid-column:1 / -1;}}
        /* Formulario de renovación de pedidos: diseño compacto y legible */
        .renewDropdown.jcRenewForm {
          width: min(330px, calc(100vw - 36px));
          max-width: none;
          box-sizing: border-box;
          padding: 16px;
          gap: 13px 12px;
          grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
          background: #0c1d33;
          border: 1px solid #24527c;
          border-radius: 15px;
          box-shadow: 0 14px 34px #0007;
        }
        .renewDropdown.jcRenewForm .jcRenewFull { grid-column: 1 / -1; }
        .renewDropdown.jcRenewForm label {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 7px;
          color: #a9c9e8;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }
        .renewDropdown.jcRenewForm label small {
          display: block; color: #7fa4c5; font-size: 11px; font-weight: 400;
        }
        .renewDropdown.jcRenewForm input,
        .renewDropdown.jcRenewForm select {
          width: 100%; min-width: 0; height: 42px;
          box-sizing: border-box;
          border-radius: 9px; border: 1px solid #2b547e;
          background: #08172a; padding: 9px 10px;
          color: #f4faff; font-size: 13px;
          outline: none;
        }
        .renewDropdown.jcRenewForm input:focus,
        .renewDropdown.jcRenewForm select:focus {
          border-color: #26a7ff; box-shadow: 0 0 0 3px #188def22;
        }
        .renewDropdown.jcRenewForm .primaryMini {
          grid-column: 1 / -1; width: 100%; min-height: 42px;
          margin-top: 4px; border-radius: 10px; font-size: 14px;
        }
      `}</style>
      <style>{`
        .jcOrderMessageCard {padding:14px;border:1px solid #28557d;border-radius:12px;background:#071b31;min-width:0;}
        .jcOrderMessageCard h3 {font-size:15px;margin:0 0 10px;color:#ecf7ff;}
        .jcOrderMessageCard textarea {display:block;width:100%;min-height:155px;box-sizing:border-box;background:#061424;color:#eaf6ff;border:1px solid #2c547c;border-radius:9px;padding:12px;resize:vertical;line-height:1.5;}
        .jcOrderMessageCard .inlineActions {display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
        @media(max-width:600px){.jcOrderMessageCard{padding:10px;}.jcOrderMessageCard .inlineActions button{flex:1 1 130px;}}
      `}</style>
      {clientAccess && (
        <div role="presentation" style={{ position: "fixed", inset: 0, background: "rgba(0, 8, 20, .82)", zIndex: 1200, display: "grid", placeItems: "center", padding: 16 }} onClick={() => setClientAccess(null)}>
          <section role="dialog" aria-modal="true" aria-label="Entregar acceso al cliente" className="card" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 510, maxHeight: "90vh", overflowY: "auto", padding: 22, border: "1px solid #28618b", borderRadius: 16, background: "#0b2037", color: "#edf7ff" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>🔐 Entregar acceso</h2>
              <button type="button" className="miniButton" onClick={() => setClientAccess(null)}>Cerrar ✕</button>
            </div>
            <p style={{ color: "#a9c9e8", margin: "10px 0 18px" }}>Cliente: <strong>{clientAccess.cliente.nombre}</strong> · @{clientAccess.cliente.username}</p>
            {!clientAccess.text ? (
              <>
                <label style={{ display: "block", marginBottom: 12 }}>Nueva contraseña del cliente
                  <input type="text" autoComplete="off" spellCheck={false} minLength={6} value={clientAccess.password} onChange={(e) => setClientAccess((old) => ({ ...old, password: e.target.value }))} placeholder="Mínimo 6 caracteres" style={{ width: "100%", marginTop: 7, padding: 12, color: "#fff", background: "#06182a", border: "1px solid #315b83", borderRadius: 9, boxSizing: "border-box" }} />
                </label>
                <p style={{ color: "#9ebbd2", fontSize: 12 }}>Por seguridad, Supabase no permite consultar la contraseña anterior. Esta opción establece una nueva contraseña y genera el mensaje con el acceso correcto.</p>
                <button type="button" className="miniButton primaryMini" disabled={working || clientAccess.password.length < 6} onClick={generateClientAccess}>{working ? "Guardando..." : "Guardar contraseña y generar mensaje"}</button>
              </>
            ) : (
              <>
                <div style={{ background: "#06182a", border: "1px solid #315b83", borderRadius: 10, padding: 14, whiteSpace: "pre-wrap", lineHeight: 1.6, overflowWrap: "anywhere" }}>{clientAccess.text}</div>
                <div className="inlineActions" style={{ marginTop: 14 }}>
                  <button type="button" className="miniButton primaryMini" onClick={(event) => copyText(clientAccess.text, event)}>📋 Copiar mensaje</button>
                  <button type="button" className="miniButton" onClick={() => setClientAccess((old) => ({ ...old, text: "", password: "" }))}>Crear otro acceso</button>
                </div>
                <p style={{ color: "#9ebbd2", fontSize: 12 }}>Comparte las credenciales únicamente con el cliente, por un canal privado.</p>
              </>
            )}
          </section>
        </div>
      )}
      {copyNotice && <div className="copyToast" role="status" aria-live="polite">¡Copiado al portapapeles! <span>✓</span></div>}
      {(error || message) && (
        <div key={`${error ? "error" : "ok"}-${error || message}`} className={`jcActionToast ${error ? "jcActionToastError" : "jcActionToastSuccess"}`} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
          <span className="jcActionToastEmoji" aria-hidden="true">{iconoAviso(error || message, Boolean(error))}</span>
          <span className="jcActionToastText">{error || message}</span>
          <button type="button" className="jcActionToastClose" aria-label="Cerrar aviso" onClick={() => { setError(""); setMessage(""); }}>×</button>
        </div>
      )}
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
          <button className={view === "dispositivos" ? "active" : ""} onClick={() => navigate("dispositivos")}><NavIcon name="inventory" /><span className="navText">Dispositivos ChatGPT</span></button>
          <button className={view === "catalogo" ? "active" : ""} onClick={() => navigate("catalogo")}><NavIcon name="gift" /><span className="navText">Catálogo para clientes</span></button>
          <p className="navLabel">GESTIÓN</p>
          <button className={view === "crearCliente" ? "active" : ""} onClick={() => navigate("crearCliente")}><NavIcon name="addClient" /><span className="navText">Crear cliente</span></button>
          <button className={view === "crearStreaming" ? "active" : ""} onClick={() => navigate("crearStreaming")}><NavIcon name="stream" /><span className="navText">Crear servicio streaming</span></button>
          <button className={view === "plantillas" ? "active" : ""} onClick={() => navigate("plantillas")}><NavIcon name="templates" /><span className="navText">Plantillas de mensajes</span></button>
          <button className={view === "cargaMasiva" ? "active" : ""} onClick={() => navigate("cargaMasiva")}><NavIcon name="bulk" /><span className="navText">Carga masiva</span></button>
        </nav>
        <div className="sidebarFooter"><button type="button" onClick={logout}><NavIcon name="logout" /><span>Salir</span></button></div>
      </aside>

      <section className="adminMain">
        <header className="adminMainHeader">
          <div><span>Panel administrador</span><strong>{VIEW_TITLES[view]}</strong></div>
          <button className="linkButton desktopLogout" onClick={logout}>Salir</button>
        </header>
        <div className="adminPageContent">
          {["pedido", "activas", "vencidas"].includes(view) && inventoryExpiryNotices.length > 0 && (
            <details className="jcInventoryExpiryAlert jcInventoryNoticeCompact">
              <summary>⚠️ Avisos pendientes de retiro ({inventoryExpiryNotices.length})</summary>
              <div className="jcInventoryNoticeContents">
                <p>Marca Liberado cuando hayas retirado al cliente en la plataforma oficial. Para una renovación, abre el formulario completo: el aviso solo se resolverá después de guardar el pedido y su ganancia.</p>
                <div className="jcInventoryNoticeToolbar">
                  <label className="jcInventoryNoticeSelectAll">
                    <input type="checkbox" disabled={working}
                      checked={inventoryExpiryNotices.length > 0 && inventoryExpiryNotices.every(({assignment,sub}) => selectedInventoryNotices.includes(`${assignment.id}:${sub.fecha_vencimiento}`))}
                      onChange={(event) => {
                        const visibleKeys = inventoryExpiryNotices.map(({assignment,sub}) => `${assignment.id}:${sub.fecha_vencimiento}`);
                        setSelectedInventoryNotices((prev) => event.target.checked
                          ? [...new Set([...prev, ...visibleKeys])]
                          : prev.filter((key) => !visibleKeys.includes(key)));
                      }}
                    />
                    Seleccionar todos
                  </label>
                  <span>{inventoryExpiryNotices.filter(({assignment,sub}) => selectedInventoryNotices.includes(`${assignment.id}:${sub.fecha_vencimiento}`)).length} seleccionado(s)</span>
                  <button type="button" className="miniButton jcNoticeManagedButton"
                    disabled={working || !inventoryExpiryNotices.some(({assignment,sub}) => selectedInventoryNotices.includes(`${assignment.id}:${sub.fecha_vencimiento}`))}
                    onClick={markSelectedInventoryNoticesManaged}>
                    {working ? "Guardando..." : "Gestionar seleccionados"}
                  </button>
                </div>
                <div className="jcInventoryExpiryList jcInventoryNoticeRows">
                  {inventoryExpiryNotices.map(({assignment,sub,account}) => {
                    const noticeKey = `${assignment.id}:${sub.fecha_vencimiento}`;
                    const invitation = needsCustomerInvitationEmail({ ...assignment, item: account, sub });
                    const emby = normalizeText(sub.servicio?.nombre || "").includes("emby");
                    const pin = account.perfiles_pins?.[String(assignment.cupo_numero)] || account.pin;
                    return (
                      <div key={noticeKey} className="jcInventoryNoticeRow">
                        <div className="jcInventoryNoticeRowTop">
                          <label className="jcInventoryNoticeCheckbox">
                            <input type="checkbox" checked={selectedInventoryNotices.includes(noticeKey)} disabled={working}
                              onChange={() => toggleInventoryNoticeSelection(noticeKey)} />
                            <span className="jcInventoryNoticeIdentity"><strong>{sub.cliente?.nombre || "Cliente"}</strong><small>{sub.servicio?.nombre || "Servicio"} · {effectiveDeliveryType(sub.servicio) === "estandar" ? "Perfil" : "Cupo"} {assignment.cupo_numero}</small></span>
                          </label>
                          <small className="jcInventoryNoticeExpired">{sub.days === 0 ? "Venció hoy" : `Hace ${Math.abs(sub.days)} día(s)`}</small>
                          <div className="jcNoticeActionRow">
                            <button type="button" className="miniButton jcNoticeManagedButton" disabled={working} onClick={() => markInventoryNoticeManaged(assignment, sub, "retirado")}>Liberado</button>
                            <button type="button" className="miniButton" disabled={working} onClick={() => openRenewalFromNotice(assignment, sub)}>Renovar mismo cliente</button>
                          </div>
                        </div>
                        <details className="jcInventoryNoticeCredentials">
                          <summary>🔐 Ver credenciales</summary>
                          <div className="jcInventoryNoticeCredentialsBody">
                            {invitation ? (
                              <>
                                <div><strong>Correo del grupo:</strong><span>{account.grupo || account.correo || "—"}</span></div>
                                {assignment.correo_cliente && <div><strong>Correo del cliente:</strong><span>{assignment.correo_cliente}</span></div>}
                              </>
                            ) : (
                              <div><strong>{emby ? "Usuario:" : "Cuenta:"}</strong><span>{account.correo || account.grupo || "—"}</span></div>
                            )}
                            {emby && extractEmbyServer(account.notas) && <div><strong>Servidor:</strong><span>{extractEmbyServer(account.notas)}</span></div>}
                            {account.clave && <div><strong>Contraseña:</strong><span>{account.clave}</span></div>}
                            <div><strong>Perfil / cupo:</strong><span>{assignment.cupo_numero}</span></div>
                            {pin && <div><strong>PIN:</strong><span>{pin}</span></div>}
                          </div>
                        </details>
                      </div>
                    );
                  })}
                </div>
              </div>
            </details>
          )}
          {view === "pedido" && renderPedido()}
          {view === "renovar" && renderRenovacionDesdeAviso()}
          {view === "activas" && renderActivas()}
          {view === "vencidas" && renderVencidas()}
          {view === "ganancias" && renderGanancias()}
          {view === "clientes" && renderClientes()}
          {view === "promociones" && renderPromociones()}
          {view === "inventario" && renderInventario()}
          {view === "crearCliente" && renderCrearCliente()}
          {view === "crearStreaming" && renderCrearStreaming()}
          {view === "plantillas" && renderPlantillas()}
          {view === "cargaMasiva" && renderCargaMasiva()}
          {view === "catalogo" && renderCatalogo()}
          {view === "dispositivos" && renderDispositivos()}
        </div>
      </section>
      <style jsx global>{`
        .jcToolCards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin:15px 0 24px}
        .jcToolCard{display:flex;flex-direction:column;gap:9px;min-width:0;overflow-wrap:anywhere;padding:16px}
        .jcToolCard strong{font-size:16px}.jcToolCard small{color:#9fc1da}.jcToolCard p{white-space:pre-wrap;line-height:1.5}
        .jcToolSearch{width:min(100%,510px);padding:12px;border:1px solid #2e678f;background:#061728;color:#e8f5ff;border-radius:10px}
        .jcNoticeActionRow{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
        .jcBulkPanel {margin-bottom:20px;padding:24px;background:linear-gradient(145deg,#0c2238,#0a1b30);border:1px solid #234c71;border-radius:16px;color:#deedfc}
        .jcBulkPanel h2 {margin:0 0 6px;font-size:19px;color:#f4faff}
        .jcBulkPanel p {color:#a8c2dc;line-height:1.6}
        .jcBulkTop {display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:15px}
        .jcBulkTop select {max-width:340px;min-width:230px;background:#102d48;border:1px solid #347db1;color:#fff;border-radius:10px;padding:12px}
        .jcBulkHint {background:#0d3554;border-left:3px solid #34a9ee;border-radius:8px;padding:11px 14px;overflow-wrap:anywhere}
        .jcBulkLabel {display:block;font-weight:700;margin:18px 0 10px}
        .jcBulkPaste {display:block;width:100%;min-height:128px;background:#091c30;color:#f0f8ff;border:1px solid #28608b;border-radius:12px;padding:13px;resize:vertical;font:13px/1.5 ui-monospace,monospace}
        .jcBulkPaste:focus,.jcBulkTable input:focus {outline:2px solid #39b1ed;outline-offset:1px}
        .jcBulkActions {display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:14px 0}
        .jcBulkFile {cursor:pointer;display:inline-flex;align-items:center;background:#102d48;color:#eaf5ff;border:1px solid #347db1;border-radius:9px;padding:10px 15px;font-weight:700}
        .jcBulkFile input {display:none}
        .jcBulkNote {font-size:13px}
        .jcBulkScroll {overflow-x:auto;max-width:100%;border:1px solid #224c71;border-radius:12px}
        .jcBulkTable {width:100%;border-collapse:collapse;min-width:720px;font-size:13px}
        .jcBulkTable th {white-space:nowrap;background:#123c5d;color:#dff4ff;padding:12px;text-align:left}
        .jcBulkTable td {border-top:1px solid #244660;padding:8px;color:#deeeff;vertical-align:middle}
        .jcBulkTable input {min-width:130px;width:160px;background:#081d31;color:#fff;border:1px solid #345a78;border-radius:8px;padding:10px}
        .jcBulkTable .jcBulkOk {color:#67edac;font-weight:700}
        .jcBulkTable .jcBulkError {color:#ffb1a5;max-width:240px;min-width:180px}
        @media(max-width:600px){.jcBulkPanel{padding:14px}.jcBulkTop select{width:100%;max-width:none}}


        .jcTemplateTabs { display:flex; flex-wrap:wrap; gap:10px; margin: 10px 0 20px; }
        .jcTemplateTabs button { border:1px solid #23567f; background:#0b2036; color:#b8daf7; border-radius:12px; padding:13px 19px; font-weight:700; cursor:pointer; }
        .jcTemplateTabs button.active { background:linear-gradient(110deg,#0b75cf,#087eb2); color:#fff; box-shadow:0 5px 18px #001d3a; }
        .jcTemplateTabs span { margin-left:7px; background:#153b5d; border-radius:16px; padding:3px 9px; }
        .jcTemplateEditor, .jcTemplateList { max-width:920px; }
        .jcTemplateList { padding:24px !important; }
        .jcTemplateSectionHeading h2 { margin:0 0 6px; font-size:1.3rem; color:#f2f8ff; }
        .jcTemplateSectionHeading p { margin:0 0 18px; color:#9ec3e2; }
        .jcTemplateListHeading { padding: 4px 2px 0; margin-bottom:18px; }
        .jcTemplateListHeading p { margin-bottom:0; line-height:1.5; }
        .jcTemplateSearchWrap { position:relative; margin:0 0 20px; }
        .jcTemplateSearchIcon { position:absolute; left:15px; top:50%; transform:translateY(-50%); pointer-events:none; font-size:1rem; }
        .jcTemplateSearchWrap input { display:block; width:100%; min-height:48px; border:1px solid #28658e; border-radius:12px; padding:11px 15px 11px 47px; outline:none; color:#eaf6ff; background:#071727; font:inherit; transition:border-color .2s, box-shadow .2s; }
        .jcTemplateSearchWrap input:focus { border-color:#28a6ed; box-shadow:0 0 0 3px #178bca30; }
        .jcTemplateSearchWrap input::placeholder { color:#91adc6; }
        .jcTemplateSelectWrap { position:relative; }
        .jcTemplateOptions { position:absolute; z-index:120; top:100%; left:0; right:0; max-height:250px; overflow:auto; border:1px solid #2c658d; border-radius:12px; background:#06172a; box-shadow:0 18px 32px #0008; }
        .jcTemplateOptions button { display:block; width:100%; border:0; border-bottom:1px solid #173553; text-align:left; color:#e6f5ff; background:transparent; padding:12px 14px; cursor:pointer; }
        .jcTemplateOptions button:hover, .jcTemplateOptions button:focus { background:#123c63; }
        .jcTemplateOptions p { padding:12px; color:#9ec3e2; }
        .jcTemplateCards { display:grid; grid-template-columns:1fr; gap:12px; margin-top:0; }
        .jcTemplateCard { border:1px solid #214969; border-radius:15px; padding:16px 18px; background:linear-gradient(125deg,#0a1e33,#0d2a44); min-width:0; }
        .jcTemplateCardTop { display:flex; gap:10px; align-items:center; margin-bottom:13px; }
        .jcTemplateCardTop strong { display:block; color:#fff; font-size:1.05rem; line-height:1.45; overflow-wrap:anywhere; }
        .jcTemplateServiceName { color:#54b9fa; text-transform:capitalize; }
        .jcTemplateNameSeparator { color:#7d9eb9; }
        .jcTemplateCard .inlineActions { margin:0; }
        @media(max-width:600px) { .jcTemplateTabs { display:grid; grid-template-columns:1fr 1fr; } .jcTemplateTabs button { padding:12px 8px; font-size:.82rem; } }

        .jcTemplateVariables { padding: 12px; background: #0b2136; border-radius: 12px; border: 1px solid #214669; }
        .jcTemplateTokens { display: flex; flex-wrap: wrap; gap: 7px; margin: 12px 0; }
        .jcTemplatePreview { border: 1px solid #214669; border-radius: 12px; padding: 16px; background: #071525; }
        .jcTemplatePreview pre { white-space: pre-wrap; word-break: break-word; font: inherit; margin: 12px 0 0; }
        /* Avisos flotantes: visibles desde cualquier altura del panel */
        .jcActionToast {
          position: fixed;
          z-index: 1200;
          top: 20px;
          right: 22px;
          width: min(440px, calc(100vw - 32px));
          display: flex;
          align-items: center;
          gap: 13px;
          padding: 16px 14px;
          border: 1px solid #246da1;
          border-radius: 16px;
          background: linear-gradient(135deg, #0e2943 0%, #0a182a 100%);
          box-shadow: 0 16px 48px rgba(0,0,0,.42);
          color: #f2f8ff;
          font-size: 14px;
          line-height: 1.4;
          animation: jcToastSuccess 6s ease both;
        }
        .jcActionToastError {
          border-color: #b35b65;
          background: linear-gradient(135deg, #45222a 0%, #23141c 100%);
          animation: jcToastError 10s ease both;
        }
        .jcActionToastEmoji { font-size: 25px; flex: 0 0 auto; }
        .jcActionToastText { flex: 1; overflow-wrap: anywhere; font-weight: 600; }
        .jcActionToastClose {
          border: 0; background: transparent; color: #c2d3e6;
          font-size: 25px; cursor: pointer; align-self: flex-start;
          line-height: 1; padding: 0 2px;
        }
        @keyframes jcToastSuccess {
          0% { opacity: 0; transform: translateY(-15px) scale(.97); }
          8%, 82% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-9px) scale(.99); }
        }
        @keyframes jcToastError {
          0% { opacity: 0; transform: translateY(-15px) scale(.97); }
          5%, 88% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-9px) scale(.99); }
        }
        @media (max-width: 720px) {
          /* El menú queda fijo, pero el título puede desplazarse sin tapar contenido. */
          .adminShell .adminMainHeader {
            position: relative !important;
            top: auto !important;
            z-index: 1 !important;
            height: auto !important;
            min-height: 58px;
          }
          .adminShell .adminPageContent { padding-top: 12px; }
          .jcActionToast {
            top: calc(66px + env(safe-area-inset-top, 0px));
            left: 12px; right: 12px;
            width: auto;
            font-size: 13px;
            padding: 13px 12px;
            border-radius: 13px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .jcActionToast, .jcActionToastError { animation: none; }
        }
      `}</style>
    </main>
  );
}