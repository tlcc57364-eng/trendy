// Vercel Serverless Function: monitor de la caja de AME Cosméticos (ame.com.co, tienda Shopify)
//   /api/ame            -> pública: solo revisa la tienda y devuelve el estado (la usa la página ame.html, NO avisa)
//   /api/ame?key=CLAVE  -> la llama cron-job.org cada minuto: revisa y, si hay novedad, AVISA por Telegram
//   &test=1             -> además envía un mensaje de prueba a Telegram
//
// Usa las mismas variables de entorno que el monitor de Trendy: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, SECRET_KEY.
// Opcionales:
//   AME_KEYWORDS  palabras que indican que es "la caja" (separadas por coma)
//   AME_IGNORAR   IDs de productos o handles de colecciones nuevos que ya no deben avisar (separados por coma)
//
// Qué se vigila (4 peticiones por revisión):
//   1. /products.json            catálogo público: avisa si aparece un producto que no estaba el 10-nov-2026
//   2. colección Mystery Box     hoy tiene 4 productos OCULTOS; avisa en cuanto alguno se publique
//   3. /collections.json         avisa si sale una colección nueva o si cambia la cantidad de la Mystery Box
//   4. la portada                avisa si aparecen palabras como "caja", "preventa", "mystery box"
//
// Ojo: Shopify bloquea a curl con 429, pero responde bien al fetch de Node (el que usa Vercel).

const TIENDA = "https://ame.com.co";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const DEFAULT_KEYWORDS = "caja,box,mystery,misteri,sorpresa,preventa,pre-venta,navidad,navideñ,regalo,50 primer,primeros 50,solo paga";

// Si un producto nuevo vale esto o menos, probablemente es la oferta de "solo pagas el envío".
const PRECIO_SOLO_ENVIO = 5000;

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

async function traer(ruta, comoJson = true) {
  const r = await fetch(TIENDA + ruta, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "es-CO,es;q=0.9" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`${ruta} respondió ${r.status}`);
  return comoJson ? r.json() : r.text();
}

async function telegram(text) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
  });
  if (!r.ok) throw new Error(`Telegram respondió ${r.status}: ${await r.text()}`);
}

function producto(p, keywords) {
  const precio = Math.min(...p.variants.map(v => Number(v.price)));
  const texto = normal([p.title, p.handle, p.product_type, ...(p.tags || [])].join(" "));
  return {
    id: String(p.id),
    nombre: p.title,
    precio,
    disponible: p.variants.some(v => v.available),
    link: `${TIENDA}/products/${p.handle}`,
    esCaja: keywords.some(k => texto.includes(k)),
    soloEnvio: precio <= PRECIO_SOLO_ENVIO,
  };
}

// Cada revisión devuelve { nombre, ok, hallazgos: [...], error? } — si falla una, las demás siguen.
async function paso(nombre, fn) {
  try { return { nombre, ok: true, ...(await fn()) }; }
  catch (e) { return { nombre, ok: false, hallazgos: [], error: String(e.message || e) }; }
}

export default async function handler(req, res) {
  const autorizado = Boolean(process.env.SECRET_KEY) && req.query.key === process.env.SECRET_KEY;
  if (req.query.key && !autorizado) return res.status(401).json({ error: "clave incorrecta" });

  const keywords = [...new Set(lista(process.env.AME_KEYWORDS, DEFAULT_KEYWORDS).map(normal))];
  const ignorar = new Set(lista(process.env.AME_IGNORAR));

  const [catalogo, mystery, colecciones, portada] = await Promise.all([
    paso("Catálogo", async () => {
      const { products } = await traer("/products.json?limit=250");
      const nuevos = products.filter(p => !PRODUCTOS_BASE.has(String(p.id)) && !ignorar.has(String(p.id)))
        .map(p => producto(p, keywords));
      return { total: products.length, hallazgos: nuevos };
    }),
    paso("Mystery Box", async () => {
      const { products } = await traer(`/collections/${MYSTERY}/products.json`);
      return { hallazgos: products.map(p => ({ ...producto(p, keywords), esCaja: true })) };
    }),
    paso("Colecciones", async () => {
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
    }),
    paso("Portada", async () => {
      const html = await traer("/", false);
      const texto = normal(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " "));
      const encontradas = keywords.filter(k => texto.includes(k));
      return { encontradas, hallazgos: encontradas.length ? [{ texto: `la portada ahora dice: ${encontradas.join(", ")}`, link: TIENDA, esCaja: true }] : [] };
    }),
  ]);

  const pasos = [catalogo, mystery, colecciones, portada];
  const productos = [...new Map([...catalogo.hallazgos, ...mystery.hallazgos].map(p => [p.id, p])).values()];
  const otros = [...colecciones.hallazgos, ...portada.hallazgos];

  // comprable: la caja (o algo "solo envío") ya está a la venta · novedad: algo cambió · igual: nada nuevo
  const comprables = productos.filter(p => p.disponible && (p.esCaja || p.soloEnvio));
  const estado = comprables.length ? "comprable" : productos.length || otros.length ? "novedad" : "igual";

  try {
    if (autorizado && estado !== "igual") {
      const lineaProd = p => `${p.esCaja ? "🎁" : "🛍️"} ${p.nombre} ${precioCOP(p.precio)} ${p.disponible ? "✅ disponible" : "❌ agotado"}` +
        `${p.soloEnvio ? "\n💸 ¡Precio de solo envío!" : ""}\n👉 ${p.link}`;
      const partes = [
        estado === "comprable" ? "🚨🎁 ¡YA SE PUEDE COMPRAR LA CAJA DE AME! Corre, solo los 50 primeros 🏃‍♀️" : "👀 Novedad en AME Cosméticos",
        ...productos.map(lineaProd),
        ...otros.map(o => `• ${o.texto}${o.link ? `\n👉 ${o.link}` : ""}`),
      ];
      // Avisa en cada revisión (cada minuto) mientras dure la novedad. Para callar algo: AME_IGNORAR o pausar el cron.
      await telegram(partes.join("\n\n"));
    }
    if (autorizado && req.query.test) {
      const resumen = pasos.map(p => `• ${p.nombre} → ${p.ok ? (p.hallazgos.length ? `¡${p.hallazgos.length} novedad(es)!` : "sin novedad") : `error: ${p.error}`}`).join("\n");
      await telegram(`✅ Prueba OK: el monitor de AME está conectado.\n\n${resumen}`);
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, alertas: autorizado, hora: new Date().toISOString(), estado, keywords, productos, otros, pasos });
}
