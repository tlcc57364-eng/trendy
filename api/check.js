// Vercel Serverless Function
//   /api/check            -> pública: solo revisa la tienda y devuelve el estado (la usa la página, NO avisa)
//   /api/check?key=CLAVE  -> la llama cron-job.org cada minuto: revisa y, si encuentra algo, AVISA por Telegram
// Variables de entorno en Vercel (Settings > Environment Variables):
//   TARGET_URL        una o varias URLs separadas por coma (página HTML o /products.json de Shopify)
//   KEYWORDS          palabras clave separadas por coma
//   TELEGRAM_TOKEN    token del bot (@BotFather)
//   TELEGRAM_CHAT_ID  tu chat ID (@userinfobot)
//   SECRET_KEY        clave para que nadie más pueda llamar la función
//
// Parámetros opcionales:
//   &test=1  -> envía un mensaje de prueba a Telegram

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function lista(valor, porDefecto = "") {
  return (valor || porDefecto).split(",").map(s => s.trim()).filter(Boolean);
}

async function telegram(text) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: false }),
  });
  if (!r.ok) throw new Error(`Telegram respondió ${r.status}: ${await r.text()}`);
}

function limpiar(contenido) {
  return contenido
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function revisar(url, keywords) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9" },
      signal: AbortSignal.timeout(8000),
    });
    const texto = limpiar(await r.text());
    const encontradas = keywords.filter(k => texto.includes(k));
    return { url, status: r.status, encontradas };
  } catch (e) {
    return { url, status: 0, encontradas: [], error: String(e) };
  }
}

export default async function handler(req, res) {
  // Solo quien tenga la clave (el cron) puede hacer que se envíen mensajes a Telegram
  const autorizado = Boolean(process.env.SECRET_KEY) && req.query.key === process.env.SECRET_KEY;
  if (req.query.key && !autorizado) {
    return res.status(401).json({ error: "clave incorrecta" });
  }

  const urls = lista(process.env.TARGET_URL);
  const keywords = lista(process.env.KEYWORDS, "calendario,adviento,preventa").map(k => k.toLowerCase());

  if (!urls.length) {
    return res.status(500).json({ ok: false, error: "Falta la variable TARGET_URL" });
  }

  try {
    const resultados = await Promise.all(urls.map(u => revisar(u, keywords)));
    const conHallazgos = resultados.filter(r => r.encontradas.length);

    if (autorizado && conHallazgos.length) {
      // Avisa en cada revisión (cada minuto) hasta pausar el cron
      const detalle = conHallazgos
        .map(r => `Encontré: ${r.encontradas.join(", ")}\n👉 ${r.url}`)
        .join("\n\n");
      await telegram(`🎁🎄 ¡YA SALIÓ LA PREVENTA DEL CALENDARIO DE ADVIENTO!\n\n${detalle}`);
    }

    if (autorizado && req.query.test) {
      const estado = resultados.map(r => `• ${r.url} → status ${r.status}${r.error ? ` (error: ${r.error})` : ""}`).join("\n");
      await telegram(`✅ Prueba OK: el monitor está conectado.\n\n${estado}\nKeywords: ${keywords.join(", ")}`);
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, alertas: autorizado, hora: new Date().toISOString(), keywords, resultados });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
