// Servidor local que imita a Vercel: sirve public/ y /api/check.
//   npm run dev   ->   abre http://localhost:3000
import http from "node:http";
import { readFile } from "node:fs/promises";
import handler from "../api/check.js";

const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/check") {
    const vreq = { query: Object.fromEntries(url.searchParams) };
    const vres = {
      setHeader: (k, v) => res.setHeader(k, v),
      status(code) { res.statusCode = code; return this; },
      json(body) { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); },
    };
    return handler(vreq, vres);
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(await readFile(new URL("../public/index.html", import.meta.url)));
  }

  res.statusCode = 404;
  res.end("No encontrado");
}).listen(PORT, () => console.log(`Monitor local en http://localhost:${PORT}`));
