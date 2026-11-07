// Prueba la función en tu computador sin desplegar.
//   npm run local       -> revisa la tienda y muestra el resultado
//   npm run local:test  -> además envía el mensaje de prueba a Telegram
import handler from "../api/check.js";

const req = {
  query: { key: process.env.SECRET_KEY, ...(process.argv.includes("--test") ? { test: "1" } : {}) },
};
const res = {
  status(code) { this.code = code; return this; },
  json(body) { console.log(`HTTP ${this.code}`); console.log(JSON.stringify(body, null, 2)); },
};

await handler(req, res);
