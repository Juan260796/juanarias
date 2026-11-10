"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

// La información comercial se carga en tiempo real desde el editor del administrador.
// Los logos se consultan por servicio; si uno no está disponible se muestra el nombre.
const BRANDS = [
  [/netflix/i, "Netflix", "netflix", "e50914", "streaming"],
  [/directv/i, "DIRECTV GO", "directv", "f5a32d", "streaming"],
  [/emby/i, "Emby", "emby", "4caf50", "streaming"],
  [/prime\s*video|amazon\s*prime/i, "Prime Video", "primevideo", "18aee0", "streaming"],
  [/crunchy/i, "Crunchyroll", "crunchyroll", "ff8b21", "streaming"],
  [/plex/i, "Plex", "plex", "edab31", "streaming"],
  [/^vix|\bvix\b/i, "ViX", "vix", "ff8b36", "streaming"],
  [/hbo|max\b/i, "HBO Max", "hbomax", "9b77ed", "streaming"],
  [/paramount/i, "Paramount+", "paramountplus", "5ca9fa", "streaming"],
  [/disney/i, "Disney+", "disneyplus", "59c2f5", "streaming"],
  [/apple\s*tv/i, "Apple TV", "appletv", "ffffff", "streaming"],
  [/viki/i, "Viki", "viki", "49cdff", "streaming"],
  [/mubi/i, "MUBI", "mubi", "ffffff", "streaming"],
  [/youtube/i, "YouTube Premium", "youtube", "ff3344", "streaming"],
  [/flujo/i, "Flujo TV", "", "29c6d8", "streaming"],
  [/capcut/i, "CapCut", "capcut", "ffffff", "ia"],
  [/chat\s*gpt|openai/i, "ChatGPT", "openai", "d9ecea", "ia"],
  [/gemini/i, "Gemini", "googlegemini", "a688fd", "ia"],
  [/muse/i, "Muse AI", "", "d095fd", "ia"],
  [/perplexity/i, "Perplexity", "perplexity", "58b9c5", "ia"],
  [/leonardo/i, "Leonardo AI", "", "d2a1ff", "ia"],
  [/canva/i, "Canva", "canva", "47cedc", "ia"],
  [/adobe\s*creative/i, "Adobe", "adobe", "ff3939", "ia"],
  [/photoshop/i, "Photoshop", "adobephotoshop", "4fc5ff", "ia"],
  [/office|microsoft\s*365/i, "Office 365", "microsoftoffice", "ff7c43", "ia"],
  [/autodesk/i, "Autodesk", "autodesk", "55c6ff", "ia"],
  [/vpn/i, "VPN", "", "6fe6dc", "ia"],
  [/scrib/i, "Scribd", "scribd", "4ce5b3", "educacion"],
  [/slide\s*share/i, "SlideShare", "slideshare", "70b8ff", "educacion"],
  [/audible/i, "Audible", "audible", "ffbe58", "educacion"],
  [/coursera/i, "Coursera", "coursera", "69b9ff", "educacion"],
  [/duolingo/i, "Duolingo", "duolingo", "a4eb44", "educacion"],
  [/spotify/i, "Spotify", "spotify", "40e67a", "musica"],
  [/deezer/i, "Deezer", "deezer", "ffac5c", "musica"]
];
const WHATSAPP_VENTAS = "573137279240"; // Mismo número de soporte y promociones del panel de clientes.
const GROUPS = [
  {key:"streaming",title:"Streaming y entretenimiento",icon:"▶"},
  {key:"ia",title:"IA, diseño y productividad",icon:"✦"},
  {key:"educacion",title:"Educación, lectura y herramientas",icon:"▤"},
  {key:"musica",title:"Música",icon:"♫"},
  {key:"otros",title:"Otros servicios",icon:"✧"}
];
function brandFor(title) {
  const match = BRANDS.find(([regex]) => regex.test(title || ""));
  return match ? {name:match[1],slug:match[2],color:match[3],group:match[4]} : {name:title || "Servicio",slug:"",color:"79cffa",group:"otros"};
}
function enlaceInteres(item) {
  const detalle = [item.titulo, item.duracion, item.descripcion].map(x => String(x || "").trim()).filter(Boolean).join(" · ");
  const mensaje = `¡Hola! 👋 Me interesa contratar ${detalle} por ${String(item.precio || "").trim()}. ¿Está disponible?`;
  return `https://wa.me/${WHATSAPP_VENTAS}?text=${encodeURIComponent(mensaje)}`;
}
function BrandLogo({brand}) {
  const [failed,setFailed] = useState(false);
  return <span className="catalogBrand" style={{"--brand-color":`#${brand.color}`}}>
    {brand.slug && !failed ? <img src={`https://cdn.simpleicons.org/${brand.slug}/${brand.color}`} alt="" loading="lazy" onError={()=>setFailed(true)}/> : <span className="catalogBrandFallback">◆</span>}
    <b>{brand.name}</b>
  </span>;
}
// La vista y su impresión/PDF muestran únicamente productos con precio definido.
// Se aplica también a la vista previa del administrador, que usa otra API.
function tienePrecio(precio) {
  const texto = String(precio ?? "").trim();
  if (!texto || /^(consultar|sin precio|pendiente|por definir|n\/?a|gratis|no disponible)$/i.test(texto)) return false;
  const numeros = texto.match(/\d+/g);
  return Boolean(numeros && numeros.some((n) => Number(n) > 0));
}
export default function CatalogoCliente() {
  const router = useRouter();
  const [items,setItems] = useState([]);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);
  const [lastUpdated,setLastUpdated] = useState(null);
  const [search,setSearch] = useState("");
  const filteredItems = useMemo(()=>{
    const query=search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    if(!query) return items;
    return items.filter(item=>[item.titulo,item.duracion,item.descripcion,brandFor(item.titulo).name].some(value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().includes(query)));
  },[items,search]);
  const grouped = useMemo(()=>GROUPS.map(group=>({...group, items:filteredItems.filter(item=>brandFor(item.titulo).group===group.key)})).filter(group=>group.items.length),[filteredItems]);
  useEffect(()=>{
    let active=true;
    const loadCatalog = async()=>{
      try {
        const {data:session,error:sessionError}=await supabase.auth.getSession();
        if (sessionError || !session?.session?.access_token) {router.replace("/login");return;}
        const headers={Authorization:`Bearer ${session.session.access_token}`};
        let response=await fetch("/api/cliente/catalogo",{headers,cache:"no-store"});
        // La vista previa también funciona para el administrador, no solo para clientes.
        if(response.status===403) response=await fetch("/api/admin/catalogo",{headers,cache:"no-store"});
        const payload=await response.json();
        if(!response.ok) throw new Error(payload.error || "No se pudo cargar el catálogo.");
        if(active) {
          setItems((payload.items || []).filter(item=>item.activo !== false && tienePrecio(item.precio)));
          setLastUpdated(new Date());
          setError("");
        }
      } catch(e){if(active)setError(e.message || "Error al consultar el catálogo");}
      finally {if(active)setLoading(false);}
    };
    loadCatalog();
    // Al regresar a esta pestaña, consultar de nuevo los precios vigentes.
    const onFocus = ()=>loadCatalog();
    const onVisible = ()=>{if(document.visibilityState === "visible")loadCatalog();};
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onVisible);
    return ()=>{active=false;window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onVisible);};
  },[router]);
  return <main className="jcCatalogPage">
    <header className="jcCatalogHero">
      <img className="jcCatalogMainLogo" src="/logo.jpg" alt="JUAN CUENTAS" />
      <h1>CATÁLOGO DE SERVICIOS</h1><p>Precios actualizados</p>
      <div className="jcCatalogGuarantee">🛡️ Cuentas full garantizadas por el tiempo contratado ✅</div>
    </header>
    <nav className="jcCatalogActions">
      <button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(window.location.href);alert("Enlace del catálogo copiado. Compártelo con tus clientes.");}catch{window.prompt("Copia el enlace del catálogo:",window.location.href);}}}>🔗 Copiar enlace del catálogo</button>
      <button type="button" onClick={()=>router.push("/cliente")}>← Volver al panel</button>
    </nav>
    <p className="jcCatalogOnlineInfo">🌐 Catálogo en línea · Los precios se actualizan al abrir o volver a esta página. {lastUpdated ? `Actualizado: ${lastUpdated.toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"})}` : ""}</p>
    <div className="jcCatalogSearchBar">
      <label htmlFor="jcCatalogSearch">🔎 Busca tu servicio</label>
      <div className="jcCatalogSearchInputWrap">
        <input id="jcCatalogSearch" type="search" autoComplete="off" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Ej. Netflix, Spotify, ChatGPT..." />
        {search && <button type="button" onClick={()=>setSearch("")} aria-label="Limpiar búsqueda">✕</button>}
      </div>
      <span>{search ? `${filteredItems.length} resultado(s)` : `${items.length} servicios disponibles`}</span>
    </div>
    {!loading && !error && items.length > 0 && grouped.length === 0 && <p className="jcCatalogStatus">No encontramos ese servicio. Prueba con otro nombre.</p>}
    {loading && <p className="jcCatalogStatus">Cargando precios actualizados...</p>}
    {error && <p role="alert" className="jcCatalogStatus">{error}</p>}
    {!loading && !error && !items.length && <p className="jcCatalogStatus">Estamos preparando el catálogo. Puedes consultar nuestras promociones en tu panel.</p>}
    <div className="jcCatalogGrid">{grouped.map(group=><section className="jcCatalogSection" key={group.key}>
      <h2><span>{group.icon}</span>{group.title}</h2>
      {group.items.map(item=>{
        const brand=brandFor(item.titulo);
        return <article key={item.id} className="jcCatalogItem">
          <BrandLogo brand={brand}/>
          <div className="jcCatalogDescription"><strong>{item.titulo}</strong>{item.duracion && <span>{item.duracion}</span>}{item.descripcion && <small>{item.descripcion}</small>}</div>
          <a className="jcCatalogInterest" href={enlaceInteres(item)} target="_blank" rel="noopener noreferrer" aria-label={`Me interesa ${item.titulo}${item.duracion ? `, ${item.duracion}` : ""}. Consultar por WhatsApp`}>💬 Me interesa</a>
          <div className="jcCatalogPrice">{String(item.precio || "").trim()}</div>
        </article>;
      })}
    </section>)}</div>
    <footer className="jcCatalogFooter">Precios sujetos a cambios · JUAN CUENTAS · juancuentas.com</footer>
    <style jsx global>{`
      .jcCatalogPage{--cyan:#33caff;--orange:#ffa340;min-height:100vh;background:radial-gradient(ellipse at top left,#112a59 0%,transparent 40%),radial-gradient(ellipse at top right,#48220e 0%,transparent 40%),#050d1b;color:#edf8ff;font-family:Arial,sans-serif;padding:25px max(15px,calc((100vw - 1190px)/2));box-sizing:border-box}
      .jcCatalogHero{text-align:center;padding:12px 0 16px}.jcCatalogMainLogo{display:block;width:clamp(110px,19vw,195px);height:auto;border-radius:50%;margin:0 auto 12px}.jcCatalogHero h1{margin:0;color:white;font-size:clamp(24px,4vw,42px);font-weight:900;letter-spacing:.6px;text-shadow:0 0 20px #0485d080}.jcCatalogHero p{display:inline-block;border:1px solid #28adf0;border-radius:100px;margin:11px 0 0;padding:7px 30px;color:#c7edff;background:#123052}
      .jcCatalogGuarantee{width:fit-content;max-width:100%;box-sizing:border-box;margin:14px auto 2px;padding:10px 18px;border:1px solid #2e8fcb;background:linear-gradient(105deg,#0b345a,#071a32);border-radius:12px;color:#d6f5ff;font-weight:750;font-size:clamp(13px,1.8vw,18px);line-height:1.5;text-align:center;box-shadow:0 5px 22px #0004}.jcCatalogActions{display:flex;gap:12px;justify-content:center;margin:15px 0 26px;flex-wrap:wrap}.jcCatalogActions button{background:#103455;border:1px solid #2a86be;color:white;border-radius:9px;padding:11px 16px;cursor:pointer;font-weight:600}.jcCatalogActions button:first-child{background:linear-gradient(120deg,#0359b5,#089bdc)}.jcCatalogOnlineInfo{text-align:center;color:#b3e3f4;font-size:13px;line-height:1.5;margin:5px 0 22px}.jcCatalogPrintButton{background:#233047!important}.jcCatalogActions button:focus-visible{outline:3px solid #7ce1ff}
      .jcCatalogSearchBar{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:14px 18px;margin:0 0 22px;border:1px solid #2475b7;border-radius:15px;background:linear-gradient(110deg,#0b294b,#081a32);box-shadow:0 5px 20px #0003}.jcCatalogSearchBar label{color:#bfe8ff;font-weight:750;font-size:14px;white-space:nowrap}.jcCatalogSearchInputWrap{position:relative;flex:1 1 250px;min-width:0}.jcCatalogSearchInputWrap input{box-sizing:border-box;width:100%;height:44px;border:1px solid #2884c7;background:#06182c;color:#f3fbff;border-radius:10px;padding:0 40px 0 14px;outline-color:#43c5ff;font-size:15px}.jcCatalogSearchInputWrap input::placeholder{color:#8fb1ce}.jcCatalogSearchInputWrap button{position:absolute;right:5px;top:5px;height:34px;width:34px;border:0;border-radius:8px;background:#153c61;color:#cceeff;cursor:pointer}.jcCatalogSearchBar>span{color:#9ccce8;font-size:12px;white-space:nowrap}
      .jcCatalogGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}.jcCatalogSection{min-width:0;border:1px solid #2085c0;border-bottom-color:#fa9b3b;border-right-color:#f39630;border-radius:18px;padding:12px;background:linear-gradient(160deg,#0a2139,#050d1b);box-shadow:0 6px 35px #0005;break-inside:avoid}.jcCatalogSection h2{display:flex;align-items:center;gap:12px;margin:0 0 10px;padding:12px;background:linear-gradient(110deg,#063c78,#09213b);border-radius:11px;color:#f1faff;text-transform:uppercase;font-size:clamp(13px,1.5vw,19px);letter-spacing:.4px}.jcCatalogSection h2 span{color:#ffad45;font-size:24px}
      .jcCatalogItem{display:grid;grid-template-columns:minmax(98px,24%) minmax(0,1fr) auto auto;grid-template-areas:"brand desc interest price";align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid #24415c;break-inside:avoid}.jcCatalogItem:last-child{border-bottom:0}.jcCatalogItem>.catalogBrand{grid-area:brand}.jcCatalogItem>.jcCatalogDescription{grid-area:desc}.jcCatalogItem>.jcCatalogInterest{grid-area:interest}.jcCatalogItem>.jcCatalogPrice{grid-area:price}.jcCatalogInterest{display:inline-flex;justify-content:center;align-items:center;min-height:34px;padding:6px 10px;border-radius:9px;border:1px solid #3db7fa;background:linear-gradient(120deg,#0668bc,#0b91cc);color:#fff;text-decoration:none;font-weight:800;font-size:12px;white-space:nowrap;box-sizing:border-box;transition:filter .16s,transform .16s}.jcCatalogInterest:hover{filter:brightness(1.2);transform:translateY(-1px)}.jcCatalogInterest:focus-visible{outline:3px solid #c1f0ff;outline-offset:2px}.catalogBrand{display:flex;align-items:center;gap:7px;min-width:0;color:var(--brand-color)}.catalogBrand img{display:block;width:22px;height:22px;object-fit:contain;flex:none}.catalogBrandFallback{font-size:14px;line-height:22px}.catalogBrand b{font-size:clamp(10px,1.1vw,13px);overflow-wrap:anywhere}.jcCatalogDescription{min-width:0;display:grid;gap:3px;font-size:clamp(10px,1.2vw,13px)}.jcCatalogDescription strong{font-weight:650}.jcCatalogDescription span{color:#bde1fa}.jcCatalogDescription small{color:#8daec6;line-height:1.3;white-space:pre-line}.jcCatalogPrice{border:1px solid #fc9834;border-radius:8px;color:#ffca8d;white-space:nowrap;padding:6px 8px;font-size:clamp(11px,1.2vw,14px);font-weight:800}.jcCatalogStatus{text-align:center;padding:45px 15px}.jcCatalogFooter{text-align:center;color:#bed4e7;padding:30px 0 10px;font-size:14px}
      @media(max-width:800px){.jcCatalogGrid{grid-template-columns:1fr}.jcCatalogItem{grid-template-columns:minmax(90px,28%) minmax(0,1fr) auto;grid-template-areas:"brand desc price" ". interest interest"}.jcCatalogInterest{justify-self:end;min-width:130px}.catalogBrand b,.jcCatalogDescription{font-size:12px}.jcCatalogPrice{font-size:12px}}
      @media(max-width:400px){.jcCatalogSection{padding:8px}.jcCatalogItem{gap:6px;grid-template-columns:77px minmax(0,1fr) auto}.catalogBrand{gap:3px}.catalogBrand img{width:16px;height:16px}.catalogBrand b{font-size:10px}.jcCatalogDescription{font-size:10px}.jcCatalogPrice{padding:4px;font-size:10px}}
      @media print {
        @page {size:A4 portrait;margin:10mm}
        html,body{margin:0!important;padding:0!important;background:#071627!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        .jcCatalogPage{background:#071627!important;color:#edf8ff!important;width:100%!important;max-width:none!important;min-height:0!important;margin:0!important;padding:4mm!important;box-sizing:border-box!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        .jcCatalogActions,.jcCatalogStatus,.jcCatalogOnlineInfo,.jcCatalogSearchBar,.jcCatalogInterest{display:none!important}
        .jcCatalogHero{padding:0 0 5mm!important;break-inside:avoid!important}
        .jcCatalogMainLogo{width:72px!important;margin:0 auto 4px!important}
        .jcCatalogHero h1{font-size:25px!important;letter-spacing:0!important;line-height:1.15!important}
        .jcCatalogHero p{font-size:12px!important;margin:6px 0 0!important;padding:4px 14px!important}
        .jcCatalogGrid{display:block!important;columns:2!important;column-gap:5mm!important}
        .jcCatalogSection{display:inline-block!important;width:100%!important;box-sizing:border-box!important;break-inside:avoid!important;page-break-inside:avoid!important;padding:8px!important;margin:0 0 4mm!important;border-radius:8px!important;box-shadow:none!important;vertical-align:top!important}
        .jcCatalogSection h2{padding:8px!important;margin-bottom:5px!important;font-size:11px!important;line-height:1.2!important;gap:5px!important;border-radius:5px!important}
        .jcCatalogSection h2 span{font-size:14px!important}
        .jcCatalogItem{grid-template-columns:72px minmax(0,1fr) auto!important;grid-template-areas:"brand desc price"!important;gap:5px!important;padding:6px 2px!important;min-height:0!important;break-inside:avoid!important}
        .catalogBrand{gap:4px!important}.catalogBrand b{font-size:9px!important;line-height:1.2!important}.catalogBrand img{width:15px!important;height:15px!important}.catalogBrandFallback{font-size:11px!important;line-height:15px!important}
        .jcCatalogDescription{font-size:9.5px!important;line-height:1.25!important;gap:2px!important}.jcCatalogDescription span{font-size:9px!important}.jcCatalogDescription small{font-size:8px!important;line-height:1.2!important}
        .jcCatalogPrice{font-size:10px!important;padding:4px 5px!important;border-radius:5px!important}
        .jcCatalogFooter{font-size:10px!important;padding:4mm 0 0!important;break-inside:avoid!important}
      }
    `}</style>
  </main>;
}
