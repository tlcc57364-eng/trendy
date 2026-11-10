// Servidor local que imita a Vercel: sirve public/, /api/check y /api/ame.
//   npm run dev   ->   abre http://localhost:3000 (inicio) · /trendy · /ame
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import handler from "../api/check.js";
import ame from "../api/ame.js";

const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  const api = { "/api/check": handler, "/api/ame": ame }[url.pathname];
  if (api) {
    const vreq = { query: Object.fromEntries(url.searchParams) };
    const vres = {
      setHeader: (k, v) => res.setHeader(k, v),
      status(code) { res.statusCode = code; return this; },
      json(body) { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); },
    };
    return api(vreq, vres);
  }

  // Archivos de public/ con URL limpias, como Vercel (cleanUrls): /ame -> public/ame.html
  const TIPOS = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  const ruta = url.pathname === "/" ? "/index.html" : extname(url.pathname) ? url.pathname : `${url.pathname}.html`;
  if (!ruta.includes("..") && TIPOS[extname(ruta)]) {
    try {
      const contenido = await readFile(new URL(`../public${ruta}`, import.meta.url));
      res.setHeader("Content-Type", TIPOS[extname(ruta)]);
      return res.end(contenido);
    } catch {}
  }

  res.statusCode = 404;
  res.end("No encontrado");
}).listen(PORT, () => console.log(`Monitor local en http://localhost:${PORT}`));
