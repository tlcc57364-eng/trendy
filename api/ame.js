// Vercel Serverless Function: monitor de la caja de AME Cosméticos (ame.com.co, tienda Shopify)
//   /api/ame            -> pública: revisa la tienda una vez y devuelve el estado (la usa la página /ame, NO avisa)
//   /api/ame?key=CLAVE  -> la llama cron-job.org cada minuto: revisa durante ~25 s (cada ~7 s) y AVISA por Telegram
//   &test=1             -> además envía un mensaje de prueba a Telegram
//
// Usa las mismas variables de entorno que el monitor de Trendy: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, SECRET_KEY.
// Opcionales:
//   AME_KEYWORDS  palabras que indican que es "la caja" (separadas por coma)
//   AME_IGNORAR   IDs de productos o handles de colecciones nuevos que ya no deben avisar (separados por coma)
//
// Lección de Trendy (10-nov-2026): el aviso que de verdad sirvió fue el de STOCK (10:05 a. m.),
// 10 minutos antes de que la tienda lo anunciara en redes. Por eso aquí el stock manda:
//   🚨📦 HAY STOCK   -> la caja está disponible: cuántas quedan + link que la deja ya en el carrito
//   👀 sin stock     -> publicaron la caja pero todavía no se puede comprar
//   👀 novedad       -> producto/colección nueva o la portada habla de la caja
//
// Qué se vigila:
//   rápido (cada ~7 s): /products.json y la colección Mystery Box (hoy tiene 4 productos OCULTOS)
//   completo (1 vez por minuto): además /collections.json y la portada
//
// Stock: Shopify no publica cantidades, pero al pedir 99.999 unidades en /cart/add.js responde
// "solo se añadieron N artículos". Se pide en un carrito desechable (no reserva nada) y solo cuando
// un producto nuevo ya está disponible. Shopify bloquea a curl con 429, pero no al fetch de Node.

const TIENDA = "https://ame.com.co";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const DEFAULT_KEYWORDS = "caja,box,mystery,misteri,sorpresa,preventa,pre-venta,navidad,navideñ,regalo,50 primer,primeros 50,solo paga";

// Si un producto nuevo vale esto o menos, probablemente es la oferta de "solo pagas el envío".
const PRECIO_SOLO_ENVIO = 5000;

// Ritmo de la revisión rápida dentro de cada llamada del cron (cron-job.org corta a los 30 s).
const VENTANA_MS = 25000;
const PAUSA_MS = 7000;

// ── Cómo estaba la tienda el 10-nov-2026 ──
const PRODUCTOS_BASE = new Set(("9857105756442,10463232393498,10352659857690,10343627161882,10343568212250,10279298007322," +
  "10267685716250,9459320357146,9579700224282,9668687462682,9710072037658,9859396927770,10062001897754,9899775623450," +
  "10020178231578,9720336417050,9985967751450,9985969127706,5290178805917,9720297488666,9709870809370,9655219159322," +
  "5289985409181,9604596334874,9589192917274,9519763849498,9359154577690,9259517608218,6845504946333,8879445770522," +
  "8923926069530,8242596806938,6603034624157,8037364236570,5290096459933,8242447221018,8242399609114,7558814695581," +
  "7436887687325,7136508739741,6684498591901,5935183102109,5901132431517,5290179920029,5290176872605,5290172252317," +
  "5290161799325,5290149052573,5290120806557,5290017357981,5282715336861").split(","));

const COLECCIONES_BASE = new Set(("aceites,aguas-micelares,bases,compactas,liquidas,best-sellers-oct-2025,bestseller,cejas," +
  "combos,contorno-liquido,contornos,correctores-1,cremosos,delineador-en-gel,delineadores,liquidos,retractiles," +
  "descuento-expobelleza,descuentos,desmaquillantes,makeupesenciales-ame,esenciales-skincare," +
  "estilizador-de-cejas-gel-on-fleek,fijador-de-maquillaje,fijadores-1,gloss,iluminadores-1,kits-black-days," +
  "labiales-barra,labiales-liquidos,labios,lanzamientos,larga-duracion,lips-season,metalicos,mystery-box,ojos,packs," +
  "pestaninas,polvos-1,compactos,sueltos,pomada,primers,prueba-fotos,frontpage,rostro,rubor-en-crema,rubor-liquido," +
  "rubores-1,cuidado-facial,sombras,sombras-cejas,sombras-ojos,serums,tintas,todos-los-productos," +
  "todos-los-productos-1,trasnochon-20,trasnochon-25,ultra-soft,up-collection,kits-navidenos,ver-todo").split(","));

const MYSTERY = "mystery-box";
const MYSTERY_OCULTOS_BASE = 4;

// ── utilidades ──
const lista = (valor, porDefecto = "") => (valor || porDefecto).split(",").map(s => s.trim()).filter(Boolean);
const normal = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const precioCOP = n => (Number.isFinite(n) ? `$${n.toLocaleString("es-CO")}` : "");
const esperar = ms => new Promise(r => setTimeout(r, ms));
const HEADERS = { "User-Agent": UA, "Accept": "text/html,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "es-CO,es;q=0.9" };

async function traer(ruta, comoJson = true) {
  const r = await fetch(TIENDA + ruta, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${ruta} respondió ${r.status}`);
  return comoJson ? r.json() : r.text();
}

async function telegram(text) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`Telegram respondió ${r.status}: ${await r.text()}`);
}

function producto(p, keywords) {
  const variantes = p.variants || [];
  const disponible = variantes.find(v => v.available);
  const precio = Math.min(...variantes.map(v => Number(v.price)));
  const texto = normal([p.title, p.handle, p.product_type, ...(p.tags || [])].join(" "));
  const variante = (disponible || variantes[0])?.id;
  return {
    id: String(p.id),
    nombre: p.title,
    precio,
    disponible: Boolean(disponible),
    link: `${TIENDA}/products/${p.handle}`,
    // /cart/VARIANTE:1 lleva directo al pago con el producto ya en el carrito
    compraDirecta: variante ? `${TIENDA}/cart/${variante}:1` : null,
    variante,
    esCaja: keywords.some(k => texto.includes(k)),
    soloEnvio: precio <= PRECIO_SOLO_ENVIO,
  };
}

// Cuántas unidades quedan: null = no se pudo saber, Infinity = la tienda no lleva la cuenta.
async function stock(variante) {
  try {
    const r = await fetch(`${TIENDA}/cart/add.js`, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ items: [{ id: variante, quantity: 99999 }] }),
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) return Infinity;
    const { description = "", message = "" } = await r.json().catch(() => ({}));
    const texto = `${description} ${message}`;
    if (/agotad|sold out|no disponible/i.test(texto)) return 0;
    const n = texto.match(/(\d[\d.]*)\s*(art[ií]culo|unidad|item)/i) || texto.match(/(\d[\d.]*)/);
    return n ? Number(n[1].replace(/\./g, "")) : null;
  } catch { return null; }
}

// Cada revisión devuelve { nombre, ok, hallazgos: [...], error? } — si falla una, las demás siguen.
async function paso(nombre, fn) {
  try { return { nombre, ok: true, ...(await fn()) }; }
  catch (e) { return { nombre, ok: false, hallazgos: [], error: String(e.message || e) }; }
}

const revisarCatalogo = (keywords, ignorar) => paso("Catálogo", async () => {
  const { products } = await traer("/products.json?limit=250");
  const nuevos = products.filter(p => !PRODUCTOS_BASE.has(String(p.id)) && !ignorar.has(String(p.id)))
    .map(p => producto(p, keywords));
  return { total: products.length, hallazgos: nuevos };
});

const revisarMystery = keywords => paso("Mystery Box", async () => {
  const { products } = await traer(`/collections/${MYSTERY}/products.json`);
  return { hallazgos: products.map(p => ({ ...producto(p, keywords), esCaja: true })) };
});

const revisarColecciones = (keywords, ignorar) => paso("Colecciones", async () => {
  const { collections } = await traer("/collections.json?limit=250");
  const hallazgos = [];
  const mb = collections.find(c => c.handle === MYSTERY);
  if (!mb) hallazgos.push({ texto: "la colección Mystery Box ya no existe (¿la renombraron?)" });
  else if (mb.products_count !== MYSTERY_OCULTOS_BASE)
    hallazgos.push({ texto: `la Mystery Box ahora tiene ${mb.products_count} productos (antes ${MYSTERY_OCULTOS_BASE})`, link: `${TIENDA}/collections/${MYSTERY}` });
  for (const c of collections) {
    if (COLECCIONES_BASE.has(c.handle) || ignorar.has(c.handle)) continue;
    const esCaja = keywords.some(k => normal(`${c.title} ${c.handle}`).includes(k));
    hallazgos.push({ texto: `colección nueva: "${c.title}" (${c.products_count} productos)`, link: `${TIENDA}/collections/${c.handle}`, esCaja });
  }
  return { total: collections.length, mysteryOcultos: mb?.products_count, hallazgos };
});

const revisarPortada = keywords => paso("Portada", async () => {
  const html = await traer("/", false);
  const texto = normal(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " "));
  const encontradas = keywords.filter(k => texto.includes(k));
  return { encontradas, hallazgos: encontradas.length ? [{ texto: `la portada ahora dice: ${encontradas.join(", ")}`, link: TIENDA, esCaja: true }] : [] };
});

// Junta los pasos en un estado: "stock" (se puede comprar), "sin-stock" (publicada pero agotada), "novedad" o "igual".
async function evaluar(pasos) {
  const porNombre = Object.fromEntries(pasos.map(p => [p.nombre, p]));
  const productos = [...new Map([...(porNombre["Catálogo"]?.hallazgos || []), ...(porNombre["Mystery Box"]?.hallazgos || [])]
    .map(p => [p.id, p])).values()];
  const otros = [...(porNombre["Colecciones"]?.hallazgos || []), ...(porNombre["Portada"]?.hallazgos || [])];
  const caja = productos.filter(p => p.esCaja || p.soloEnvio);

  // Solo se pregunta el stock de la caja cuando ya está disponible (máximo 3 productos)
  await Promise.all(caja.filter(p => p.disponible && p.variante).slice(0, 3).map(async p => { p.stock = await stock(p.variante); }));

  const estado = caja.some(p => p.disponible && p.stock !== 0) ? "stock"
    : caja.length ? "sin-stock"
    : productos.length || otros.length ? "novedad" : "igual";
  return { estado, productos, otros, pasos };
}

const textoStock = s => s === Infinity ? "stock sin límite" : Number.isFinite(s) ? `quedan ${s.toLocaleString("es-CO")}` : "stock: ?";

function mensaje({ estado, productos, otros }) {
  const lineaProd = p => [
    `${p.esCaja ? "🎁" : "🛍️"} ${p.nombre} · ${precioCOP(p.precio)}`,
    p.disponible ? `📦 ${textoStock(p.stock)}` : "❌ todavía sin stock",
    p.soloEnvio ? "💸 precio de solo envío" : "",
    p.disponible && p.compraDirecta ? `🛒 COMPRA DIRECTA (ya queda en el carrito):\n${p.compraDirecta}` : `👉 ${p.link}`,
  ].filter(Boolean).join("\n");
  const titulo = {
    "stock": "🚨📦 ¡HAY STOCK DE LA CAJA DE AME! Solo los 50 primeros, ¡compra YA! 🏃‍♀️",
    "sin-stock": "👀 Publicaron la caja de AME, pero todavía sin stock. Atenta 👀",
    "novedad": "👀 Novedad en AME Cosméticos",
  }[estado];
  const ordenados = [...productos].sort((a, b) => (b.disponible - a.disponible) || (b.esCaja - a.esCaja));
  return [titulo, ...ordenados.map(lineaProd), ...otros.map(o => `• ${o.texto}${o.link ? `\n👉 ${o.link}` : ""}`)].join("\n\n");
}

export default async function handler(req, res) {
  const autorizado = Boolean(process.env.SECRET_KEY) && req.query.key === process.env.SECRET_KEY;
  if (req.query.key && !autorizado) return res.status(401).json({ error: "clave incorrecta" });

  const keywords = [...new Set(lista(process.env.AME_KEYWORDS, DEFAULT_KEYWORDS).map(normal))];
  const ignorar = new Set(lista(process.env.AME_IGNORAR));
  const inicio = Date.now();

  try {
    // 1) Revisión completa
    let r = await evaluar(await Promise.all([
      revisarCatalogo(keywords, ignorar), revisarMystery(keywords),
      revisarColecciones(keywords, ignorar), revisarPortada(keywords),
    ]));
    const completo = r;
    let revisiones = 1;

    if (autorizado) {
      if (r.estado !== "igual") await telegram(mensaje(r));

      // 2) Revisión rápida: mientras no haya stock, repetir cada ~7 s para enterarse antes que nadie.
      //    Si aparece stock, avisa al instante y termina (el próximo minuto vuelve a avisar).
      while (r.estado !== "stock" && Date.now() - inicio + PAUSA_MS < VENTANA_MS) {
        await esperar(PAUSA_MS);
        const rapido = await Promise.all([revisarCatalogo(keywords, ignorar), revisarMystery(keywords)]);
        revisiones++;
        if (rapido.some(p => !p.ok)) break; // si la tienda nos limita (429), no insistir
        const nuevo = await evaluar([...rapido, ...completo.pasos.slice(2)]);
        if (nuevo.estado === "stock") { r = nuevo; await telegram(mensaje(r)); }
      }

      if (req.query.test) {
        const resumen = completo.pasos.map(p => `• ${p.nombre} → ${p.ok ? (p.hallazgos.length ? `¡${p.hallazgos.length} novedad(es)!` : "sin novedad") : `error: ${p.error}`}`).join("\n");
        await telegram(`✅ Prueba OK: el monitor de AME está conectado.\n\n${resumen}\n\n⏱️ ${revisiones} revisiones en ${Math.round((Date.now() - inicio) / 1000)} s`);
      }
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true, alertas: autorizado, hora: new Date().toISOString(), revisiones,
      estado: r.estado, keywords, otros: r.otros, pasos: completo.pasos,
      productos: r.productos.map(p => ({ ...p, stock: p.stock === Infinity ? "sin límite" : p.stock })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
