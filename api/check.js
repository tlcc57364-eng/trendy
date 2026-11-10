// Vercel Serverless Function
//   /api/check            -> pública: solo revisa la tienda y devuelve el estado (la usa la página, NO avisa)
//   /api/check?key=CLAVE  -> la llama cron-job.org cada minuto: revisa y, si encuentra algo, AVISA por Telegram
//
// Variables de entorno en Vercel (Settings > Environment Variables):
//   TELEGRAM_TOKEN    token del bot (@BotFather)
//   TELEGRAM_CHAT_ID  tu chat ID (@userinfobot)
//   SECRET_KEY        clave para que nadie más pueda llamar la función
//   KEYWORDS          (opcional) palabras separadas por coma. Por defecto: las del calendario Luxury "Wonderland"
//   IGNORAR           (opcional) nombres de productos que ya existen y NO deben avisar
//   TARGET_URL        (opcional) URLs propias separadas por coma; si no se pone, se busca cada palabra en el catálogo
//
// Parámetros opcionales:
//   &test=1  -> envía un mensaje de prueba a Telegram

const TIENDA = "https://www.maquillajetrendyshop.com";

// Lo que se sabe del calendario 2026: Calendario de Adviento Luxury "Wonderland", baúl vinotinto, solo por preventa web.
const DEFAULT_KEYWORDS = "calendario,adviento,advent,preventa,wonderland,luxury,baul,vinotinto";

// Productos que YA están en la tienda y contienen alguna palabra clave (revisado el 7-nov-2026).
const DEFAULT_IGNORAR = "iluminador wonderland glow,kit brochas trendy marmol luxury,baul mediano negro";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function lista(valor, porDefecto = "") {
  return (valor || porDefecto).split(",").map(s => s.trim()).filter(Boolean);
}

// minúsculas y sin tildes: "Baúl" -> "baul"
const normal = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const urlBusqueda = palabra =>
  `${TIENDA}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(palabra)}&_from=0&_to=49`;

async function telegram(text) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
  });
  if (!r.ok) throw new Error(`Telegram respondió ${r.status}: ${await r.text()}`);
}

function limpiar(contenido) {
  return normal(contenido
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " "));
}

// Catálogo VTEX: la búsqueda devuelve una lista de productos en JSON.
// Solo se miran los NOMBRES de los productos, así el menú o los banners no dan falsas alarmas.
function productosVtex(datos) {
  if (!Array.isArray(datos)) return null;
  return datos.map(p => {
    const oferta = p.items?.[0]?.sellers?.[0]?.commertialOffer || {};
    return { id: p.productId, nombre: p.productName, precio: oferta.Price, stock: oferta.AvailableQuantity, link: p.link };
  });
}

async function revisar(url, keywords, ignorar) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9" },
      signal: AbortSignal.timeout(8000),
    });
    const cuerpo = await r.text();

    let productos = null;
    try { productos = productosVtex(JSON.parse(cuerpo)); } catch {}

    if (productos) {
      const nuevos = productos.filter(p => {
        const n = normal(p.nombre);
        return keywords.some(k => n.includes(k)) && !ignorar.some(i => n.includes(i));
      });
      const encontradas = keywords.filter(k => nuevos.some(p => normal(p.nombre).includes(k)));
      return { url, status: r.status, tipo: "catalogo", encontradas, productos: nuevos };
    }

    const texto = limpiar(cuerpo);
    return { url, status: r.status, tipo: "pagina", encontradas: keywords.filter(k => texto.includes(k)) };
  } catch (e) {
    return { url, status: 0, encontradas: [], error: String(e) };
  }
}

const precioCOP = n => (typeof n === "number" ? `$${n.toLocaleString("es-CO")}` : "");

// ───────────── Página del calendario (la que está montando José) ─────────────
// La página es un bloque "adviento-product" de VTEX que muestra un producto del catálogo.
// Hoy (9-nov-2026) está configurada con el producto 1047, que todavía NO es público:
// por eso se ve "COMPRAR AHORA" pero sin precio ni carrito. Cuando lo activen,
// el catálogo lo devolverá con precio y stock, y ahí ya se puede comprar.
const PAGINA = `${TIENDA}/calendario-de-adviento`;
const PRECIO_ESPERADO = 200000;

// Cómo estaba la página el 9-nov-2026. Si algo de esto cambia, avisa "👀 la página cambió".
const PAGINA_BASE = {
  productos: ["1047"],
  hideCountdown: true,
  countdownText: "El Calendario de Adviento estará disponible muy pronto.",
};

// Lee la configuración de los bloques "adviento-product" dentro del HTML de la página.
function leerPagina(html) {
  const productos = new Set();
  let hideCountdown = null, countdownText = null;
  const marca = "adviento-product\"]";
  for (let i = html.indexOf(marca); i !== -1; i = html.indexOf(marca, i + 1)) {
    const tramo = html.slice(i, i + 3000);
    const json = nombre => {
      const m = tramo.match(new RegExp(`"${nombre}":(\\{[^{}]*\\})`));
      try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
    };
    // "content" es lo que José configuró en el CMS; "props" es el valor por defecto del código
    const cfg = { ...(json("props") || {}), ...(json("content") || {}) };
    if (cfg.productId) productos.add(String(cfg.productId));
    if ("hideCountdown" in cfg) hideCountdown = cfg.hideCountdown;
    if (cfg.countdownText) countdownText = cfg.countdownText;
  }
  return { productos: [...productos], hideCountdown, countdownText };
}

async function productoPorId(id) {
  const r = await fetch(`${TIENDA}/api/catalog_system/pub/products/search?fq=productId:${id}`, {
    headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000),
  });
  const p = productosVtex(await r.json())?.[0];
  if (!p) return { id, publico: false };
  return { ...p, publico: true, comprable: Number(p.stock) > 0 && Number(p.precio) > 0, prueba: /prueba/i.test(p.nombre) };
}

async function revisarPagina() {
  try {
    const r = await fetch(PAGINA, {
      headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9" }, signal: AbortSignal.timeout(8000),
    });
    const html = await r.text();
    const config = leerPagina(html);
    const productos = (await Promise.all(config.productos.map(productoPorId))).filter(p => !p.prueba);

    const cambios = [];
    if (r.status !== 200) cambios.push(`la página respondió ${r.status}`);
    else if (!config.productos.length) cambios.push("ya no encuentro el bloque del producto en la página");
    else {
      if (config.productos.join() !== PAGINA_BASE.productos.join())
        cambios.push(`el producto de la página cambió: ${PAGINA_BASE.productos.join(", ")} → ${config.productos.join(", ")}`);
      if (config.hideCountdown !== PAGINA_BASE.hideCountdown)
        cambios.push(config.hideCountdown ? "ocultaron la cuenta regresiva" : "activaron la cuenta regresiva ⏳");
      if (config.countdownText !== PAGINA_BASE.countdownText)
        cambios.push(`nuevo texto: "${config.countdownText ?? "(sin texto)"}"`);
    }

    const comprables = productos.filter(p => p.comprable);
    const visibles = productos.filter(p => p.publico && !p.comprable);
    const estado = comprables.length ? "comprable" : visibles.length ? "visible" : cambios.length ? "cambio" : "igual";
    return { url: PAGINA, status: r.status, estado, config, productos, cambios };
  } catch (e) {
    return { url: PAGINA, status: 0, estado: "error", error: String(e), productos: [], cambios: [] };
  }
}

function mensajePagina(p) {
  const prod = x => `🛍️ ${x.nombre} ${precioCOP(x.precio)}${x.stock ? ` (stock: ${x.stock})` : ""}` +
    (typeof x.precio === "number" && x.precio !== PRECIO_ESPERADO ? `\n⚠️ Ojo: el precio esperado era ${precioCOP(PRECIO_ESPERADO)}` : "");
  if (p.estado === "comprable")
    return `🚨🎁 ¡YA SE PUEDE COMPRAR EL CALENDARIO EN LA PÁGINA!\n\n${p.productos.filter(x => x.comprable).map(prod).join("\n")}\n\n👉 ${PAGINA}`;
  if (p.estado === "visible")
    return `👀 El producto del calendario ya es público, pero todavía sin stock / sin precio:\n\n${p.productos.filter(x => x.publico).map(prod).join("\n")}\n\n👉 ${PAGINA}`;
  if (p.estado === "cambio")
    return `👀 La página del calendario cambió:\n• ${p.cambios.join("\n• ")}\n\n👉 ${PAGINA}`;
  return null;
}

export default async function handler(req, res) {
  // Solo quien tenga la clave (el cron) puede hacer que se envíen mensajes a Telegram
  const autorizado = Boolean(process.env.SECRET_KEY) && req.query.key === process.env.SECRET_KEY;
  if (req.query.key && !autorizado) {
    return res.status(401).json({ error: "clave incorrecta" });
  }

  const keywords = [...new Set(lista(process.env.KEYWORDS, DEFAULT_KEYWORDS).map(normal))];
  const ignorar = lista(process.env.IGNORAR, DEFAULT_IGNORAR).map(normal);
  const urls = process.env.TARGET_URL ? lista(process.env.TARGET_URL) : keywords.map(urlBusqueda);

  try {
    const [pagina, ...resultados] = await Promise.all([revisarPagina(), ...urls.map(u => revisar(u, keywords, ignorar))]);
    const conHallazgos = resultados.filter(r => r.encontradas.length);

    // "Ya se puede comprar" avisa cada minuto. Los cambios menores, cada 5 minutos, para no llenar el chat.
    const textoPagina = mensajePagina(pagina);
    const minuto = new Date().getUTCMinutes();
    if (autorizado && textoPagina && (pagina.estado === "comprable" || minuto % 5 === 0)) {
      await telegram(textoPagina);
    }

    if (autorizado && conHallazgos.length) {
      // Avisa en cada revisión (cada minuto) hasta pausar el cron
      const vistos = new Set();
      const lineas = [];
      for (const r of conHallazgos) {
        if (!r.productos) { lineas.push(`Encontré: ${r.encontradas.join(", ")}\n👉 ${r.url}`); continue; }
        for (const p of r.productos) {
          if (vistos.has(p.link)) continue;
          vistos.add(p.link);
          lineas.push(`🛍️ ${p.nombre} ${precioCOP(p.precio)}${p.stock ? ` (stock: ${p.stock})` : ""}\n👉 ${p.link}`);
        }
      }
      await telegram(`🎁🎄 ¡YA SALIÓ LA PREVENTA DEL CALENDARIO DE ADVIENTO!\n\n${lineas.join("\n\n")}`);
    }

    if (autorizado && req.query.test) {
      const estado = resultados.map(r => {
        const nombre = r.tipo === "catalogo" ? `"${new URL(r.url).searchParams.get("ft")}"` : r.url;
        return `• ${nombre} → ${r.error ? `error: ${r.error}` : `status ${r.status}, ${r.encontradas.length ? "¡ENCONTRADO!" : "nada"}`}`;
      }).join("\n");
      const resumenPagina = pagina.error ? `error: ${pagina.error}`
        : `status ${pagina.status}, producto ${pagina.config.productos.join(", ") || "?"}, estado: ${pagina.estado}`;
      await telegram(`✅ Prueba OK: el monitor está conectado.\n\n${estado}\n\n📄 Página del calendario → ${resumenPagina}`);
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, alertas: autorizado, hora: new Date().toISOString(), keywords, ignorar, pagina, resultados });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
