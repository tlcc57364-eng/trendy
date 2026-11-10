// Servidor local que imita a Vercel: sirve public/, /api/check y /api/ame.
//   npm run dev   ->   abre http://localhost:3000 (Trendy) o http://localhost:3000/ame (AME)
import http from "node:http";
import { readFile } from "node:fs/promises";
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

  const pagina = { "/": "index.html", "/index.html": "index.html", "/ame": "ame.html", "/ame.html": "ame.html" }[url.pathname];
  if (pagina) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(await readFile(new URL(`../public/${pagina}`, import.meta.url)));
  }

  res.statusCode = 404;
  res.end("No encontrado");
}).listen(PORT, () => console.log(`Monitor local en http://localhost:${PORT}`));
