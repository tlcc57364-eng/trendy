# Monitor de Preventa – Trendy Shop (Calendario de Adviento)

## 1. Objetivo

La tienda **Trendy Shop** abrirá la **preventa del calendario de adviento el martes**, pero no se sabe a qué hora.
Necesito un sistema que **revise la tienda automáticamente cada minuto, 24/7, sin tener el computador encendido**, y que me **avise al celular por Telegram** apenas aparezca el producto o la preventa, para poder comprarlo de inmediato.

> El sistema SOLO avisa. La compra la hago yo manualmente.

## 2. Arquitectura

```
cron-job.org (cada 1 min)
        │  GET /api/check?key=SECRET_KEY
        ▼
Vercel Serverless Function (api/check.js)
        │  1. Descarga TARGET_URL (página de Trendy Shop)
        │  2. Limpia el HTML y busca KEYWORDS
        ▼
Si encuentra alguna palabra clave → mensaje a Telegram (Bot API)
```

### ¿Por qué esta combinación?
- **Vercel (plan gratis)** aloja la función, pero su cron gratis corre como máximo **1 vez al día**, así que no sirve para revisar cada minuto.
- **cron-job.org** (gratis) llama a la URL de la función **cada minuto**. Así se logra el monitoreo constante.
- **Telegram** permite notificaciones push inmediatas al celular, gratis.

## 3. Estructura del repositorio

```
monitor-preventa/
├── api/
│   └── check.js        # Función serverless principal
├── public/
│   └── index.html      # Panel web: revisar ahora, enviar prueba, ver estado
├── package.json
├── .gitignore
└── README.md           # (este archivo puede servir de README)
```

## 4. Código

### `api/check.js`

```js
// Vercel Serverless Function: /api/check?key=TU_CLAVE
// Variables de entorno en Vercel (Settings > Environment Variables):
//   TARGET_URL, KEYWORDS (separadas por coma), TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, SECRET_KEY

async function telegram(text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
  });
}

export default async function handler(req, res) {
  // Evita que cualquiera dispare la función
  if (req.query.key !== process.env.SECRET_KEY) {
    return res.status(401).json({ error: "clave incorrecta" });
  }

  const url = process.env.TARGET_URL;
  const keywords = (process.env.KEYWORDS || "calendario,adviento,preventa")
    .split(",").map(k => k.trim().toLowerCase()).filter(Boolean);

  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36" },
    });
    const html = await r.text();
    const texto = html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .toLowerCase();

    const encontradas = keywords.filter(k => texto.includes(k));

    if (encontradas.length) {
      // Avisa en cada revisión (cada minuto) hasta pausar el cron
      await telegram(`🚨 ¡YA SALIÓ! Encontré: ${encontradas.join(", ")}\n👉 ${url}`);
    }

    // Prueba: /api/check?key=TU_CLAVE&test=1
    if (req.query.test) await telegram("✅ Prueba OK: el monitor está conectado.");

    return res.status(200).json({ ok: true, status: r.status, encontradas, hora: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
```

### `package.json`

```json
{
  "name": "monitor-preventa",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" }
}
```

### `.gitignore`

```
node_modules
.env
.vercel
```

## 5. Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Ejemplo | Descripción |
|---|---|---|
| `TARGET_URL` | *(opcional, dejar vacía)* | Si no se define, se vigila el **catálogo VTEX** de maquillajetrendyshop.com buscando "calendario" y "adviento". Solo mira nombres de productos, así el menú ("Términos Calendario 2026") no da falsas alarmas |
| `KEYWORDS` | *(opcional, dejar vacía)* | Por defecto: calendario, adviento, advent, preventa, wonderland, luxury, baul, vinotinto (calendario Luxury "Wonderland", baúl vinotinto). Sin importar tildes |
| `IGNORAR` | *(opcional)* | Productos que ya existen y no deben avisar. Por defecto: Iluminador Wonderland Glow, Kit Brochas Marmol Luxury, Baúl Mediano Negro |
| `TELEGRAM_TOKEN` | `123456:ABC-...` | Token del bot, lo da @BotFather |
| `TELEGRAM_CHAT_ID` | `987654321` | Mi ID de Telegram, lo da @userinfobot |
| `SECRET_KEY` | `algo-largo-y-secreto` | Clave para que nadie más pueda llamar la función |

⚠️ Nunca subir tokens al repositorio. Solo van en las variables de entorno de Vercel.

## 6. Pasos de configuración

### Telegram
1. Abrir **@BotFather**, escribir `/newbot` y guardar el **token**.
2. Abrir **@userinfobot** y guardar el **chat ID**.
3. Escribirle "hola" al bot nuevo (sin esto, el bot no puede enviarme mensajes).

### Vercel
1. Subir el proyecto a GitHub.
2. En Vercel: **Add New → Project**, importar el repo y hacer Deploy.
3. Agregar las variables de entorno y hacer **Redeploy**.
4. Probar en el navegador: `https://<proyecto>.vercel.app/api/check?key=<SECRET_KEY>&test=1`
   → debe llegar "✅ Prueba OK" a Telegram, y la respuesta JSON debe mostrar `status: 200`.

### cron-job.org
1. Crear una cuenta gratis.
2. Crear un cron job con la URL `https://<proyecto>.vercel.app/api/check?key=<SECRET_KEY>`, programado **cada 1 minuto**.
3. Activarlo desde el lunes en la noche.
4. Cuando llegue la alerta y se haya comprado el calendario, **pausar el cron**.

## 7. Verificaciones importantes antes del martes

- [ ] **¿La tienda carga los productos con JavaScript?** Abrir la URL de `/api/check` y revisar el JSON. Otra forma: en el navegador, usar "Ver código fuente" y buscar nombres de productos. Si los productos NO aparecen en el HTML, la función no los "verá". En ese caso:
  - Revisar si la tienda es **Shopify**. Si lo es, usar `https://<tienda>/products.json`, que trae todos los productos en JSON, y buscar las keywords ahí.
  - Si usa otra plataforma (WooCommerce, VTEX, etc.), buscar su endpoint de productos en la pestaña **Network** de DevTools.
- [ ] **Falsos positivos:** si la palabra "adviento" o "calendario" ya existe en la página (en el menú o un banner, por ejemplo), la alerta saltaría de inmediato. Ajustar `KEYWORDS` a algo más específico (por ejemplo, el nombre exacto del producto) o cambiar `TARGET_URL` a la página de la colección.
- [ ] Confirmar que la respuesta tenga `status: 200` y no 403. Un 403 significa que la tienda bloquea la petición.
- [ ] Hacer la prueba de Telegram con `&test=1`.

## 8. Mejoras opcionales (si da tiempo)

1. **Detectar cualquier cambio en la página**, no solo palabras clave. Para esto hay que guardar un hash del contenido entre ejecuciones, usando **Upstash Redis** (gratis, se integra con Vercel). Si el hash cambia, avisar con "👀 La página cambió".
2. **Detectar productos nuevos:** con Shopify `products.json`, guardar la lista de IDs y avisar cuando aparezca uno nuevo, con nombre, precio y link directo.
3. **Dejar de avisar automáticamente** después de N alertas, guardando un flag en Redis.
4. **Monitorear varias URLs** con `TARGET_URL` como una lista separada por comas.

## 9. Instagram y TikTok (fuera del alcance del código)

La tienda anunciará la hora de la preventa en Instagram y TikTok. **No se automatiza por código** por tres razones: ambas plataformas bloquean servidores, las historias requieren sesión iniciada, y hay riesgo de bloqueo de cuenta.
La solución es usar las notificaciones nativas:
- **Instagram:** en el perfil de Trendy Shop, tocar la campanita 🔔 y activar Publicaciones, Historias, Reels y En vivo.
- **TikTok:** en el perfil, tocar la campanita 🔔 y activar los avisos de videos y lives.

## 10. Checklist del día de la preventa

- [ ] Sesión iniciada en Trendy Shop, con dirección y método de pago guardados.
- [ ] Sonido personalizado y sin silencio para el chat del bot en Telegram.
- [ ] Cron activo en cron-job.org (revisar el historial de ejecuciones).
- [ ] Notificaciones de Instagram y TikTok activas.
- [ ] Celular cargado 🔋

## 11. Cómo funciona sin clave y sin tener nada abierto

- **La página** (`https://<proyecto>.vercel.app/`) es pública y **no pide clave**: al abrirla revisa la tienda y se actualiza sola cada minuto. Solo muestra el estado; **nunca envía mensajes**.
- **Las alertas** las dispara **cron-job.org**, que llama cada minuto a `/api/check?key=<SECRET_KEY>`. Esa llamada ocurre en internet, entre cron-job.org y Vercel, así que **funciona 24/7 con el computador apagado y la página cerrada**. La clave solo se pone una vez, al crear el cron.

## 12. Probar en el computador

1. Copiar `.env.example` como `.env` y llenar los valores reales (sobre todo `TARGET_URL`).
2. `npm run dev` y abrir **http://localhost:3000**. Abrir `index.html` con doble clic NO funciona: necesita el servidor.
3. `npm run local:test` → envía el mensaje "✅ Prueba OK" a Telegram.

> `TARGET_URL` acepta varias URLs separadas por coma (por ejemplo, la página de novedades y `/products.json` si la tienda es Shopify).

## 13. Vigilancia de la página del calendario (desde el 9-nov-2026)

Además del catálogo, el monitor revisa cada minuto **https://www.maquillajetrendyshop.com/calendario-de-adviento**.

- La página es un bloque `adviento-product` de VTEX configurado con el **producto 1047**, que todavía no es público. Por eso se ve "COMPRAR AHORA" pero sin precio ni carrito. (El 1016 que aparece en el código es una "Unidad De Prueba Ecommerce" y se ignora).
- El monitor lee qué producto tiene la página y lo busca en el catálogo (`fq=productId:<id>`):

| Estado | Qué significa | Aviso a Telegram |
|---|---|---|
| `comprable` | El producto tiene precio y stock → ya sale el carrito | 🚨 **cada minuto** |
| `visible` | El producto ya es público pero sin stock o sin precio | 👀 **cada minuto** |
| `cambio` | Cambió el producto, la cuenta regresiva o su texto, o la página no responde | 👀 **cada minuto** |
| `igual` | Como estaba el 9-nov | nada |

- Si el precio no es $200.000, el aviso lo indica.
- Si José cambia algo a propósito y ya no se quiere el aviso de "cambio", actualizar `PAGINA_BASE` en `api/check.js`.

## Sitio (diseño de DESIGN.md: negro, bordes finos, acento violeta)

| Ruta | Qué es |
|---|---|
| `/` | Portada: caja 3D (three.js r128), estado en vivo de AME y la lección de Trendy |
| `/trendy` | "¡Lo logramos!": confeti y línea de tiempo de la compra (10-nov-2026) |
| `/ame` | Monitor en vivo de AME: stock, link de compra directa, sonido y notificación del navegador, checklist |

Estilos en `public/styles.css`, comportamiento en `public/app.js`. `vercel.json` activa URL limpias (`/ame` en vez de `/ame.html`) y le da 30 s a `api/ame.js`.
Para probarlo local: `npm run dev` y abre http://localhost:3000.

## Monitor de AME Cosméticos (ame.com.co)

La caja para los **50 primeros**, que solo pagan el envío.

- **cron-job.org:** un job **cada 1 minuto** con `https://<proyecto>.vercel.app/api/ame?key=<SECRET_KEY>`. El de Trendy, pausado.
- **Prueba:** `/api/ame?key=<SECRET_KEY>&test=1`, o en el computador `npm run ame` / `npm run ame:test`.

**Lección de Trendy:** el aviso que sirvió fue el de **stock** (10:05), 10 minutos antes que las redes (10:15). Por eso:

- En cada llamada del cron, el monitor revisa **cada ~7 s durante ~25 s** (cron-job.org corta a los 30 s). Si aparece stock, avisa en ese instante.
- **Stock exacto:** Shopify no lo publica, pero `/cart/add.js` con 99.999 unidades responde "solo se añadieron N artículos". Se consulta solo cuando la caja ya está disponible, en un carrito desechable que no reserva nada.
- **Compra directa:** `https://ame.com.co/cart/<variante>:1` deja la caja en el carrito y lleva directo a pagar.

| Aviso | Cuándo |
|---|---|
| 🚨📦 ¡HAY STOCK! | la caja (por palabras clave, por venir de la Mystery Box o por costar ≤ $5.000) está disponible, con cuántas quedan y el link de compra |
| 👀 Publicaron la caja, sin stock | ya es visible, pero todavía agotada |
| 👀 Novedad | producto nuevo, colección nueva, cambios en la Mystery Box o palabras clave en la portada |

Qué se mira: `/products.json` (51 productos al 10-nov-2026), la colección `mystery-box` (4 productos ocultos), `/collections.json` (64) y la portada.
Los avisos se repiten cada minuto mientras dure la novedad. Para callar algo que no interesa, pon su ID o handle en `AME_IGNORAR` y haz Redeploy.
Shopify responde 429 a `curl`, pero no al `fetch` de Node, que es el que usa Vercel.
