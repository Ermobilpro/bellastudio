import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const APP_TZ = process.env.APP_TZ || "America/Bogota";
const COMPANIES_FILE = path.join(DATA_DIR, "companies.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Utilidades de archivos                                              */
/* ------------------------------------------------------------------ */

function readJSON(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}
function writeJSON(file, obj) {
  // Escritura atómica: primero a un archivo temporal y luego se renombra sobre
  // el definitivo (el rename es una operación atómica), para que un cierre o
  // caída del proceso a mitad de escritura nunca deje un archivo corrupto.
  // También conserva una copia de respaldo del estado anterior.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, `${file}.bak`); } catch { /* no crítico */ }
  }
  fs.renameSync(tmp, file);
}
function safeSlug(slug) {
  return String(slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
}
function tenantFile(slug) {
  return path.join(DATA_DIR, `tenant-${safeSlug(slug)}.json`);
}
function safeEqual(a, b) {
  // Comparación en tiempo constante (evita adivinar claves midiendo tiempos).
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function uid() { return crypto.randomBytes(5).toString("hex").slice(0, 8); }

// Secreto para firmar las sesiones del equipo. Se guarda en el volumen de datos
// para que las sesiones sigan valiendo aunque Railway reinicie el servidor.
const SECRET_FILE = path.join(DATA_DIR, ".session-secret");
let SESSION_SECRET = process.env.SESSION_SECRET || "";
if (!SESSION_SECRET) {
  if (fs.existsSync(SECRET_FILE)) SESSION_SECRET = fs.readFileSync(SECRET_FILE, "utf-8").trim();
  if (!SESSION_SECRET) {
    SESSION_SECRET = crypto.randomBytes(32).toString("hex");
    try { fs.writeFileSync(SECRET_FILE, SESSION_SECRET); } catch { /* no crítico */ }
  }
}

/* ------------------------------------------------------------------ */
/* Fechas en hora de Colombia (Railway corre en UTC)                   */
/* ------------------------------------------------------------------ */

function nowLocal() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
function isoDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function hhmm(s) { return typeof s === "string" && /^\d{2}:\d{2}$/.test(s); }
function timeToMin(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function weekdayOf(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function minutesUntil(dateISO, time) {
  const now = nowLocal();
  const [y1, m1, d1] = now.date.split("-").map(Number);
  const [y2, m2, d2] = dateISO.split("-").map(Number);
  const days = (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000;
  return days * 1440 + timeToMin(time) - now.minutes;
}

// Mismas reglas de horario que la app
const OPEN_START_MIN = 7 * 60;
const OPEN_END_MIN = 19 * 60;
const SLOT_STEP_MIN = 30;
const EXTENDED_RANGES = [[7 * 60, 9 * 60], [18 * 60, 19 * 60]];
function isExtendedSlot(m) { return EXTENDED_RANGES.some(([s, e]) => m >= s && m < e); }
function employeeWorksOn(emp, dateISO) {
  if (!emp || !Array.isArray(emp.workDays) || emp.workDays.length === 0) return true;
  return emp.workDays.includes(weekdayOf(dateISO));
}
function normPhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("57")) d = d.slice(2);
  return d;
}
function promoServiceIds(promo) {
  if (Array.isArray(promo.serviceIds) && promo.serviceIds.length > 0) return promo.serviceIds;
  return promo.serviceId ? [promo.serviceId] : [];
}
function promoUsable(promo, serviceId, dateISO) {
  if (!promo || !promo.active) return false;
  if (!promoServiceIds(promo).includes(serviceId)) return false;
  if (promo.validFrom && dateISO < promo.validFrom) return false;
  if (promo.validTo && dateISO > promo.validTo) return false;
  if (promo.weekday !== null && promo.weekday !== undefined && promo.weekday !== "") {
    if (weekdayOf(dateISO) !== Number(promo.weekday)) return false;
  }
  return true;
}
function overlaps(appts, empId, dateISO, startMin, duration, excludeId) {
  const end = startMin + duration;
  return (appts || []).some((x) => {
    if (x.id === excludeId) return false;
    if (x.employeeId !== empId || x.date !== dateISO || x.status === "cancelada" || x.status === "rechazada") return false;
    const xs = timeToMin(x.time);
    return startMin < xs + x.duration && end > xs;
  });
}

/* ------------------------------------------------------------------ */
/* Sesiones del equipo (token firmado)                                 */
/* ------------------------------------------------------------------ */

const TOKEN_HOURS = 24;
function b64u(buf) { return Buffer.from(buf).toString("base64url"); }
function signToken(slug, empId) {
  const payload = b64u(JSON.stringify({ s: safeSlug(slug), e: empId, x: Date.now() + TOKEN_HOURS * 3600 * 1000 }));
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function readToken(token, slug) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (p.s !== safeSlug(slug) || Date.now() > p.x) return null;
    return p;
  } catch {
    return null;
  }
}

// Quién está haciendo la petición: plataforma, equipo (y si es admin) o público.
function whoIs(req, slug, data) {
  const adminKey = req.header("x-admin-key") || "";
  if (ADMIN_KEY && adminKey && safeEqual(adminKey, ADMIN_KEY)) return { level: "platform", isAdmin: true };
  const tok = readToken(req.header("x-team-token"), slug);
  if (tok && data) {
    const emp = (data.employees || []).find((e) => e.id === tok.e && e.active);
    if (emp) return { level: "team", isAdmin: !!emp.isAdmin, employeeId: emp.id };
  }
  return { level: "public" };
}

/* ------------------------------------------------------------------ */
/* Límite de intentos (PIN y acciones públicas)                        */
/* ------------------------------------------------------------------ */

const buckets = new Map();
function tooMany(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n += 1;
  buckets.set(key, b);
  if (buckets.size > 5000) { for (const [k, v] of buckets) if (now - v.t > windowMs) buckets.delete(k); }
  return b.n > max;
}
function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

/* ------------------------------------------------------------------ */
/* Qué datos ve cada quien                                             */
/* ------------------------------------------------------------------ */

function stripEmployee(e) {
  const { pin, ...rest } = e;
  return { ...rest, hasPin: !!pin };
}
function stripClient(c) {
  const { pin, ...rest } = c;
  return rest;
}
// Equipo / plataforma: todo, menos los PIN.
function teamView(data) {
  const { _publicLog, ...rest } = data;
  return {
    ...rest,
    employees: (data.employees || []).map(stripEmployee),
    clients: (data.clients || []).map(stripClient),
  };
}
// Público (pantalla de entrada y clientas): solo lo necesario para reservar.
// Si la clienta se identificó (id + celular), también recibe su ficha y el
// detalle de sus propias citas. De las demás citas solo se manda lo justo
// para calcular los horarios ocupados.
function publicView(data, me) {
  const myId = me?.id || null;
  return {
    businessName: data.businessName,
    services: data.services || [],
    employees: (data.employees || []).map((e) => ({
      id: e.id, name: e.name, active: e.active, isAdmin: !!e.isAdmin,
      serviceIds: e.serviceIds || [], workDays: e.workDays,
      ...(e.isAdmin && e.phone ? { phone: e.phone } : {}),
    })),
    promotions: data.promotions || [],
    extendedHoursEnabled: data.extendedHoursEnabled,
    cancelMinHours: data.cancelMinHours,
    pointsPerThousand: data.pointsPerThousand,
    whatsappSalon: data.whatsappSalon,
    hasTeam: (data.employees || []).length > 0,
    clients: me ? [stripClient(me)] : [],
    appointments: (data.appointments || []).map((a) =>
      a.clientId === myId
        ? a
        : { id: a.id, employeeId: a.employeeId, date: a.date, time: a.time, duration: a.duration, status: a.status, clientId: "otra" }
    ),
    _rev: data._rev || 0,
    _public: true,
  };
}
function findClient(data, clientId, phone) {
  const c = (data.clients || []).find((x) => x.id === clientId);
  if (!c || !normPhone(phone) || normPhone(c.phone) !== normPhone(phone)) return null;
  return c;
}

/* ------------------------------------------------------------------ */
/* Guardado con registro de cambios públicos                           */
/* ------------------------------------------------------------------ */
// Cada cambio que hace una clienta (reservar, cancelar, etc.) queda anotado con
// su número de versión. Si el equipo guarda con una copia vieja de los datos,
// esos cambios se vuelven a aplicar encima, así nunca se pierde una reserva.

const LOG_MAX = 1000;
function savePublicChange(slug, data, entry) {
  const rev = (data._rev || 0) + 1;
  const log = [...(data._publicLog || []), { ...entry, rev }].slice(-LOG_MAX);
  const next = { ...data, _rev: rev, _publicLog: log };
  writeJSON(tenantFile(slug), next);
  return next;
}
function applyLog(target, entries) {
  let out = { ...target, clients: [...(target.clients || [])], appointments: [...(target.appointments || [])] };
  for (const en of entries) {
    if (en.op === "addClient") {
      if (!out.clients.some((c) => c.id === en.client.id || normPhone(c.phone) === normPhone(en.client.phone))) out.clients.push(en.client);
    } else if (en.op === "addAppt") {
      if (!out.appointments.some((a) => a.id === en.appt.id)) out.appointments.push(en.appt);
    } else if (en.op === "patchAppt") {
      out.appointments = out.appointments.map((a) => (a.id === en.id ? { ...a, ...en.patch } : a));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const app = express();
app.set("trust proxy", true);
// Límite generoso porque las promociones guardan la imagen dentro del mismo
// bloque de datos del negocio. A futuro conviene guardar las imágenes aparte.
app.use(express.json({ limit: "10mb" }));

function requireAdminKey(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).json({ error: "ADMIN_KEY no está configurada en el servidor" });
  const provided = req.header("x-admin-key") || "";
  if (!safeEqual(provided, ADMIN_KEY)) return res.status(401).json({ error: "Clave maestra incorrecta" });
  next();
}

app.post("/api/admin/verify", (req, res) => {
  if (tooMany(`admin:${clientIp(req)}`, 10, 15 * 60 * 1000)) return res.status(429).json({ ok: false });
  const key = req.body?.key || "";
  res.json({ ok: !!ADMIN_KEY && safeEqual(key, ADMIN_KEY) });
});

// Registro de empresas: lectura pública (sin claves), escritura con clave maestra.
app.get("/api/companies", (req, res) => {
  const reg = readJSON(COMPANIES_FILE);
  if (!reg) return res.status(404).json(null);
  const safe = { ...reg, companies: (reg.companies || []).map(({ writeKey, ...rest }) => rest) };
  res.json(safe);
});
app.post("/api/companies", (req, res, next) => {
  // La primera vez (sin archivo todavía) la app crea el registro vacío.
  const existing = readJSON(COMPANIES_FILE);
  if (!existing && Array.isArray(req.body?.companies) && req.body.companies.length === 0) {
    writeJSON(COMPANIES_FILE, { companies: [] });
    return res.json({ ok: true });
  }
  return requireAdminKey(req, res, next);
}, (req, res) => {
  const incoming = req.body || {};
  const companies = (incoming.companies || []).map(({ writeKey, ...c }) => c);
  writeJSON(COMPANIES_FILE, { ...incoming, companies });
  res.json({ ok: true });
});
function companyExists(slug) {
  const reg = readJSON(COMPANIES_FILE);
  return (reg?.companies || []).some((c) => c.slug === safeSlug(slug));
}

// Leer datos de una empresa. Cada quien recibe solo lo que le corresponde.
app.get("/api/tenant/:slug", (req, res) => {
  const data = readJSON(tenantFile(req.params.slug));
  if (!data) return res.status(404).json(null);
  const who = whoIs(req, req.params.slug, data);
  if (who.level !== "public") return res.json(teamView(data));
  const me = findClient(data, req.header("x-client-id"), req.header("x-client-phone"));
  res.json(publicView(data, me));
});

// Guardado completo: solo el equipo (o la plataforma). La única excepción es
// crear los datos iniciales de una empresa que existe pero aún no tiene datos.
app.post("/api/tenant/:slug", (req, res) => {
  const slug = req.params.slug;
  const stored = readJSON(tenantFile(slug));
  const body = { ...(req.body || {}) };
  delete body._writeKey; delete body._publicLog; delete body._public;
  const baseRev = Number(body._baseRev ?? body._rev ?? 0);
  delete body._baseRev;

  if (!stored) {
    const who = whoIs(req, slug, null);
    if (who.level !== "platform") {
      if (!companyExists(slug)) return res.status(404).json({ error: "Empresa no encontrada" });
      if ((body.employees || []).length > 0 || (body.clients || []).length > 0 || (body.appointments || []).length > 0) {
        return res.status(401).json({ error: "No autorizado" });
      }
    }
    const seed = { ...body, _rev: 1, _publicLog: [] };
    writeJSON(tenantFile(slug), seed);
    return res.json({ ok: true, rev: 1 });
  }

  const who = whoIs(req, slug, stored);
  if (who.level === "public") return res.status(401).json({ error: "Tu sesión se cerró. Vuelve a ingresar." });

  // PIN: nunca viajan al navegador. Si llega un PIN nuevo (4 dígitos) se usa;
  // si no, se conserva el que ya estaba guardado.
  const storedEmp = Object.fromEntries((stored.employees || []).map((e) => [e.id, e]));
  let employees = (body.employees || []).map((e) => {
    const { hasPin, ...rest } = e;
    const pin = typeof e.pin === "string" && /^\d{4}$/.test(e.pin) ? e.pin : storedEmp[e.id]?.pin || "";
    return { ...rest, pin };
  });
  // Solo una administradora puede cambiar el equipo.
  if (!who.isAdmin) employees = stored.employees || [];
  if (!employees.some((e) => e.isAdmin && e.active) && (stored.employees || []).some((e) => e.isAdmin && e.active)) {
    return res.status(400).json({ error: "Debe quedar al menos una administradora activa." });
  }
  const storedCli = Object.fromEntries((stored.clients || []).map((c) => [c.id, c]));
  const clients = (body.clients || []).map((c) => ({ ...c, pin: storedCli[c.id]?.pin || c.pin || "" }));

  let next = { ...body, employees, clients };
  const currentRev = stored._rev || 0;
  let merged = false;
  if (baseRev < currentRev) {
    const missed = (stored._publicLog || []).filter((en) => en.rev > baseRev);
    if (missed.length) { next = applyLog(next, missed); merged = true; }
  }
  next._rev = currentRev + 1;
  next._publicLog = stored._publicLog || [];
  writeJSON(tenantFile(slug), next);
  res.json({ ok: true, rev: next._rev, ...(merged ? { data: teamView(next) } : {}) });
});

app.delete("/api/tenant/:slug", requireAdminKey, (req, res) => {
  const f = tenantFile(req.params.slug);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true });
});

/* ---------------------------- Equipo ---------------------------- */

app.post("/api/tenant/:slug/team/login", (req, res) => {
  const slug = req.params.slug;
  const key = `pin:${clientIp(req)}:${safeSlug(slug)}`;
  if (tooMany(key, 8, 15 * 60 * 1000)) return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
  const data = readJSON(tenantFile(slug));
  if (!data) return res.status(404).json({ error: "Empresa sin datos" });
  const name = String(req.body?.name || "").trim().toLowerCase();
  const pin = String(req.body?.pin || "");
  const emp = (data.employees || []).find((e) => e.active && e.name.toLowerCase() === name && e.pin && safeEqual(e.pin, pin));
  if (!emp) return res.status(401).json({ error: "Nombre o PIN incorrectos." });
  buckets.delete(key);
  res.json({ token: signToken(slug, emp.id), employee: stripEmployee(emp) });
});

// Primera administradora de una empresa nueva (solo si aún no hay equipo).
app.post("/api/tenant/:slug/team/setup", (req, res) => {
  const slug = req.params.slug;
  const data = readJSON(tenantFile(slug));
  if (!data) return res.status(404).json({ error: "Empresa sin datos" });
  if ((data.employees || []).length > 0) return res.status(409).json({ error: "Esta empresa ya tiene equipo. Ingresa con tu nombre y PIN." });
  const name = String(req.body?.name || "").trim();
  const pin = String(req.body?.pin || "");
  if (!name || !/^\d{4}$/.test(pin)) return res.status(400).json({ error: "Escribe tu nombre y un PIN de 4 dígitos." });
  const admin = { id: uid(), name, pin, isAdmin: true, active: true, serviceIds: (data.services || []).map((s) => s.id) };
  const next = { ...data, employees: [admin], _rev: (data._rev || 0) + 1 };
  writeJSON(tenantFile(slug), next);
  res.json({ token: signToken(slug, admin.id), employee: stripEmployee(admin) });
});

/* ---------------------------- Clientas (sin registro) ---------------------------- */

function publicGuard(req, res) {
  if (tooMany(`pub:${clientIp(req)}`, 60, 10 * 60 * 1000)) {
    res.status(429).json({ error: "Demasiadas solicitudes. Intenta en unos minutos." });
    return null;
  }
  const data = readJSON(tenantFile(req.params.slug));
  if (!data) { res.status(404).json({ error: "Empresa sin datos" }); return null; }
  return data;
}

// Entrar con nombre + celular: busca la ficha por celular o la crea.
app.post("/api/tenant/:slug/public/client", (req, res) => {
  const data = publicGuard(req, res); if (!data) return;
  const name = String(req.body?.name || "").trim().slice(0, 80);
  const phone = normPhone(req.body?.phone);
  if (!name) return res.status(400).json({ error: "Escribe tu nombre." });
  if (phone.length < 7 || phone.length > 13) return res.status(400).json({ error: "Escribe un número de celular válido." });
  const found = (data.clients || []).find((c) => normPhone(c.phone) === phone);
  if (found) return res.json({ client: stripClient(found) });
  const client = { id: uid(), name, phone, email: "", pin: "", createdAt: Date.now(), origen: "reserva-rapida" };
  savePublicChange(req.params.slug, { ...data, clients: [...(data.clients || []), client] }, { op: "addClient", client });
  res.json({ client: stripClient(client) });
});

app.post("/api/tenant/:slug/public/appointments", (req, res) => {
  const data = publicGuard(req, res); if (!data) return;
  const { clientId, phone, serviceId, employeeId, date, time, promoId } = req.body || {};
  const client = findClient(data, clientId, phone);
  if (!client) return res.status(401).json({ error: "Vuelve a ingresar con tu nombre y celular." });
  const service = (data.services || []).find((s) => s.id === serviceId);
  const emp = (data.employees || []).find((e) => e.id === employeeId && e.active);
  if (!service || !emp || !(emp.serviceIds || []).includes(serviceId)) return res.status(400).json({ error: "Servicio o profesional no disponible." });
  if (!isoDate(date) || !hhmm(time)) return res.status(400).json({ error: "Fecha u hora inválida." });
  const start = timeToMin(time);
  if (start < OPEN_START_MIN || start + service.duration > OPEN_END_MIN || (start - OPEN_START_MIN) % SLOT_STEP_MIN !== 0) return res.status(400).json({ error: "Hora fuera del horario." });
  if (isExtendedSlot(start) && data.extendedHoursEnabled === false) return res.status(400).json({ error: "Ese horario no está disponible." });
  if (minutesUntil(date, time) <= 0) return res.status(400).json({ error: "Esa hora ya pasó." });
  if (!employeeWorksOn(emp, date)) return res.status(400).json({ error: "La profesional no trabaja ese día." });
  if (overlaps(data.appointments, emp.id, date, start, service.duration)) return res.status(409).json({ error: "ocupado" });
  const promo = promoId ? (data.promotions || []).find((p) => p.id === promoId) : null;
  const promoOk = promoUsable(promo, serviceId, date);
  const appt = {
    id: uid(), clientId: client.id, employeeId: emp.id, serviceId,
    serviceName: service.name,
    price: promoOk && promo.price != null ? Number(promo.price) : service.price,
    duration: service.duration, date, time,
    status: isExtendedSlot(start) ? "pendiente" : "confirmada", createdAt: Date.now(),
    promoId: promoOk ? promo.id : null, promoTitle: promoOk ? promo.title : null,
  };
  savePublicChange(req.params.slug, { ...data, appointments: [...(data.appointments || []), appt] }, { op: "addAppt", appt });
  res.json({ appt });
});

function ownAppt(data, req, res) {
  const { clientId, phone } = req.body || {};
  const client = findClient(data, clientId, phone);
  if (!client) { res.status(401).json({ error: "Vuelve a ingresar con tu nombre y celular." }); return null; }
  const appt = (data.appointments || []).find((a) => a.id === req.params.id && a.clientId === client.id);
  if (!appt) { res.status(404).json({ error: "Cita no encontrada." }); return null; }
  return appt;
}
function patchAppt(req, data, id, patch) {
  const next = { ...data, appointments: (data.appointments || []).map((a) => (a.id === id ? { ...a, ...patch } : a)) };
  savePublicChange(req.params.slug, next, { op: "patchAppt", id, patch });
}

app.post("/api/tenant/:slug/public/appointments/:id/cancel", (req, res) => {
  const data = publicGuard(req, res); if (!data) return;
  const a = ownAppt(data, req, res); if (!a) return;
  if (a.status === "cancelada" || a.status === "rechazada" || a.status === "completada") return res.status(400).json({ error: "Esta cita ya no se puede cancelar." });
  const minHours = data.cancelMinHours != null ? Number(data.cancelMinHours) : 3;
  if (a.status !== "pendiente" && minutesUntil(a.date, a.time) < minHours * 60) return res.status(400).json({ error: "muy-tarde" });
  patchAppt(req, data, a.id, { status: "cancelada" });
  res.json({ ok: true });
});

app.post("/api/tenant/:slug/public/appointments/:id/reschedule", (req, res) => {
  const data = publicGuard(req, res); if (!data) return;
  const a = ownAppt(data, req, res); if (!a) return;
  if (a.status !== "confirmada" && a.status !== "pendiente") return res.status(400).json({ error: "Esta cita ya no se puede reagendar." });
  const { date, time } = req.body || {};
  if (!isoDate(date) || !hhmm(time)) return res.status(400).json({ error: "Fecha u hora inválida." });
  const start = timeToMin(time);
  const emp = (data.employees || []).find((e) => e.id === a.employeeId);
  if (start < OPEN_START_MIN || start + a.duration > OPEN_END_MIN) return res.status(400).json({ error: "Hora fuera del horario." });
  if (isExtendedSlot(start) && data.extendedHoursEnabled === false) return res.status(400).json({ error: "Ese horario no está disponible." });
  if (minutesUntil(date, time) <= 0) return res.status(400).json({ error: "Esa hora ya pasó." });
  if (!employeeWorksOn(emp, date)) return res.status(400).json({ error: "La profesional no trabaja ese día." });
  if (overlaps(data.appointments, a.employeeId, date, start, a.duration, a.id)) return res.status(409).json({ error: "ocupado" });
  patchAppt(req, data, a.id, { date, time, status: isExtendedSlot(start) ? "pendiente" : "confirmada" });
  res.json({ ok: true });
});

app.post("/api/tenant/:slug/public/appointments/:id/review", (req, res) => {
  const data = publicGuard(req, res); if (!data) return;
  const a = ownAppt(data, req, res); if (!a) return;
  if (a.status !== "completada" || a.review) return res.status(400).json({ error: "No se puede reseñar esta cita." });
  const rating = Math.max(1, Math.min(5, Math.round(Number(req.body?.rating) || 5)));
  const comment = String(req.body?.comment || "").trim().slice(0, 500);
  patchAppt(req, data, a.id, { review: { rating, comment, createdAt: Date.now() } });
  res.json({ ok: true });
});

// Sirve el frontend ya compilado (npm run build) desde /dist
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
