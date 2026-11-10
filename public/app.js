// Monitor de Preventas — comportamiento compartido: navegación, animaciones de entrada, caja 3D y confeti.

const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Borde de la barra al hacer scroll
const nav = document.querySelector(".nav");
if (nav) {
  const marcar = () => nav.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", marcar, { passive: true });
  marcar();
}

// Aparición suave de las secciones
const io = new IntersectionObserver(entradas => {
  for (const e of entradas) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}, { rootMargin: "0px 0px -8% 0px" });
document.querySelectorAll(".reveal").forEach(el => io.observe(el));

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const cop = n => (Number.isFinite(n) ? "$" + n.toLocaleString("es-CO") : "");
export const horaCorta = iso => new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", second: "2-digit" });

/**
 * Caja de regalo negra en WebGL (three.js r128 cargado como global THREE).
 * opciones.abierta: la tapa flota abierta (página de "¡Logrado!")
 */
export function caja3D(canvas, { abierta = false } = {}) {
  const THREE = window.THREE;
  if (!THREE || !canvas) return;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
  catch { canvas.classList.add("hidden"); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camara.position.set(0, 1.1, 8.2);
  camara.lookAt(0, 0.1, 0);

  // Luz: clave blanca arriba a la izquierda, contraluz violeta muy tenue
  escena.add(new THREE.AmbientLight(0xffffff, 0.12));
  const clave = new THREE.DirectionalLight(0xffffff, 1.5); clave.position.set(-4, 6, 5); escena.add(clave);
  const relleno = new THREE.DirectionalLight(0x9aa6b2, 0.35); relleno.position.set(5, 1, 3); escena.add(relleno);
  const contra = new THREE.PointLight(0x9281f7, 1.4, 14); contra.position.set(2.5, 2, -4); escena.add(contra);

  const negro = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.32, metalness: 0.75 });
  const cinta = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.22, metalness: 0.9 });
  const borde = new THREE.LineBasicMaterial({ color: 0x3b4045, transparent: true, opacity: 0.9 });
  const bordeVioleta = new THREE.LineBasicMaterial({ color: 0xbaa7ff, transparent: true, opacity: 0.35 });

  const pieza = (w, h, d, mat, lineas = borde) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), lineas));
    return m;
  };

  const regalo = new THREE.Group();
  const S = 1.9, H = 1.45, L = 0.34;
  const cuerpo = pieza(S, H, S, negro); cuerpo.position.y = -0.2; regalo.add(cuerpo);
  const cintaA = pieza(0.26, H + 0.004, S + 0.01, cinta, bordeVioleta); cintaA.position.y = -0.2; regalo.add(cintaA);
  const cintaB = pieza(S + 0.01, H + 0.004, 0.26, cinta, bordeVioleta); cintaB.position.y = -0.2; regalo.add(cintaB);

  const tapa = new THREE.Group();
  tapa.add(pieza(S + 0.14, L, S + 0.14, negro));
  const tA = pieza(0.28, L + 0.006, S + 0.15, cinta, bordeVioleta); tapa.add(tA);
  const tB = pieza(S + 0.15, L + 0.006, 0.28, cinta, bordeVioleta); tapa.add(tB);
  // Moño: dos lazos (toros aplastados) y un nudo
  const lazoG = new THREE.TorusGeometry(0.34, 0.075, 16, 48);
  for (const lado of [-1, 1]) {
    const lazo = new THREE.Mesh(lazoG, cinta);
    lazo.add(new THREE.LineSegments(new THREE.EdgesGeometry(lazoG, 30), bordeVioleta));
    lazo.scale.set(1, 0.62, 1);
    lazo.rotation.set(Math.PI / 2.4, 0, lado * 0.55);
    lazo.position.set(lado * 0.3, L / 2 + 0.2, 0);
    tapa.add(lazo);
  }
  const nudo = pieza(0.22, 0.18, 0.22, cinta, bordeVioleta); nudo.position.y = L / 2 + 0.09; tapa.add(nudo);
  const tapaY = -0.2 + H / 2 + L / 2;
  tapa.position.y = tapaY;
  regalo.add(tapa);

  regalo.rotation.set(0.32, -0.6, 0);
  escena.add(regalo);

  // Interacción: inclina hacia el puntero (o el giroscopio no se usa: solo puntero/tacto)
  let px = 0, py = 0, tx = 0, ty = 0;
  const mover = (x, y) => { const r = canvas.getBoundingClientRect(); tx = ((x - r.left) / r.width - 0.5) * 2; ty = ((y - r.top) / r.height - 0.5) * 2; };
  addEventListener("pointermove", e => mover(e.clientX, e.clientY), { passive: true });

  const ajustar = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.position.z = w / h < 0.9 ? 9.6 : 8.2;
    camara.updateProjectionMatrix();
  };
  new ResizeObserver(ajustar).observe(canvas);
  ajustar();

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);

  const reloj = new THREE.Clock();
  const cuadro = () => {
    requestAnimationFrame(cuadro);
    if (!visible) return;
    const t = reloj.getElapsedTime();
    px += (tx - px) * 0.04; py += (ty - py) * 0.04;
    const giro = reducido ? 0 : t * 0.22;
    regalo.rotation.y = -0.6 + giro + px * 0.35;
    regalo.rotation.x = 0.32 + py * 0.15;
    regalo.position.y = reducido ? 0 : Math.sin(t * 0.9) * 0.08;
    // La tapa "respira": se levanta un poco cada tanto. Abierta: flota arriba e inclinada.
    const abre = abierta ? 1 : (reducido ? 0 : Math.max(0, Math.sin(t * 0.7 - 1.2)) ** 6);
    tapa.position.y = tapaY + (abierta ? 0.95 + Math.sin(t * 1.2) * 0.06 : abre * 0.28);
    tapa.rotation.z = abierta ? -0.22 + Math.sin(t * 0.8) * 0.04 : abre * -0.06;
    tapa.rotation.x = abierta ? 0.12 : 0;
    renderer.render(escena, camara);
  };
  cuadro();
  canvas.classList.add("ready");
}

/** Confeti breve en un canvas a pantalla completa (colores de estado del diseño). */
export function confeti(canvas, { piezas = 160, duracion = 4200 } = {}) {
  if (!canvas || reducido) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const tam = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; };
  tam(); addEventListener("resize", tam);
  const colores = ["#baa7ff", "#9281f7", "#3ad389", "#ffca16", "#70b8ff", "#ff9592", "#f0f0f0"];
  const p = Array.from({ length: piezas }, () => ({
    x: innerWidth * (0.2 + Math.random() * 0.6), y: innerHeight * 0.35 + Math.random() * 40,
    vx: (Math.random() - 0.5) * 12, vy: -6 - Math.random() * 10,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    w: 5 + Math.random() * 6, h: 8 + Math.random() * 8, c: colores[(Math.random() * colores.length) | 0],
  }));
  const t0 = performance.now();
  const paso = ahora => {
    const dt = ahora - t0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const alfa = Math.max(0, 1 - Math.max(0, dt - duracion + 1200) / 1200);
    for (const q of p) {
      q.vy += 0.28; q.vx *= 0.99; q.x += q.vx; q.y += q.vy; q.r += q.vr;
      ctx.save(); ctx.globalAlpha = alfa; ctx.translate(q.x, q.y); ctx.rotate(q.r);
      ctx.fillStyle = q.c; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, Math.abs(Math.cos(q.r * 2)) * q.h + 1);
      ctx.restore();
    }
    if (dt < duracion) requestAnimationFrame(paso); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(paso);
}
