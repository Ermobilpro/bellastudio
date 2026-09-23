import { useState, useEffect, useCallback, useRef } from "react";
import {
  Calendar, Clock, Users, TrendingUp, LogOut,
  Plus, Check, ChevronLeft, ChevronRight, Scissors, User, Receipt, Printer, MessageCircle, Ban, Trash2, FileText, Package, Wallet, Percent, Megaphone, Star, Download,
} from "lucide-react";

const LOGO_SRC = "/logo.png";
const CATEGORIES = ["Uñas", "Keratina", "Otro"];
const OPEN_START_MIN = 7 * 60;
const OPEN_END_MIN = 19 * 60;
const SLOT_STEP_MIN = 30;
// Franjas "especiales": fuera del horario habitual (9am-6pm), así que una cita
// que caiga aquí no se confirma sola — queda pendiente de que la administradora
// la acepte o la rechace.
const EXTENDED_RANGES = [
  [7 * 60, 9 * 60],
  [18 * 60, 19 * 60],
];
function isExtendedSlot(startMin) {
  return EXTENDED_RANGES.some(([s, e]) => startMin >= s && startMin < e);
}
const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const WEEKDAYS_FULL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function uid() { return Math.random().toString(36).slice(2, 10); }
function pad2(n) { return String(n).padStart(2, "0"); }
function toISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fromISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function timeToMin(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function minToTime(mm) { return `${pad2(Math.floor(mm / 60))}:${pad2(mm % 60)}`; }
function money(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("es-CO");
}
function todayISO() { return toISO(new Date()); }
function initialOf(name) { return (name || "?").trim().charAt(0).toUpperCase(); }

function defaultData() {
  return {
    businessName: "BellaStudio",
    services: [
      { id: uid(), name: "Manicure clásica", category: "Uñas", duration: 45, price: 25000, description: "" },
      { id: uid(), name: "Manicure semipermanente", category: "Uñas", duration: 60, price: 45000, description: "" },
      { id: uid(), name: "Pedicura spa", category: "Uñas", duration: 60, price: 35000, description: "" },
      { id: uid(), name: "Uñas acrílicas", category: "Uñas", duration: 90, price: 70000, description: "" },
      { id: uid(), name: "Keratina alisadora", category: "Keratina", duration: 180, price: 180000, description: "" },
      { id: uid(), name: "Botox capilar", category: "Keratina", duration: 150, price: 150000, description: "" },
    ],
    employees: [],
    clients: [],
    appointments: [],
    promotions: [],
  };
}

function compressImageFile(file, maxDim = 1000, quality = 0.72) {
  // Redimensiona y comprime la imagen antes de guardarla, para no ir inflando
  // el tamaño de los datos del negocio con fotos pesadas de celular.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo procesar la imagen"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch {
          resolve(reader.result);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function employeeWorksOn(emp, dateISO) {
  // Sin workDays definido (empleadas antiguas) se asume que trabaja todos los días.
  if (!emp || !Array.isArray(emp.workDays) || emp.workDays.length === 0) return true;
  return emp.workDays.includes(fromISO(dateISO).getDay());
}

function exportCSV(filename, headers, rows) {
  // Genera un archivo CSV (se abre directo en Excel) sin depender de librerías externas.
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(";"), ...rows.map((r) => r.map(escape).join(";"))];
  const csv = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


/* ------------------------- API propia (plataforma + empresas) ------------------------- */

async function apiGetCompanies() {
  try {
    const res = await fetch("/api/companies");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
async function apiSetCompanies(obj, adminKey) {
  try {
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(adminKey ? { "x-admin-key": adminKey } : {}) },
      body: JSON.stringify(obj),
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function apiVerifyAdminKey(key) {
  try {
    const res = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return !!json.ok;
  } catch {
    return false;
  }
}
async function apiGetTenant(slug) {
  // Distingue "la empresa todavía no tiene datos" (404 confirmado) de un error
  // de red o del servidor, para nunca confundir un fallo de conexión con una
  // empresa nueva y terminar sembrando datos vacíos encima de datos reales.
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}`);
    if (res.status === 404) return { __notFound: true };
    if (!res.ok) return { __error: true };
    return await res.json();
  } catch {
    return { __error: true };
  }
}
async function apiSetTenant(slug, obj, writeKey) {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(writeKey ? { "x-write-key": writeKey } : {}) },
      body: JSON.stringify(obj),
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function apiDeleteTenant(slug, adminKey) {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: adminKey ? { "x-admin-key": adminKey } : {},
    });
    return res.ok;
  } catch {
    return false;
  }
}

function defaultRegistry() {
  return { companies: [] };
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function vigenciaStatus(company) {
  if (!company.vigenciaFin) return "permanente";
  const today = todayISO();
  if (today > company.vigenciaFin) return "vencida";
  const diffDays = Math.round((fromISO(company.vigenciaFin) - fromISO(today)) / 86400000);
  if (diffDays <= 7) return "por-vencer";
  return "activa";
}

function addMonths(dateISO, n) {
  const d = fromISO(dateISO);
  d.setMonth(d.getMonth() + n);
  return toISO(d);
}

const VIGENCIA_PRESETS = [
  { key: "permanente", label: "Sin vencimiento" },
  { key: "1m", label: "1 mes" },
  { key: "3m", label: "3 meses" },
  { key: "6m", label: "6 meses" },
  { key: "1a", label: "1 año" },
  { key: "custom", label: "Fecha personalizada" },
];

function computeVigenciaFin(modo, desdeISO, customISO) {
  if (modo === "permanente") return null;
  if (modo === "1m") return addMonths(desdeISO, 1);
  if (modo === "3m") return addMonths(desdeISO, 3);
  if (modo === "6m") return addMonths(desdeISO, 6);
  if (modo === "1a") return addMonths(desdeISO, 12);
  if (modo === "custom") return customISO || null;
  return null;
}

function VigenciaPicker({ modo, setModo, customFecha, setCustomFecha }) {
  return (
    <div>
      <div className="chip-row">
        {VIGENCIA_PRESETS.map((p) => (
          <button
            key={p.key} type="button"
            className={`chip ${modo === p.key ? "chip-active" : ""}`}
            onClick={() => setModo(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {modo === "custom" && (
        <input className="input" type="date" value={customFecha} onChange={(e) => setCustomFecha(e.target.value)} style={{ maxWidth: 220, marginBottom: ".8rem" }} />
      )}
    </div>
  );
}

/* ---------------------------------- Estilos ---------------------------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');

html, body, #root{ height:100%; margin:0; padding:0; }

:root{
  --ink:#2e2230;
  --muted:#806f7d;
  --paper:#fffafb;
  --soft:#f8edf3;
  --line:#eadce4;
  --berry:#a8406d;
  --berry-dark:#842d54;
  --berry-deep:#6f294d;
  --rose:#eb8eaa;
  --gold:#c9983c;
  --shadow:0 20px 60px rgba(91,37,67,.16);
  --sage:#4e7a54;
  --sage-bg:#e8f0e8;
  --lilac-bg:#ece7f6;
  --lilac:#645185;
  --gold-bg:#f8e5ce;
  --gold-ink:#8b5a17;
  --danger:#a33b3b;
  --danger-bg:#f6e5e4;
}
.app-shell{
  font-family:'Nunito',ui-rounded,"Segoe UI",sans-serif;
  color:var(--ink);
  background:var(--soft);
  min-height:100vh;
  width:100%;
}
.app-shell *{ box-sizing:border-box; }
.app-shell h1,.app-shell h2,.app-shell h3,.app-shell h4{ font-family:Georgia,serif; margin:0; font-weight:500; }
.app-shell.loading{ display:flex; align-items:center; justify-content:center; min-height:100vh; color:var(--muted); }
:focus-visible{ outline:2px solid var(--berry); outline-offset:2px; }
@media (prefers-reduced-motion: reduce){ .app-shell *{ transition:none !important; animation:none !important; } }

/* --- Marca --- */
.brand-label{ display:flex; align-items:center; gap:.5rem; letter-spacing:.14em; font-weight:800; font-size:.76rem; color:var(--berry); text-transform:uppercase; }
.brand-label.light{ color:#f8cedc; }
.brand-photo{ width:30px; height:30px; border-radius:50%; overflow:hidden; background:#fff; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 2px 6px rgba(91,37,67,.2); }
.brand-photo img{ width:100%; height:100%; object-fit:cover; }

/* --- Hero de bienvenida --- */
.hero{ position:relative; isolation:isolate; overflow:hidden; display:flex; align-items:center; justify-content:space-between;
  gap:3rem; min-height:100vh; padding:4rem 8%;
  background:radial-gradient(circle at 77% 21%, #f7c6d5 0 9%, transparent 29%), linear-gradient(115deg,#fff8fb 0%,#f7dce6 50%,#eed2bc 100%); }
.hero-decor{ position:absolute; right:-110px; bottom:-160px; width:440px; height:440px; border-radius:50%;
  background:linear-gradient(135deg,var(--berry),var(--gold)); z-index:-1; opacity:.9; filter:blur(2px); }
.hero-copy{ max-width:480px; position:relative; z-index:1; }
.hero-copy h1{ font-size:clamp(2.3rem,5.4vw,3.6rem); line-height:.98; letter-spacing:-.01em; margin:1rem 0; color:var(--ink); }
.hero-copy > p{ max-width:380px; color:#664957; font-size:1.05rem; line-height:1.6; margin:0 0 1.6rem; }
.hero-card{ position:relative; z-index:1; width:280px; flex-shrink:0; background:var(--paper); padding:1.25rem;
  border-radius:22px; box-shadow:var(--shadow); transform:rotate(3deg); }
.hero-photo{ height:230px; border-radius:15px; background:linear-gradient(155deg,var(--berry),var(--rose) 55%,var(--gold));
  display:flex; align-items:center; justify-content:center; padding:1.1rem; overflow:hidden; }
.hero-photo img{ width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 8px 16px rgba(46,20,33,.32)); }
.hero-card strong{ display:block; font-family:Georgia,serif; font-size:1.12rem; margin-top:1rem; color:var(--ink); }
.hero-card span{ font-size:.8rem; color:var(--muted); }
.auth-choice{ display:flex; flex-direction:column; gap:.75rem; max-width:360px; }
.choice-card{ display:flex; align-items:center; gap:.9rem; background:var(--paper); border:1px solid var(--line);
  border-radius:16px; padding:1.05rem 1.2rem; text-align:left; cursor:pointer; color:var(--ink); box-shadow:0 6px 18px rgba(91,37,67,.06); }
.choice-card:hover{ border-color:var(--berry); transform:translateY(-1px); }
.choice-card svg{ color:var(--berry); flex-shrink:0; }
.choice-title{ font-weight:700; }
.choice-sub{ font-size:.85rem; color:var(--muted); }

/* --- Login (split) --- */
.login{ min-height:100vh; display:flex; justify-content:center; align-items:center; padding:2rem;
  background:linear-gradient(130deg,#f8e5eb,#f6e8dc); }
.login-box{ display:grid; grid-template-columns:1fr 1fr; max-width:840px; width:100%; overflow:hidden;
  border-radius:26px; background:var(--paper); box-shadow:var(--shadow); }
.login-art{ padding:2.75rem; background:linear-gradient(160deg,#aa426f,var(--berry-deep)); color:#fff;
  display:flex; flex-direction:column; justify-content:space-between; gap:2rem; }
.login-art h2{ font-size:2.1rem; font-weight:400; line-height:1.06; margin:1rem 0 0; }
.login-art .quote{ font-size:.85rem; line-height:1.6; color:#f9dce7; }
.login-form{ padding:2.75rem; }
.login-form h3.form-title{ font-size:1.7rem; margin:.6rem 0 .3rem; }
.login-form > p.form-sub{ color:var(--muted); font-size:.88rem; margin:0 0 .5rem; }
.back-link{ border:0; background:transparent; color:var(--berry); padding:0; margin-top:1.3rem; font-size:.83rem; cursor:pointer; font-family:inherit; font-weight:700; }

/* --- Formularios --- */
.tab-row{ display:flex; gap:.4rem; margin-bottom:1rem; background:var(--soft); padding:.25rem; border-radius:12px; }
.tab-btn{ flex:1; border:none; background:none; padding:.5rem; border-radius:9px; cursor:pointer; color:var(--muted); font-weight:700; font-family:inherit; }
.tab-btn-active{ background:var(--paper); color:var(--berry); box-shadow:0 0 0 1px var(--line) inset; }
.form-grid-1{ display:flex; flex-direction:column; gap:.65rem; }
.field-label{ font-size:.78rem; font-weight:700; color:var(--ink); margin:.4rem 0 -.2rem; }
.input{ width:100%; padding:.68rem .8rem; border:1px solid var(--line); border-radius:11px; font-family:inherit; font-size:.92rem; color:var(--ink); background:var(--paper); }
.input:focus{ border-color:var(--berry); }
.input-error{ border-color:var(--danger); background:var(--danger-bg); }
.error-text{ color:var(--danger); font-size:.85rem; margin:0; }
.field-error-text{ color:var(--danger); font-size:.78rem; margin:.25rem 0 0; font-weight:700; }
.textarea{ width:100%; padding:.68rem .8rem; border:1px solid var(--line); border-radius:11px; font-family:inherit; font-size:.92rem; color:var(--ink); background:var(--paper); resize:vertical; min-height:64px; }
.textarea:focus{ border-color:var(--berry); }
.muted{ color:var(--muted); font-size:.9rem; }
.btn-primary{ display:inline-flex; align-items:center; gap:.4rem; justify-content:center; background:var(--berry); color:#fff;
  border:none; border-radius:999px; padding:.75rem 1.4rem; font-weight:700; cursor:pointer; font-family:inherit; font-size:.92rem;
  box-shadow:0 9px 18px rgba(168,64,109,.24); }
.btn-primary:hover{ background:var(--berry-dark); }
.btn-ghost{ background:none; border:1px solid var(--line); color:var(--ink); border-radius:999px; padding:.4rem .8rem; cursor:pointer; font-family:inherit; font-size:.82rem; font-weight:600; }
.btn-ghost:hover{ border-color:var(--berry); color:var(--berry); }
.btn-ghost-danger{ background:none; border:1px solid var(--line); color:var(--danger); border-radius:999px; padding:.4rem .8rem; cursor:pointer; font-family:inherit; font-size:.82rem; font-weight:600; }
.btn-ghost-danger:hover{ border-color:var(--danger); }

/* --- Estructura de la app --- */
.app-frame{ display:flex; flex-direction:column; min-height:100vh; }
.appbar{ height:68px; flex-shrink:0; background:var(--paper); display:flex; align-items:center; padding:0 1.75rem;
  justify-content:space-between; border-bottom:1px solid var(--line); }
.profile{ display:flex; align-items:center; gap:.65rem; font-size:.85rem; color:var(--ink); }
.role-chip{ font-size:.66rem; background:var(--soft); color:var(--berry); padding:.22rem .6rem; border-radius:999px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
.avatar{ width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  background:#f1c5d2; color:var(--berry); font-weight:800; font-size:.85rem; flex-shrink:0; }
.shell{ display:flex; flex:1; min-height:0; }
.sidebar{ width:210px; flex-shrink:0; background:var(--paper); border-right:1px solid var(--line);
  padding:1.4rem 1rem; display:flex; flex-direction:column; gap:.3rem; }
.side-primary{ width:100%; border:0; padding:.72rem; border-radius:12px; background:#3a2735; color:#fff;
  margin-bottom:1rem; font-size:.85rem; font-weight:700; cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; gap:.4rem; }
.side-primary:hover{ background:#2a1c26; }
.side-nav{ display:flex; flex-direction:column; gap:.2rem; flex:1; }
.side-link{ display:flex; align-items:center; gap:.65rem; background:none; border:none; text-align:left;
  padding:.6rem .65rem; border-radius:11px; cursor:pointer; color:var(--muted); font-family:inherit; font-size:.87rem; font-weight:600; }
.side-link:hover{ background:var(--soft); color:var(--ink); }
.side-link-active{ background:#f7e5eb; color:var(--berry); font-weight:800; }
.side-logout{ color:var(--danger); margin-top:.5rem; }
.main{ flex:1; padding:1.9rem 2.2rem; overflow:auto; }
.main-subtitle{ color:var(--muted); font-size:.9rem; margin-bottom:1.1rem; }
.panel{ background:var(--paper); border:1px solid var(--line); border-radius:18px; padding:1.6rem; }
.section-title{ font-size:1.08rem; margin-bottom:.8rem; }

/* --- Reserva paso a paso --- */
.steps{ display:flex; gap:1.2rem; list-style:none; padding:0; margin:0 0 1.5rem; border-bottom:1px solid var(--line); padding-bottom:.9rem; }
.step{ color:var(--muted); font-size:.85rem; font-weight:700; }
.step-active{ color:var(--berry); }
.step-done{ color:var(--sage); }
.grid-cards{ display:flex; flex-direction:column; gap:1.3rem; }
.cat-title{ font-size:.95rem; font-weight:800; margin-bottom:.6rem; color:var(--gold); }
.service-list{ display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:.7rem; }
.service-card{ text-align:left; background:var(--soft); border:1px solid var(--line); border-radius:14px; padding:.9rem; cursor:pointer; }
.service-card:hover{ border-color:var(--berry); }
.service-name{ font-weight:800; margin-bottom:.25rem; }
.service-meta{ font-size:.82rem; color:var(--muted); }
.option-list{ display:flex; flex-direction:column; gap:.5rem; max-width:360px; }
.option-row{ text-align:left; background:var(--soft); border:1px solid var(--line); border-radius:12px; padding:.68rem .85rem; cursor:pointer; font-family:inherit; font-weight:600; }
.option-row-active{ border-color:var(--berry); background:#f7e5eb; color:var(--berry); }
.field-hint{ font-size:.88rem; color:var(--muted); margin-bottom:.9rem; }
.slot-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(76px,1fr)); gap:.5rem; max-width:520px; }
.slot-btn{ background:var(--soft); border:1px solid var(--line); border-radius:999px; padding:.55rem; cursor:pointer; font-family:inherit; font-weight:700; }
.slot-btn:hover{ border-color:var(--berry); color:var(--berry); }
.slot-btn-active{ background:var(--berry); color:#fff; border-color:var(--berry); }
.confirm-box{ max-width:360px; background:var(--soft); border:1px solid var(--line); border-radius:16px; padding:1.2rem; }
.confirm-box p{ margin:.15rem 0; }
.row-gap{ display:flex; gap:.6rem; margin-top:1rem; }
.empty-state{ text-align:center; padding:2.5rem 1rem; }
.empty-state p{ color:var(--muted); max-width:320px; margin:.5rem auto 1.25rem; }
.arch-icon{ width:56px;height:56px;border-radius:24px 24px 8px 8px; background:var(--berry); color:#fff;
  display:flex;align-items:center;justify-content:center; margin:0 auto 1rem; }

/* --- Calendario --- */
.cal{ background:var(--paper); }
.cal-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:.6rem; }
.cal-title{ font-weight:800; }
.icon-btn{ background:none; border:1px solid var(--line); border-radius:9px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--ink); }
.cal-grid{ display:grid; grid-template-columns:repeat(7,1fr); gap:.3rem; }
.cal-weekdays{ margin-bottom:.3rem; }
.cal-weekday{ text-align:center; font-size:.72rem; color:var(--muted); font-weight:700; }
.cal-cell{ aspect-ratio:1; display:flex; flex-direction:column; align-items:center; justify-content:center; border-radius:10px; }
.cal-empty{ background:none; }
.cal-day{ background:var(--soft); border:1px solid transparent; cursor:pointer; font-family:inherit; position:relative; }
.cal-day:hover{ border-color:var(--berry); }
.cal-day-today{ box-shadow:0 0 0 1px var(--gold) inset; }
.cal-day-selected{ background:var(--berry); border-radius:14px 14px 4px 4px; }
.cal-day-selected .cal-day-num{ color:#fff; }
.cal-day-disabled{ opacity:.35; cursor:not-allowed; }
.cal-day-num{ font-size:.85rem; font-weight:700; }
.cal-badge{ font-size:.62rem; background:var(--gold); color:#fff; border-radius:6px; padding:0 .3rem; margin-top:.1rem; }

/* --- Citas / listas --- */
.appt-list{ display:flex; flex-direction:column; gap:.55rem; }
.appt-row{ display:flex; align-items:center; justify-content:space-between; gap:.75rem; background:var(--soft);
  border:1px solid var(--line); border-radius:13px; padding:.8rem .95rem; flex-wrap:wrap; }
.appt-row-past{ opacity:.75; }
.appt-service{ font-weight:800; font-size:.93rem; color:var(--ink); }
.appt-meta{ font-size:.8rem; color:var(--muted); margin-top:.15rem; }
.appt-right{ display:flex; align-items:center; gap:.5rem; }
.tag{ font-size:.72rem; font-weight:800; padding:.22rem .6rem; border-radius:999px; }
.tag-confirmada{ background:#f7e4ed; color:var(--berry); }
.tag-pendiente{ background:var(--gold-bg); color:var(--gold-ink); }
.tag-rechazada{ background:var(--danger-bg); color:var(--danger); }
.tag-completada{ background:var(--gold-bg); color:var(--gold-ink); }
.tag-cancelada{ background:var(--danger-bg); color:var(--danger); }
.tag-admin{ background:var(--lilac-bg); color:var(--lilac); margin-left:.4rem; }
.tag-inactiva{ background:var(--soft); color:var(--muted); margin-left:.4rem; }

.promo-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:.9rem; }
.promo-card{ background:var(--soft); border:1px solid var(--line); border-radius:16px; overflow:hidden; display:flex; flex-direction:column; }
.promo-thumb{ width:100%; aspect-ratio:16/9; object-fit:cover; background:var(--line); display:block; }
.promo-body{ padding:.85rem .95rem 1rem; }
.promo-title{ font-weight:800; font-size:.95rem; color:var(--ink); }
.promo-desc{ font-size:.82rem; color:var(--muted); margin-top:.25rem; white-space:pre-wrap; }
.promo-actions{ display:flex; gap:.5rem; padding:0 .95rem .9rem; flex-wrap:wrap; }
.promo-strip{ margin-bottom:1.4rem; }
.promo-banner{ display:flex; align-items:center; justify-content:space-between; gap:.75rem; flex-wrap:wrap;
  background:var(--lilac-bg); color:var(--lilac); border-radius:13px; padding:.7rem 1rem; margin-bottom:1.1rem; font-size:.88rem; font-weight:700; }
.file-input-wrap{ display:flex; flex-direction:column; gap:.35rem; }
.promo-upload-preview{ width:100%; max-width:280px; border-radius:12px; margin-top:.5rem; display:block; }

/* --- Formularios admin --- */
.form-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:.6rem; margin-bottom:.8rem; }
.checkbox-row{ margin-bottom:.8rem; font-size:.88rem; }
.chip-row{ display:flex; flex-wrap:wrap; gap:.4rem; margin-bottom:.9rem; }
.chip{ border:1px solid var(--line); background:var(--soft); border-radius:999px; padding:.38rem .85rem; font-size:.8rem; cursor:pointer; font-family:inherit; font-weight:600; }
.chip-active{ background:var(--berry); border-color:var(--berry); color:#fff; }

/* --- Estadísticas --- */
.two-col{ display:grid; grid-template-columns:1fr 1fr; gap:1.5rem; }
.stat-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:.75rem; margin-bottom:.5rem; }
.stat-card{ background:var(--soft); border:1px solid var(--line); border-radius:14px; padding:1rem; text-align:center; }
.stat-num{ font-family:Georgia,serif; font-size:1.6rem; }
.stat-label{ font-size:.75rem; color:var(--muted); margin-top:.2rem; }
.tips-list{ display:flex; flex-direction:column; gap:.6rem; padding-left:1.1rem; margin:0; }
.tips-list li{ font-size:.9rem; line-height:1.45; }

/* --- Ventas / comprobante --- */
.filter-row{ display:flex; gap:.4rem; margin-bottom:1rem; flex-wrap:wrap; }
.summary-bar{ display:flex; gap:1.5rem; flex-wrap:wrap; background:var(--soft); border:1px solid var(--line); border-radius:12px; padding:.9rem 1.1rem; margin-bottom:1rem; }
.summary-item{ font-size:.85rem; color:var(--muted); }
.summary-item strong{ display:block; font-family:Georgia,serif; font-size:1.25rem; color:var(--ink); }
.consec{ font-family:Georgia,serif; font-weight:600; color:var(--gold); margin-right:.4rem; }
.report-head{ text-align:center; margin-bottom:1.1rem; }
.report-sub{ font-size:.95rem; font-weight:800; margin:0 0 .6rem; }
.modal-overlay{ position:fixed; inset:0; background:rgba(46,20,33,.45); display:flex; align-items:center; justify-content:center; z-index:80; padding:1rem; }
.modal-card{ background:var(--paper); border-radius:18px; padding:1.7rem; max-width:380px; width:100%; box-shadow:var(--shadow); max-height:90vh; overflow:auto; }
.receipt{ text-align:center; }
.receipt hr{ border:none; border-top:1px solid var(--line); margin:.9rem 0; }
.receipt p{ margin:.35rem 0; font-size:.92rem; text-align:left; }
.receipt-line{ display:flex; justify-content:space-between; gap:.6rem; }
.receipt-total{ font-size:1.25rem !important; margin-top:.8rem !important; text-align:center !important; }
.receipt-num{ color:var(--muted); font-size:.85rem; }

@media print {
  body *{ visibility:hidden; }
  .print-area, .print-area *{ visibility:visible; }
  .print-area{ position:absolute; top:0; left:0; width:100%; padding:2rem; }
  .no-print{ display:none !important; }
}

@media (max-width: 760px){
  .hero{ flex-direction:column; padding:3rem 6%; min-height:auto; gap:2rem; }
  .hero-card{ transform:none; width:100%; max-width:320px; }
  .login-box{ grid-template-columns:1fr; }
  .login-art{ display:none; }
  .shell{ flex-direction:column; }
  .sidebar{
    position:fixed; left:0; right:0; bottom:0; z-index:40;
    width:100%; flex-direction:row; align-items:stretch; gap:0;
    border-right:none; border-top:1px solid var(--line);
    background:var(--paper);
    padding:.3rem .3rem calc(.3rem + env(safe-area-inset-bottom, 0px));
    box-shadow:0 -10px 26px rgba(91,37,67,.16);
  }
  .side-primary{
    position:fixed; right:1rem; bottom:calc(72px + env(safe-area-inset-bottom, 0px)); z-index:41;
    width:56px; height:56px; padding:0; margin:0; border-radius:50%;
    background:linear-gradient(150deg,var(--berry),var(--berry-dark));
    box-shadow:0 12px 24px rgba(91,37,67,.38);
  }
  .side-primary span{ display:none; }
  .side-primary svg{ width:22px; height:22px; }
  .side-nav{ flex-direction:row; flex:1; gap:.1rem; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
  .side-nav::-webkit-scrollbar{ display:none; }
  .side-link{
    flex:0 0 auto; min-width:64px; flex-direction:column; justify-content:center; align-items:center; gap:.22rem;
    padding:.5rem .3rem; border-radius:14px; text-align:center;
  }
  .side-link span{ display:block; font-size:.63rem; font-weight:700; max-width:66px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .side-link svg{ width:22px; height:22px; }
  .side-link-active{ background:linear-gradient(160deg,#f8e3ec,#fbeddc); color:var(--berry); box-shadow:0 0 0 1px rgba(168,64,109,.12) inset; }
  .side-logout{ flex:0 0 auto; min-width:64px; flex-direction:column; gap:.22rem; margin-top:0; padding:.5rem .3rem; border-radius:14px; }
  .side-logout span{ display:block; font-size:.63rem; font-weight:700; }
  .side-logout svg{ width:22px; height:22px; }
  .brand-photo{ width:36px; height:36px; }
  .avatar{ width:38px; height:38px; font-size:1rem; }
  .main{ padding:1.1rem; padding-bottom:6.5rem; }
  .two-col{ grid-template-columns:1fr; }
  .form-grid{ grid-template-columns:1fr; }
  .stat-grid{ grid-template-columns:repeat(2,1fr); }
  .appbar{ padding:0 1rem; height:64px; }
  .profile span{ display:none; }
}

/* ====== Rediseño visual premium ====== */
.app-shell{
  --ink:#241b22;
  --muted:#786b75;
  --paper:rgba(255,255,255,.92);
  --soft:#f8f2f5;
  --line:#eadfe5;
  --berry:#a23c68;
  --berry-dark:#7f2c51;
  --rose:#e989a8;
  --gold:#c79a4b;
  background:
    radial-gradient(circle at 90% -10%, rgba(232,137,168,.20), transparent 30%),
    radial-gradient(circle at 10% 0%, rgba(199,154,75,.10), transparent 24%),
    #f7f3f5;
}
.app-shell button,.app-shell input,.app-shell textarea{transition:all .2s ease}
.app-shell ::selection{background:#f1c6d6;color:#5f2340}
.app-shell ::-webkit-scrollbar{width:9px;height:9px}
.app-shell ::-webkit-scrollbar-thumb{background:#d8c3cd;border-radius:99px}
.app-shell ::-webkit-scrollbar-track{background:transparent}

/* Welcome */
.hero{
  min-height:100vh;
  padding:clamp(2rem,6vw,5rem) clamp(1.2rem,7vw,7rem);
  background:
    radial-gradient(circle at 76% 18%, rgba(255,255,255,.85) 0 5%, transparent 24%),
    radial-gradient(circle at 15% 85%, rgba(255,255,255,.7), transparent 30%),
    linear-gradient(125deg,#fffafd 0%,#f8e1e9 53%,#f0dfcf 100%);
}
.hero-copy{max-width:570px}
.hero-copy h1{font-size:clamp(3rem,6vw,5.2rem);letter-spacing:-.035em;line-height:.92;text-wrap:balance}
.hero-copy>p{font-size:1.08rem;max-width:470px;color:#674d5b}
.hero-decor{width:560px;height:560px;right:-190px;bottom:-220px;opacity:.82;filter:blur(0);background:linear-gradient(135deg,#a23c68,#d98aa1 55%,#c79a4b)}
.hero-card{width:330px;padding:1rem;border-radius:28px;box-shadow:0 30px 80px rgba(91,37,67,.20);transform:rotate(4deg)}
.hero-photo{height:285px;border-radius:21px;background:linear-gradient(145deg,#8d3158,#d77f9e 55%,#d1aa62);padding:1.25rem}
.hero-card strong{font-size:1.25rem;margin-top:1.15rem}
.hero-card span{font-size:.85rem}
.choice-card{padding:1.15rem 1.25rem;border-radius:18px;background:rgba(255,255,255,.86);box-shadow:0 12px 30px rgba(91,37,67,.07);backdrop-filter:blur(8px)}
.choice-card:hover{transform:translateY(-3px);box-shadow:0 16px 35px rgba(91,37,67,.13);border-color:#d28aa5}

/* Login */
.login{background:radial-gradient(circle at 20% 20%,#fff,#f5e4eb 45%,#efe1d6)}
.login-box{max-width:980px;border-radius:30px;box-shadow:0 35px 90px rgba(73,32,54,.20);border:1px solid rgba(255,255,255,.8)}
.login-art{padding:3.3rem;background:linear-gradient(155deg,#7f2c51 0%,#a23c68 55%,#c97591 100%);position:relative;overflow:hidden}
.login-art:after{content:"";position:absolute;width:300px;height:300px;border-radius:50%;right:-130px;bottom:-140px;background:rgba(255,255,255,.10)}
.login-art h2{font-size:2.55rem;position:relative;z-index:1}
.login-form{padding:3.2rem}
.login-form h3.form-title{font-size:2rem}

/* Header + navigation */
.appbar{height:76px;padding:0 2rem;background:rgba(255,255,255,.88);backdrop-filter:blur(16px);box-shadow:0 1px 0 rgba(234,223,229,.9);position:sticky;top:0;z-index:30}
.brand-label{letter-spacing:.12em}
.brand-photo{width:34px;height:34px;box-shadow:0 5px 14px rgba(91,37,67,.16)}
.sidebar{width:235px;padding:1.5rem 1.1rem;background:rgba(255,255,255,.86);backdrop-filter:blur(15px);box-shadow:8px 0 30px rgba(91,37,67,.035)}
.side-primary{border-radius:15px;padding:.85rem 1rem;background:linear-gradient(135deg,#3d2736,#5a3047);box-shadow:0 10px 20px rgba(58,39,53,.16);margin-bottom:1.2rem}
.side-primary:hover{transform:translateY(-2px);box-shadow:0 13px 24px rgba(58,39,53,.22)}
.side-link{padding:.72rem .78rem;border-radius:13px}
.side-link:hover{transform:translateX(2px)}
.side-link-active{background:linear-gradient(135deg,#f8e2eb,#fbf0e8);box-shadow:inset 0 0 0 1px rgba(162,60,104,.08)}
.main{padding:2.1rem 2.4rem;max-width:1600px;width:100%;margin:0 auto}

/* Cards / panels */
.panel{background:rgba(255,255,255,.92);border:1px solid rgba(234,223,229,.95);border-radius:22px;padding:1.75rem;box-shadow:0 12px 35px rgba(91,37,67,.055);backdrop-filter:blur(8px)}
.panel+.panel{margin-top:1rem}
.section-title{font-size:1.2rem}
.stat-card{background:linear-gradient(145deg,#fff,#f9f0f4);border-radius:17px;padding:1.15rem;box-shadow:0 8px 20px rgba(91,37,67,.05)}
.stat-num{font-size:1.8rem;color:#3a2735}

/* Controls */
.input,.textarea{background:#fff;border-color:#e6d9e0;border-radius:13px;box-shadow:0 2px 8px rgba(91,37,67,.025)}
.input:hover,.textarea:hover{border-color:#d7b4c4}
.input:focus,.textarea:focus{border-color:var(--berry);box-shadow:0 0 0 4px rgba(162,60,104,.10)}
.btn-primary{padding:.82rem 1.5rem;background:linear-gradient(135deg,#a23c68,#8a3157);box-shadow:0 10px 22px rgba(162,60,104,.25)}
.btn-primary:hover{background:linear-gradient(135deg,#8f315b,#762646);transform:translateY(-1px);box-shadow:0 13px 26px rgba(162,60,104,.30)}
.btn-ghost{background:#fff}
.btn-ghost:hover{background:#fbf2f6;transform:translateY(-1px)}
.tab-row{border:1px solid var(--line);box-shadow:inset 0 1px 2px rgba(91,37,67,.04)}
.tab-btn-active{background:#fff;box-shadow:0 4px 12px rgba(91,37,67,.08)}

/* Booking / service cards */
.service-card,.option-row,.slot-btn,.appt-row{background:linear-gradient(145deg,#fff,#faf4f7);box-shadow:0 6px 16px rgba(91,37,67,.04)}
.service-card{border-radius:17px;padding:1rem}
.service-card:hover{transform:translateY(-3px);box-shadow:0 12px 24px rgba(91,37,67,.10);border-color:#d89ab1}
.slot-btn:hover{transform:translateY(-2px);box-shadow:0 7px 14px rgba(91,37,67,.08)}
.slot-btn-active{box-shadow:0 8px 18px rgba(162,60,104,.22)}
.confirm-box{background:linear-gradient(145deg,#fff,#f9eef3);box-shadow:0 10px 25px rgba(91,37,67,.06)}

/* Calendar */
.cal{background:transparent}
.cal-day{background:#fff;border-color:#eee3e8;box-shadow:0 2px 6px rgba(91,37,67,.025)}
.cal-day:hover{transform:translateY(-1px);box-shadow:0 6px 12px rgba(91,37,67,.08)}
.cal-day-selected{background:linear-gradient(145deg,#a23c68,#8b3158);box-shadow:0 8px 16px rgba(162,60,104,.24)}
.cal-badge{box-shadow:0 2px 5px rgba(91,37,67,.12)}

/* Lists / promotions */
.appt-row{border-radius:15px}
.appt-row:hover{transform:translateY(-1px);box-shadow:0 8px 18px rgba(91,37,67,.07)}
.promo-card{border-radius:18px;background:#fff;box-shadow:0 9px 24px rgba(91,37,67,.06)}
.promo-thumb{background:#f1e4ea}
.summary-bar{background:linear-gradient(135deg,#fbf1f5,#fff);box-shadow:0 5px 16px rgba(91,37,67,.04)}

/* Small polish */
.icon-btn:hover{background:#fbf1f5;border-color:#d8b7c5;color:var(--berry);transform:translateY(-1px)}
.chip:hover{border-color:#d29ab0}
.chip-active{box-shadow:0 6px 14px rgba(162,60,104,.18)}
.modal-card{border-radius:24px;box-shadow:0 35px 90px rgba(46,20,33,.25)}

@media (max-width:900px){
  .hero{gap:2rem}.hero-card{width:290px}.sidebar{width:205px}.main{padding:1.5rem}
}
@media (max-width:760px){
  .hero{padding:2.3rem 1.1rem 7rem;min-height:100vh}
  .hero-copy h1{font-size:3.2rem}
  .hero-card{width:min(330px,92vw);transform:none}
  .appbar{height:66px;padding:0 1rem}
  .main{padding:1rem .85rem 7rem}
  .panel{border-radius:18px;padding:1.2rem}
}

/* ================= NUEVO DISEÑO VISUAL — BELLASTUDIO ================= */
.app-shell{background:#f6f2f5;color:#302630}
.app-frame{background:linear-gradient(135deg,#f8f4f7 0%,#f4eef3 100%)}
.appbar{height:78px;padding:0 2.2rem;background:rgba(255,255,255,.94);border-bottom:1px solid #eadde5;box-shadow:0 8px 28px rgba(83,42,64,.07);backdrop-filter:blur(18px)}
.brand-label{font-size:.8rem;letter-spacing:.18em;color:#9b3c68}
.brand-photo{width:40px;height:40px;border:3px solid #fff;box-shadow:0 6px 18px rgba(155,60,104,.20)}
.profile{gap:.8rem}.profile > span:first-child{font-weight:700;color:#51434d}
.role-chip{background:#f8e5ee;color:#a33e6b;padding:.32rem .7rem}
.avatar{width:40px;height:40px;background:linear-gradient(135deg,#f2bfd2,#e99bb8);color:#8d3159;box-shadow:0 5px 14px rgba(155,60,104,.15)}
.shell{gap:0}
.sidebar{width:245px;padding:1.4rem 1rem;background:linear-gradient(180deg,#4b263b 0%,#351f2d 100%);border-right:0;box-shadow:10px 0 30px rgba(50,25,40,.13)}
.sidebar:before{content:"BELLEZA · AGENDA · CLIENTAS";display:block;color:#dcb2c5;font-size:.62rem;letter-spacing:.16em;font-weight:800;padding:.15rem .75rem 1.1rem}
.side-primary{background:linear-gradient(135deg,#d86693,#b84472);border:1px solid rgba(255,255,255,.16);border-radius:14px;box-shadow:0 12px 24px rgba(0,0,0,.18)}
.side-primary:hover{background:linear-gradient(135deg,#e0729d,#bd4b79)}
.side-link{color:#ddcbd4;border-radius:13px;padding:.76rem .8rem;margin:.08rem 0}.side-link svg{color:#d9afc0}
.side-link:hover{background:rgba(255,255,255,.09);color:#fff;transform:translateX(3px)}.side-link:hover svg{color:#f1c3d4}
.side-link-active{background:linear-gradient(90deg,rgba(226,101,148,.25),rgba(255,255,255,.07));color:#fff;box-shadow:inset 3px 0 #e978a2}.side-link-active svg{color:#f3a6c1}
.side-logout{color:#e6a6ba;margin-top:auto}
.main{padding:2rem 2.4rem;background:radial-gradient(circle at 95% 0%,rgba(226,119,159,.12),transparent 25%),linear-gradient(135deg,#f8f5f7,#f4eef3)}
.main:before{content:"";display:block;height:4px;width:64px;border-radius:10px;background:linear-gradient(90deg,#bd4d79,#e49a55);margin-bottom:1rem}
.panel{background:rgba(255,255,255,.96);border:1px solid #eadfe5;border-radius:24px;padding:1.7rem;box-shadow:0 18px 45px rgba(78,39,59,.075)}
.section-title{font-size:1.22rem;color:#352936}.main-subtitle{color:#887783}
.cal{background:transparent;padding:.2rem}.cal-head{margin-bottom:1rem}.cal-title{font-family:Georgia,serif;font-size:1.12rem;color:#352936}
.icon-btn{width:36px;height:36px;border-radius:12px;background:#fff;border:1px solid #eadde5;box-shadow:0 4px 12px rgba(78,39,59,.06)}.icon-btn:hover{background:#fbecf3;color:#a33e6b}
.cal-grid{gap:.55rem}.cal-weekday{color:#9a8993;font-size:.7rem;letter-spacing:.04em;text-transform:uppercase}.cal-cell{border-radius:14px}
.cal-day{min-height:58px;background:#fff;border:1px solid #eee4e9;box-shadow:0 5px 12px rgba(78,39,59,.045);transition:.18s ease}.cal-day:hover{border-color:#d98baa;box-shadow:0 10px 18px rgba(163,62,107,.11);transform:translateY(-2px)}
.cal-day-num{font-size:.9rem;color:#3e323a}.cal-day-today{box-shadow:inset 0 0 0 2px #d5a24b}.cal-day-selected{background:linear-gradient(145deg,#b54475,#8f2f5b);border-color:#a63b69;box-shadow:0 12px 22px rgba(143,47,91,.28)}.cal-day-selected .cal-day-num{color:#fff}.cal-badge{background:#d8a24b}
.btn-primary{background:linear-gradient(135deg,#b74476,#8f2f5b);border-radius:13px;padding:.82rem 1.45rem;box-shadow:0 10px 22px rgba(143,47,91,.23)}.btn-primary:hover{background:linear-gradient(135deg,#c54e7e,#7e264d)}
.input,.textarea{border-radius:13px;background:#fff;border-color:#e5d8e0}.input:focus,.textarea:focus{box-shadow:0 0 0 4px rgba(183,68,118,.10)}
.service-card,.option-row,.slot-btn,.appt-row,.stat-card{background:#fff;border-color:#eadfe5;box-shadow:0 7px 18px rgba(78,39,59,.055)}.service-card{border-radius:18px}.service-card:hover{transform:translateY(-4px);box-shadow:0 15px 26px rgba(78,39,59,.11)}
.appt-row{border-radius:17px}.appt-row:hover{box-shadow:0 10px 22px rgba(78,39,59,.09)}.stat-card{border-radius:18px}.stat-num{color:#8f2f5b}
.empty-state{min-height:300px;display:flex;flex-direction:column;align-items:center;justify-content:center}.arch-icon{background:linear-gradient(145deg,#b74476,#8f2f5b);box-shadow:0 12px 24px rgba(143,47,91,.22)}
.promo-card{border-radius:20px;box-shadow:0 12px 28px rgba(78,39,59,.075)}.promo-banner{background:linear-gradient(90deg,#f9e7ef,#f9f0df);border:1px solid #efdae4}
@media(max-width:760px){.appbar{height:68px;padding:0 1rem}.sidebar{width:100%;background:#3b2231;padding:.3rem .3rem calc(.3rem + env(safe-area-inset-bottom,0px))}.sidebar:before{display:none}.side-link{color:#806f7d}.side-link-active{color:#a33e6b;background:#f8e5ee;box-shadow:none}.main{padding:1rem .85rem 7rem}.main:before{display:none}.cal-day{min-height:48px}}

`;

/* ---------------------------------- Calendario ---------------------------------- */

function MonthCalendar({ year, month, selectedDate, onSelect, minDateISO, renderBadge, onMonthChange, isDateDisabled }) {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function go(delta) {
    let m = month + delta, y = year;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    onMonthChange(y, m);
  }

  return (
    <div className="cal">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => go(-1)} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
        <span className="cal-title">{MONTHS[month]} {year}</span>
        <button className="icon-btn" onClick={() => go(1)} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
      </div>
      <div className="cal-grid cal-weekdays">
        {WEEKDAYS.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="cal-cell cal-empty" />;
          const iso = `${year}-${pad2(month + 1)}-${pad2(d)}`;
          const disabled = (minDateISO ? iso < minDateISO : false) || (isDateDisabled ? isDateDisabled(iso) : false);
          const isSelected = iso === selectedDate;
          const isToday = iso === todayISO();
          return (
            <button
              key={i}
              disabled={disabled}
              onClick={() => onSelect(iso)}
              className={`cal-cell cal-day ${isSelected ? "cal-day-selected" : ""} ${isToday ? "cal-day-today" : ""} ${disabled ? "cal-day-disabled" : ""}`}
            >
              <span className="cal-day-num">{d}</span>
              {renderBadge ? renderBadge(iso) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------- Shell (layout con sidebar) ---------------------------------- */

function Shell({ title, personName, roleLabel, nav, active, onNav, onLogout, primaryAction, children }) {
  return (
    <div className="app-frame">
      <header className="appbar">
        <div className="brand-label">
          <span className="brand-photo"><img src={LOGO_SRC} alt="" /></span>
          {title}
        </div>
        <div className="profile">
          <span>Hola, {personName}</span>
          <span className="role-chip">{roleLabel}</span>
          <div className="avatar">{initialOf(personName)}</div>
        </div>
      </header>
      <div className="shell">
        <aside className="sidebar">
          {primaryAction && (
            <button className="side-primary" type="button" onClick={primaryAction.onClick}>
              <Plus size={15} /> <span>{primaryAction.label}</span>
            </button>
          )}
          <nav className="side-nav">
            {nav.map((item) => (
              <button
                key={item.key}
                className={`side-link ${active === item.key ? "side-link-active" : ""}`}
                onClick={() => onNav(item.key)}
              >
                <item.icon size={16} /><span>{item.label}</span>
              </button>
            ))}
          </nav>
          <button className="side-link side-logout" onClick={onLogout}>
            <LogOut size={16} /><span>Salir</span>
          </button>
        </aside>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}

/* ---------------------------------- Autenticación ---------------------------------- */

function LoginSplit({ eyebrow, title, quote, onBack, children }) {
  return (
    <div className="login">
      <div className="login-box">
        <div className="login-art">
          <div>
            <div className="brand-label light">
              <span className="brand-photo"><img src={LOGO_SRC} alt="" /></span>
              BellaStudio
            </div>
            <h2>{title}</h2>
          </div>
          <div className="quote">&ldquo;{quote}&rdquo;</div>
        </div>
        <div className="login-form">
          <div className="brand-label">{eyebrow}</div>
          {children}
          <button className="back-link" type="button" onClick={onBack}>&larr; Volver a bienvenida</button>
        </div>
      </div>
    </div>
  );
}

function ClientAuthFields({ data, persist, onAuth }) {
  const [tab, setTab] = useState("ingresar");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const [recoverPhone, setRecoverPhone] = useState("");
  const [newPin, setNewPin] = useState("");
  const [recoverError, setRecoverError] = useState("");
  const [recoverOk, setRecoverOk] = useState(false);

  function register() {
    if (!name.trim() || !email.trim() || pin.length !== 4) {
      setError("Completa nombre, correo y un PIN de 4 dígitos.");
      return;
    }
    if (data.clients.some((c) => c.email.toLowerCase() === email.trim().toLowerCase())) {
      setError("Ya existe una cuenta con ese correo. Intenta ingresar.");
      return;
    }
    const client = { id: uid(), name: name.trim(), phone: phone.trim(), email: email.trim().toLowerCase(), pin };
    onAuth(client, true);
  }
  function login() {
    const found = data.clients.find((c) => c.email.toLowerCase() === email.trim().toLowerCase() && c.pin === pin);
    if (!found) { setError("Correo o PIN incorrectos."); return; }
    onAuth(found, false);
  }
  async function recoverPin() {
    setRecoverError(""); setRecoverOk(false);
    if (!email.trim() || !recoverPhone.trim() || newPin.length !== 4) {
      setRecoverError("Completa tu correo, tu teléfono registrado y un nuevo PIN de 4 dígitos.");
      return;
    }
    const found = data.clients.find(
      (c) => c.email.toLowerCase() === email.trim().toLowerCase() && (c.phone || "").replace(/\D/g, "") === recoverPhone.replace(/\D/g, "")
    );
    if (!found) {
      setRecoverError("No encontramos una cuenta con ese correo y ese teléfono juntos.");
      return;
    }
    const updated = { ...found, pin: newPin };
    const ok = await persist({ ...data, clients: data.clients.map((c) => (c.id === found.id ? updated : c)) });
    if (ok === false) {
      setRecoverError("No se pudo cambiar el PIN: problema de conexión con el servidor. Intenta de nuevo.");
      return;
    }
    setRecoverOk(true);
    setPin(""); setRecoverPhone(""); setNewPin("");
  }

  return (
    <>
      <h3 className="form-title">
        {tab === "ingresar" ? "Inicia sesión" : tab === "registro" ? "Crea tu cuenta" : "Recupera tu PIN"}
      </h3>
      <p className="form-sub">Reserva y gestiona tus citas de uñas y keratina en un solo lugar.</p>
      <div className="tab-row">
        <button className={`tab-btn ${tab === "ingresar" ? "tab-btn-active" : ""}`} onClick={() => setTab("ingresar")}>Ingresar</button>
        <button className={`tab-btn ${tab === "registro" ? "tab-btn-active" : ""}`} onClick={() => setTab("registro")}>Crear cuenta</button>
      </div>
      {tab === "registro" && (
        <div className="form-grid-1">
          <input className="input" placeholder="Nombre completo" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input className="input" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" placeholder="Crea un PIN de 4 dígitos" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          {error && <p className="error-text">{error}</p>}
          <button className="btn-primary" onClick={register}>Crear cuenta y entrar</button>
        </div>
      )}
      {tab === "ingresar" && (
        <div className="form-grid-1">
          <input className="input" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" placeholder="PIN de 4 dígitos" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          {error && <p className="error-text">{error}</p>}
          <button className="btn-primary" onClick={login}>Entrar</button>
          <button className="back-link" type="button" style={{ marginTop: ".2rem" }} onClick={() => { setRecoverError(""); setRecoverOk(false); setTab("recuperar"); }}>
            ¿Olvidaste tu PIN?
          </button>
        </div>
      )}
      {tab === "recuperar" && (
        <div className="form-grid-1">
          {recoverOk ? (
            <>
              <p className="muted">Tu PIN se actualizó correctamente. Ya puedes ingresar con tu nuevo PIN.</p>
              <button className="btn-primary" onClick={() => setTab("ingresar")}>Ir a ingresar</button>
            </>
          ) : (
            <>
              <p className="field-hint">Para confirmar que eres tú, escribe el correo y el teléfono con los que te registraste.</p>
              <input className="input" placeholder="Correo con el que te registraste" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className="input" placeholder="Teléfono con el que te registraste" value={recoverPhone} onChange={(e) => setRecoverPhone(e.target.value)} />
              <input className="input" placeholder="Nuevo PIN de 4 dígitos" maxLength={4} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} />
              {recoverError && <p className="error-text">{recoverError}</p>}
              <button className="btn-primary" onClick={recoverPin}>Cambiar mi PIN</button>
            </>
          )}
        </div>
      )}
    </>
  );
}

function TeamAuthFields({ data, onAuth }) {
  const hasTeam = data.employees.length > 0;
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  function setupAdmin() {
    if (!name.trim() || pin.length !== 4) { setError("Escribe tu nombre y un PIN de 4 dígitos."); return; }
    const admin = {
      id: uid(), name: name.trim(), pin, isAdmin: true, active: true,
      serviceIds: data.services.map((s) => s.id),
    };
    onAuth(admin, true);
  }
  function login() {
    const found = data.employees.find(
      (e) => e.active && e.name.toLowerCase() === name.trim().toLowerCase() && e.pin === pin
    );
    if (!found) { setError("Nombre o PIN incorrectos."); return; }
    onAuth(found, false);
  }

  if (!hasTeam) {
    return (
      <>
        <h3 className="form-title">Configura tu administración</h3>
        <p className="form-sub">Eres la primera persona en entrar: esta cuenta va a tener permisos sobre todo el negocio.</p>
        <div className="form-grid-1">
          <input className="input" placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Crea un PIN de 4 dígitos" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          {error && <p className="error-text">{error}</p>}
          <button className="btn-primary" onClick={setupAdmin}>Crear cuenta y entrar</button>
        </div>
      </>
    );
  }
  return (
    <>
      <h3 className="form-title">Ingreso del equipo</h3>
      <p className="form-sub">Gestiona tu agenda y tus clientas desde un solo lugar.</p>
      <div className="form-grid-1">
        <input className="input" placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="PIN de 4 dígitos" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        {error && <p className="error-text">{error}</p>}
        <button className="btn-primary" onClick={login}>Entrar</button>
      </div>
    </>
  );
}

function AuthScreen({ data, persist, businessName, onClientAuth, onTeamAuth, onLeaveCompany }) {
  const [mode, setMode] = useState("elegir");

  if (mode === "cliente") {
    return (
      <LoginSplit
        eyebrow="Bienvenida de nuevo"
        title={<>Tu cita.<br />Tu momento.<br />Tu mejor versión.</>}
        quote="Cada cita es una oportunidad para que alguien se sienta espectacular."
        onBack={() => setMode("elegir")}
      >
        <ClientAuthFields data={data} persist={persist} onAuth={onClientAuth} />
      </LoginSplit>
    );
  }
  if (mode === "equipo") {
    return (
      <LoginSplit
        eyebrow="Panel del equipo"
        title={<>Tu cabina.<br />Tu ritmo.<br />Tu éxito.</>}
        quote="Cada cita es una oportunidad para que alguien se sienta espectacular."
        onBack={() => setMode("elegir")}
      >
        <TeamAuthFields data={data} onAuth={onTeamAuth} />
      </LoginSplit>
    );
  }

  return (
    <div className="hero">
      <div className="hero-decor" aria-hidden="true" />
      <div className="hero-copy">
        <div className="brand-label">
          <span className="brand-photo"><img src={LOGO_SRC} alt="" /></span>
          {businessName}
        </div>
        <h1>Tu talento,<br />bien agendado.</h1>
        <p>Reservas, agenda y clientas de uñas y keratina, todo en un solo lugar.</p>
        <div className="auth-choice">
          <button className="choice-card" onClick={() => setMode("cliente")}>
            <User size={20} />
            <div>
              <div className="choice-title">Soy cliente o clienta</div>
              <div className="choice-sub">Reservar una cita o ver las mías</div>
            </div>
          </button>
          <button className="choice-card" onClick={() => setMode("equipo")}>
            <Users size={20} />
            <div>
              <div className="choice-title">Soy del equipo</div>
              <div className="choice-sub">Agenda, servicios y administración</div>
            </div>
          </button>
        </div>
        {onLeaveCompany && (
          <button className="back-link" style={{ marginTop: "1.4rem" }} type="button" onClick={onLeaveCompany}>
            &larr; No es mi empresa, cambiar código
          </button>
        )}
      </div>
      <div className="hero-card" aria-label="Tarjeta de servicios de belleza">
        <div className="hero-photo"><img src={LOGO_SRC} alt="BellaStudio" /></div>
        <strong>Manos que cuentan historias</strong>
        <span>Uñas · Keratina · Cuidado personal</span>
      </div>
    </div>
  );
}

/* ---------------------------------- Vista clienta: reservar ---------------------------------- */

function BookingWizard({ data, persist, clientId, onBooked, promo, onClearPromo }) {
  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState(null);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(null);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [slot, setSlot] = useState(null);
  const [done, setDone] = useState(false);
  const [appliedPromoId, setAppliedPromoId] = useState(null);

  const promoServiceIdList = promo ? promoServiceIds(promo) : [];

  useEffect(() => {
    if (promo && promo.id !== appliedPromoId) {
      const ids = promoServiceIds(promo);
      setEmployeeId(""); setDate(null); setSlot(null); setDone(false);
      if (ids.length === 1) {
        setServiceId(ids[0]);
        setStep(2);
      } else {
        setServiceId(null);
        setStep(1);
      }
      setAppliedPromoId(promo.id);
    }
  }, [promo, appliedPromoId]);

  const service = data.services.find((s) => s.id === serviceId);
  const promoServiceOk = !!(promo && promoServiceIdList.includes(serviceId));
  const promoDateOk = !date || promoDateAllowed(promo, date);
  const promoApplies = promoServiceOk && promoDateOk;
  const effectivePrice = promoApplies && promo.price != null ? promo.price : service?.price;
  const eligibleEmployees = data.employees.filter((e) => e.active && e.serviceIds.includes(serviceId));

  function candidatesFor(empId) {
    return empId ? eligibleEmployees.filter((e) => e.id === empId) : eligibleEmployees;
  }

  function isFree(empId, dateISO, startMin, duration) {
    const end = startMin + duration;
    return !data.appointments.some((a) => {
      if (a.employeeId !== empId || a.date !== dateISO || (a.status === "cancelada" || a.status === "rechazada")) return false;
      const aStart = timeToMin(a.time);
      const aEnd = aStart + a.duration;
      return startMin < aEnd && end > aStart;
    });
  }

  function availableSlotsFor(dateISO) {
    if (!service) return [];
    const extendedOn = data.extendedHoursEnabled !== false;
    const out = [];
    for (let m = OPEN_START_MIN; m + service.duration <= OPEN_END_MIN; m += SLOT_STEP_MIN) {
      if (isExtendedSlot(m) && !extendedOn) continue;
      const cands = candidatesFor(employeeId).filter((e) => employeeWorksOn(e, dateISO) && isFree(e.id, dateISO, m, service.duration));
      if (cands.length > 0) out.push({ time: minToTime(m), employeeId: cands[0].id, employeeName: cands[0].name });
    }
    return out;
  }

  function clearPromo() {
    setAppliedPromoId(null);
    onClearPromo?.();
  }

  async function confirmBooking() {
    const pending = isExtendedSlot(timeToMin(slot.time));
    const appt = {
      id: uid(), clientId, employeeId: slot.employeeId, serviceId,
      serviceName: service.name, price: effectivePrice, duration: service.duration,
      date, time: slot.time, status: pending ? "pendiente" : "confirmada", createdAt: Date.now(),
      promoId: promoApplies ? promo.id : null, promoTitle: promoApplies ? promo.title : null,
    };
    const ok = await persist({ ...data, appointments: [...data.appointments, appt] });
    if (ok === false) {
      window.alert("No se pudo agendar la cita: hubo un problema de conexión con el servidor. Intenta de nuevo.");
      return;
    }
    setDone(true);
  }

  function restart() {
    setStep(1); setServiceId(null); setEmployeeId(""); setDate(null); setSlot(null); setDone(false);
    clearPromo();
  }

  if (done) {
    const wasPending = isExtendedSlot(timeToMin(slot.time));
    return (
      <div className="panel empty-state">
        <div className="arch-icon"><Check size={22} /></div>
        <h3>{wasPending ? "Solicitud enviada" : "Cita confirmada"}</h3>
        <p>
          {wasPending
            ? `Tu cita de ${service?.name} para el ${date} a las ${slot?.time} es en horario especial, así que queda pendiente de aprobación. Te avisaremos cuando la administradora la confirme — la puedes ver desde "Mis citas".`
            : `Tu cita de ${service?.name} quedó agendada para el ${date} a las ${slot?.time}. La puedes ver o cancelar desde "Mis citas".`}
        </p>
        <button className="btn-primary" onClick={() => { restart(); onBooked(); }}>Ver mis citas</button>
      </div>
    );
  }

  return (
    <div className="panel">
      {promoApplies && (
        <div className="promo-banner">
          <span>Reservando con la promoción <strong>{promo.title}</strong>{promo.price != null && <> · precio especial {money(promo.price)}</>}</span>
          <button className="btn-ghost" onClick={() => { setServiceId(null); setStep(1); clearPromo(); }}>Quitar promoción</button>
        </div>
      )}
      <ol className="steps">
        {["Servicio", "Profesional", "Fecha", "Hora"].map((s, i) => (
          <li key={s} className={`step ${step === i + 1 ? "step-active" : ""} ${step > i + 1 ? "step-done" : ""}`}>{s}</li>
        ))}
      </ol>

      {step === 1 && (
        <div className="grid-cards">
          {promo && promoServiceIdList.length > 1 && (
            <div className="promo-banner">
              <span>Elige uno de los servicios en promoción <strong>{promo.title}</strong>{promo.price != null && <> · precio especial {money(promo.price)}</>}</span>
              <button className="btn-ghost" onClick={clearPromo}>Ver todos los servicios</button>
            </div>
          )}
          {CATEGORIES.map((cat) => {
            const items = data.services.filter((s) => s.category === cat && (!promo || promoServiceIdList.length === 0 || promoServiceIdList.includes(s.id)));
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <h4 className="cat-title">{cat}</h4>
                <div className="service-list">
                  {items.map((s) => (
                    <button key={s.id} className="service-card" onClick={() => { setServiceId(s.id); setStep(2); }}>
                      <div className="service-name">{s.name}</div>
                      <div className="service-meta">{s.duration} min · {money(s.price)}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {step === 2 && (
        <div>
          <button className="back-link" onClick={() => setStep(1)}>&larr; Cambiar servicio</button>
          <p className="field-hint">Servicio: <strong>{service?.name}</strong>{promoApplies && promo.price != null && <> · {money(promo.price)} (promoción)</>}</p>
          {eligibleEmployees.length === 0 ? (
            <p className="muted">Todavía no hay ninguna profesional asignada a "{service?.name}", por eso no aparecen horarios disponibles. Pídele a la administradora que asigne este servicio a alguien del equipo (en "Equipo → editar profesional").</p>
          ) : (
            <div className="option-list">
              <button className={`option-row ${employeeId === "" ? "option-row-active" : ""}`} onClick={() => { setEmployeeId(""); setStep(3); }}>
                Cualquiera disponible
              </button>
              {eligibleEmployees.map((e) => (
                <button key={e.id} className={`option-row ${employeeId === e.id ? "option-row-active" : ""}`} onClick={() => { setEmployeeId(e.id); setStep(3); }}>
                  {e.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <button className="back-link" onClick={() => setStep(2)}>&larr; Cambiar profesional</button>
          {promoServiceOk && promo.weekday !== null && promo.weekday !== undefined && promo.weekday !== "" && (
            <p className="field-hint">Esta promoción aplica solo los {WEEKDAYS_FULL[Number(promo.weekday)].toLowerCase()}s{promo.validFrom ? ` (del ${promo.validFrom}${promo.validTo ? ` al ${promo.validTo}` : ""})` : ""}. Elige uno de esos días para el precio especial.</p>
          )}
          <MonthCalendar
            year={calYear} month={calMonth} selectedDate={date}
            minDateISO={todayISO()}
            isDateDisabled={(iso) => {
              if (promoServiceOk && !promoDateAllowed(promo, iso)) return true;
              const pool = candidatesFor(employeeId);
              if (pool.length > 0 && !pool.some((e) => employeeWorksOn(e, iso))) return true;
              return false;
            }}
            onMonthChange={(y, m) => { setCalYear(y); setCalMonth(m); }}
            onSelect={(iso) => { setDate(iso); setSlot(null); setStep(4); }}
          />
        </div>
      )}

      {step === 4 && !slot && (
        <div>
          <button className="back-link" onClick={() => setStep(3)}>&larr; Cambiar fecha</button>
          <p className="field-hint">{date} · {service?.name}</p>
          <div className="slot-grid">
            {availableSlotsFor(date).map((s) => (
              <button key={s.time} className="slot-btn" onClick={() => setSlot(s)}>
                {s.time}{isExtendedSlot(timeToMin(s.time)) ? " *" : ""}
              </button>
            ))}
            {availableSlotsFor(date).length === 0 && <p className="muted">No hay horarios disponibles ese día. Prueba otra fecha.</p>}
          </div>
          {availableSlotsFor(date).some((s) => isExtendedSlot(timeToMin(s.time))) && (
            <p className="field-hint" style={{ marginTop: ".7rem" }}>* Horario especial (antes de 9am o después de 6pm): la cita queda pendiente de aprobación en vez de confirmarse al instante.</p>
          )}
        </div>
      )}

      {step === 4 && slot && (
        <div className="confirm-box">
          <h4>Confirma tu cita</h4>
          <p><strong>{service?.name}</strong></p>
          <p>{date} a las {slot.time}</p>
          <p>Con {slot.employeeName}</p>
          <p>{money(effectivePrice)}{promoApplies && <span className="tag tag-admin" style={{ marginLeft: ".4rem" }}>promoción</span>}</p>
          {isExtendedSlot(timeToMin(slot.time)) && (
            <p className="muted">Este horario es especial, así que quedará pendiente de aprobación en vez de confirmarse de inmediato.</p>
          )}
          <div className="row-gap">
            <button className="btn-ghost" onClick={() => setSlot(null)}>Elegir otra hora</button>
            <button className="btn-primary" onClick={confirmBooking}>Confirmar reserva</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MyAppointments({ data, persist, clientId }) {
  const mine = data.appointments
    .filter((a) => a.clientId === clientId)
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
  const now = todayISO();
  const upcoming = mine.filter((a) => a.date >= now && a.status !== "cancelada" && a.status !== "rechazada");
  const past = mine.filter((a) => a.date < now || a.status === "cancelada" || a.status === "rechazada");

  const [reagendarId, setReagendarId] = useState(null);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [reDate, setReDate] = useState(null);

  const cancelMinHours = data.cancelMinHours != null ? Number(data.cancelMinHours) : 3;
  const contactPhone = data.employees.find((e) => e.isAdmin && e.phone)?.phone;

  function hoursUntil(a) {
    const start = fromISO(a.date);
    const [h, m] = a.time.split(":").map(Number);
    start.setHours(h, m, 0, 0);
    return (start.getTime() - Date.now()) / 3600000;
  }

  async function cancel(a) {
    if (a.status !== "pendiente" && hoursUntil(a) < cancelMinHours) {
      window.alert(
        `Esta cita es en menos de ${cancelMinHours} horas, así que ya no se puede cancelar desde aquí.` +
        (contactPhone ? ` Escríbenos directamente al ${contactPhone} si de verdad no puedes venir.` : " Contacta directamente al salón si de verdad no puedes venir.")
      );
      return;
    }
    await persist({ ...data, appointments: data.appointments.map((x) => (x.id === a.id ? { ...x, status: "cancelada" } : x)) });
  }
  function employeeName(id) { return data.employees.find((e) => e.id === id)?.name || "—"; }
  function serviceDuration(a) { return data.services.find((s) => s.id === a.serviceId)?.duration || a.duration; }

  function isFreeExcluding(empId, dateISO, startMin, duration, excludeId) {
    const end = startMin + duration;
    return !data.appointments.some((x) => {
      if (x.id === excludeId) return false;
      if (x.employeeId !== empId || x.date !== dateISO || (x.status === "cancelada" || x.status === "rechazada")) return false;
      const xStart = timeToMin(x.time);
      const xEnd = xStart + x.duration;
      return startMin < xEnd && end > xStart;
    });
  }

  function slotsFor(a, dateISO) {
    const emp = data.employees.find((e) => e.id === a.employeeId);
    if (!emp || !employeeWorksOn(emp, dateISO)) return [];
    const duration = serviceDuration(a);
    const out = [];
    for (let m = OPEN_START_MIN; m + duration <= OPEN_END_MIN; m += SLOT_STEP_MIN) {
      if (isFreeExcluding(a.employeeId, dateISO, m, duration, a.id)) out.push(minToTime(m));
    }
    return out;
  }

  function startReagendar(a) {
    setReagendarId(a.id);
    setReDate(null);
    setCalYear(new Date().getFullYear());
    setCalMonth(new Date().getMonth());
  }

  async function confirmarReagendo(a, time) {
    const ok = await persist({ ...data, appointments: data.appointments.map((x) => (x.id === a.id ? { ...x, date: reDate, time } : x)) });
    if (ok === false) {
      window.alert("No se pudo reagendar la cita: problema de conexión con el servidor. Intenta de nuevo.");
      return;
    }
    setReagendarId(null); setReDate(null);
  }

  const [reviewingId, setReviewingId] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");

  function startReview(a) {
    setReviewingId(a.id);
    setReviewRating(5);
    setReviewComment("");
  }
  async function enviarResena(a) {
    const review = { rating: reviewRating, comment: reviewComment.trim(), createdAt: Date.now() };
    const ok = await persist({ ...data, appointments: data.appointments.map((x) => (x.id === a.id ? { ...x, review } : x)) });
    if (ok === false) {
      window.alert("No se pudo enviar la reseña: problema de conexión con el servidor. Intenta de nuevo.");
      return;
    }
    setReviewingId(null);
  }

  return (
    <div className="panel">
      <h3 className="section-title">Próximas citas</h3>
      {upcoming.length === 0 && <p className="muted">No tienes citas próximas. Reserva una desde "Reservar cita".</p>}
      <div className="appt-list">
        {upcoming.map((a) => (
          <div key={a.id} className="appt-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: ".75rem", width: "100%" }}>
              <div>
                <div className="appt-service">{a.serviceName}</div>
                <div className="appt-meta">{a.date} · {a.time} · con {employeeName(a.employeeId)}</div>
                {a.status === "pendiente" && (
                  <div className="appt-meta">Horario especial: queda pendiente de aprobación de la administradora.</div>
                )}
              </div>
              <div className="appt-right">
                <span className={`tag tag-${a.status}`}>{a.status}</span>
                <button className="btn-ghost" onClick={() => (reagendarId === a.id ? setReagendarId(null) : startReagendar(a))}>
                  {reagendarId === a.id ? "Cerrar" : "Reagendar"}
                </button>
                <button className="btn-ghost-danger" onClick={() => cancel(a)}>Cancelar</button>
              </div>
            </div>
            {reagendarId === a.id && (
              <div style={{ width: "100%", marginTop: ".9rem", paddingTop: ".9rem", borderTop: "1px solid var(--line)" }}>
                <p className="field-hint">Elige la nueva fecha (con {employeeName(a.employeeId)}):</p>
                <MonthCalendar
                  year={calYear} month={calMonth} selectedDate={reDate}
                  minDateISO={todayISO()}
                  isDateDisabled={(iso) => slotsFor(a, iso).length === 0}
                  onMonthChange={(y, m) => { setCalYear(y); setCalMonth(m); }}
                  onSelect={(iso) => setReDate(iso)}
                />
                {reDate && (
                  <div className="slot-grid" style={{ marginTop: ".8rem" }}>
                    {slotsFor(a, reDate).map((t) => (
                      <button key={t} className="slot-btn" onClick={() => confirmarReagendo(a, t)}>{t}</button>
                    ))}
                    {slotsFor(a, reDate).length === 0 && <p className="muted">Sin horarios libres ese día.</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <>
          <h3 className="section-title" style={{ marginTop: "1.75rem" }}>Historial</h3>
          <div className="appt-list">
            {past.map((a) => (
              <div key={a.id} className="appt-row appt-row-past" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: ".75rem", flexWrap: "wrap" }}>
                  <div>
                    <div className="appt-service">{a.serviceName}</div>
                    <div className="appt-meta">{a.date} · {a.time} · con {employeeName(a.employeeId)}</div>
                    {a.status === "rechazada" && (
                      <div className="appt-meta">La administradora no pudo confirmar este horario especial. Agenda otra cita cuando quieras.</div>
                    )}
                  </div>
                  <div className="appt-right">
                    <span className={`tag tag-${a.status}`}>{a.status}</span>
                    {a.status === "completada" && !a.review && reviewingId !== a.id && (
                      <button className="btn-ghost" onClick={() => startReview(a)}><Star size={14} /> Dejar reseña</button>
                    )}
                  </div>
                </div>
                {a.review && (
                  <div className="appt-meta" style={{ marginTop: ".4rem" }}>
                    {"★".repeat(a.review.rating)}{"☆".repeat(5 - a.review.rating)}
                    {a.review.comment ? ` — ${a.review.comment}` : ""}
                  </div>
                )}
                {reviewingId === a.id && (
                  <div style={{ width: "100%", marginTop: ".8rem", paddingTop: ".8rem", borderTop: "1px solid var(--line)" }}>
                    <div style={{ display: "flex", gap: ".3rem", marginBottom: ".6rem" }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n} type="button" className="icon-btn"
                          style={{ color: n <= reviewRating ? "var(--gold)" : "var(--muted)", border: "none" }}
                          onClick={() => setReviewRating(n)}
                        >
                          <Star size={20} fill={n <= reviewRating ? "currentColor" : "none"} />
                        </button>
                      ))}
                    </div>
                    <textarea
                      className="textarea"
                      placeholder="Cuéntanos cómo te fue (opcional)"
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      style={{ marginBottom: ".6rem" }}
                    />
                    <div style={{ display: "flex", gap: ".6rem" }}>
                      <button className="btn-primary" onClick={() => enviarResena(a)}>Enviar reseña</button>
                      <button className="btn-ghost" onClick={() => setReviewingId(null)}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ClientPromotions({ promotions, onUsePromo }) {
  const active = (promotions || []).filter(isPromoVisible);
  if (active.length === 0) return null;
  return (
    <div className="promo-strip">
      <h3 className="section-title">Promociones</h3>
      <div className="promo-grid">
        {active.map((p) => (
          <div key={p.id} className="promo-card">
            {p.image && <img src={p.image} alt={p.title} className="promo-thumb" />}
            <div className="promo-body">
              <div className="promo-title">{p.title}</div>
              {p.description && <div className="promo-desc">{p.description}</div>}
              {p.price != null && <div className="appt-meta">Valor: {money(p.price)}</div>}
              <div className="appt-meta">{promoValidityLabel(p)}</div>
            </div>
            {promoServiceIds(p).length > 0 && (
              <div className="promo-actions">
                <button className="btn-primary" onClick={() => onUsePromo(p)}>Pedir con esta promoción</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientApp({ data, persist, session, onLogout, onRefreshPromotions }) {
  const [tab, setTab] = useState("reservar");
  const [activePromo, setActivePromo] = useState(null);
  const [bookingKey, setBookingKey] = useState(0);
  const client = data.clients.find((c) => c.id === session.id);

  // Actualiza las promociones automáticamente mientras la clienta tiene su cuenta abierta.
  // Así, cuando la administradora publica/oculta una promoción, aparece sin que la clienta
  // tenga que cerrar sesión.
  useEffect(() => {
    if (!onRefreshPromotions) return undefined;
    const timer = setInterval(() => {
      onRefreshPromotions();
    }, 10000);
    return () => clearInterval(timer);
  }, [onRefreshPromotions]);

  const promotionNav = { key: "promociones", label: "Promociones", icon: Megaphone };

  return (
    <Shell
      title={data.businessName}
      personName={client?.name?.split(" ")[0] || ""}
      roleLabel="Cliente/a"
      nav={[
        { key: "reservar", label: "Reservar cita", icon: Calendar },
        promotionNav,
        { key: "mis-citas", label: "Mis citas", icon: Clock },
      ]}
      active={tab} onNav={setTab} onLogout={onLogout}
      primaryAction={{ label: "Nueva cita", onClick: () => { setActivePromo(null); setTab("reservar"); setBookingKey((k) => k + 1); } }}
    >
      {tab === "reservar" && (
        <ClientPromotions
          promotions={data.promotions}
          onUsePromo={(p) => setActivePromo(p)}
        />
      )}

      {tab === "promociones" && (
        <div>
          <h2 style={{ marginBottom: ".35rem" }}>Promociones para ti</h2>
          <p className="main-subtitle">Aquí aparecen automáticamente las promociones publicadas por el salón.</p>
          <ClientPromotions
            promotions={data.promotions}
            onUsePromo={(p) => { setActivePromo(p); setTab("reservar"); setBookingKey((k) => k + 1); }}
          />
          {(data.promotions || []).filter(isPromoVisible).length === 0 && (
            <div className="panel empty-state">
              <div className="arch-icon"><Megaphone size={24} /></div>
              <h3>No hay promociones activas</h3>
              <p>Cuando el salón publique una promoción vigente, aparecerá aquí automáticamente.</p>
            </div>
          )}
        </div>
      )}

      {tab === "reservar" && (
        <BookingWizard
          key={bookingKey}
          data={data} persist={persist} clientId={client.id}
          promo={activePromo}
          onClearPromo={() => setActivePromo(null)}
          onBooked={() => { setActivePromo(null); setTab("mis-citas"); }}
        />
      )}
      {tab === "mis-citas" && <MyAppointments data={data} persist={persist} clientId={client.id} />}
    </Shell>
  );
}

/* ---------------------------------- Vista equipo / admin ---------------------------------- */

function AgendaView({ data, persist, employeeId, onlyMine, isAdmin }) {
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [filterEmp, setFilterEmp] = useState("todas");
  const [expandedId, setExpandedId] = useState(null);
  const [addServiceId, setAddServiceId] = useState("");
  const [reassignId, setReassignId] = useState(null);
  const [reassignEmp, setReassignEmp] = useState("");

  const scoped = data.appointments.filter((a) =>
    onlyMine ? a.employeeId === employeeId : (filterEmp === "todas" || a.employeeId === filterEmp)
  );

  function dayCount(iso) { return scoped.filter((a) => a.date === iso && a.status !== "cancelada").length; }
  const dayAppts = scoped.filter((a) => a.date === selectedDate).sort((a, b) => (a.time < b.time ? -1 : 1));

  function clientName(id) { return data.clients.find((c) => c.id === id)?.name || "—"; }
  function clientPhone(id) { return data.clients.find((c) => c.id === id)?.phone || ""; }
  function employeeName(id) { return data.employees.find((e) => e.id === id)?.name || "—"; }
  function serviceName(sid) { return data.services.find((s) => s.id === sid)?.name || "—"; }
  function apptTotal(a) { return a.price + (a.extras || []).reduce((s, e) => s + e.price, 0); }

  function enviarRecordatorio(a) {
    const phone = clientPhone(a.clientId).replace(/\D/g, "");
    if (!phone) { window.alert("Esta clienta no tiene teléfono registrado."); return; }
    const msg = `Hola ${clientName(a.clientId)}, te recordamos tu cita de ${serviceName(a.serviceId)} el ${a.date} a las ${a.time} en ${data.businessName}. ¡Te esperamos!`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  function isFreeFor(empId, dateISO, startMin, duration, excludeApptId) {
    const end = startMin + duration;
    return !data.appointments.some((x) => {
      if (x.id === excludeApptId) return false;
      if (x.employeeId !== empId || x.date !== dateISO || (x.status === "cancelada" || x.status === "rechazada")) return false;
      const xStart = timeToMin(x.time);
      const xEnd = xStart + x.duration;
      return startMin < xEnd && end > xStart;
    });
  }

  async function reasignar(a) {
    if (!reassignEmp) return;
    if (!isFreeFor(reassignEmp, a.date, timeToMin(a.time), a.duration, a.id)) {
      window.alert("Esa trabajadora ya tiene una cita a esa hora.");
      return;
    }
    const appointments = data.appointments.map((x) => (x.id === a.id ? { ...x, employeeId: reassignEmp } : x));
    await persist({ ...data, appointments });
    setReassignId(null); setReassignEmp("");
  }

  async function setStatus(id, status) {
    let next = { ...data, appointments: data.appointments.map((a) => (a.id === id ? { ...a, status } : a)) };
    if (status === "completada") {
      const appt = data.appointments.find((a) => a.id === id);
      const yaFacturada = (data.ventas || []).some((v) => v.appointmentId === id);
      if (appt && !yaFacturada) {
        const items = [
          { name: appt.serviceName, price: appt.price },
          ...(appt.extras || []).map((e) => ({ name: e.serviceName, price: e.price })),
        ];
        const total = items.reduce((s, it) => s + it.price, 0);
        const consecutivo = data.nextConsecutivo || 1;
        const venta = {
          id: uid(),
          consecutivo,
          appointmentId: appt.id,
          clientId: appt.clientId,
          clientName: clientName(appt.clientId),
          clientPhone: clientPhone(appt.clientId),
          employeeId: appt.employeeId,
          employeeName: employeeName(appt.employeeId),
          serviceId: appt.serviceId,
          serviceName: appt.serviceName,
          items,
          price: total,
          date: appt.date,
          time: appt.time,
          createdAt: Date.now(),
          status: "activa",
        };
        next = { ...next, ventas: [...(data.ventas || []), venta], nextConsecutivo: consecutivo + 1 };

        const rate = data.pointsPerThousand != null ? Number(data.pointsPerThousand) : 1;
        if (rate > 0) {
          const pointsEarned = Math.floor((total / 1000) * rate);
          if (pointsEarned > 0) {
            next = {
              ...next,
              clients: next.clients.map((c) => (c.id === appt.clientId ? { ...c, points: (c.points || 0) + pointsEarned } : c)),
            };
          }
        }
      }
    }
    await persist(next);
  }

  async function agregarExtra(a) {
    if (!addServiceId) return;
    const s = data.services.find((x) => x.id === addServiceId);
    if (!s) return;
    const extra = { id: uid(), serviceId: s.id, serviceName: s.name, price: s.price, addedAt: Date.now() };
    const appointments = data.appointments.map((x) => (x.id === a.id ? { ...x, extras: [...(x.extras || []), extra] } : x));
    await persist({ ...data, appointments });
    setAddServiceId("");
  }

  async function eliminarExtraAdmin(a, extra) {
    const ok = window.confirm(`¿Eliminar "${extra.serviceName}" de esta cita?`);
    if (!ok) return;
    const appointments = data.appointments.map((x) => (x.id === a.id ? { ...x, extras: (x.extras || []).filter((e) => e.id !== extra.id) } : x));
    await persist({ ...data, appointments });
  }

  async function resolverDevolucion(dev, aprobar) {
    let appointments = data.appointments;
    if (aprobar) {
      appointments = data.appointments.map((x) =>
        x.id === dev.appointmentId ? { ...x, extras: (x.extras || []).filter((e) => e.id !== dev.extraId) } : x
      );
    }
    const devoluciones = (data.devoluciones || []).map((d) => (d.id === dev.id ? { ...d, estado: aprobar ? "aprobada" : "rechazada" } : d));
    await persist({ ...data, appointments, devoluciones });
  }

  async function resolverCitaPendiente(id, aceptar) {
    await persist({ ...data, appointments: data.appointments.map((a) => (a.id === id ? { ...a, status: aceptar ? "confirmada" : "rechazada" } : a)) });
  }

  const pendientesDevolucion = isAdmin ? (data.devoluciones || []).filter((d) => d.estado === "pendiente") : [];
  const pendientesCitas = isAdmin ? data.appointments.filter((a) => a.status === "pendiente") : [];

  return (
    <>
      {pendientesCitas.length > 0 && (
        <div className="panel" style={{ marginBottom: "1.5rem" }}>
          <h3 className="section-title">Solicitudes de horario especial pendientes</h3>
          <div className="appt-list">
            {pendientesCitas.map((a) => (
              <div key={a.id} className="appt-row">
                <div>
                  <div className="appt-service">{serviceName(a.serviceId)}</div>
                  <div className="appt-meta">{clientName(a.clientId)} · {a.date} · {a.time} · con {employeeName(a.employeeId)}</div>
                </div>
                <div className="appt-right">
                  <button className="btn-primary" onClick={() => resolverCitaPendiente(a.id, true)}>Aceptar</button>
                  <button className="btn-ghost-danger" onClick={() => resolverCitaPendiente(a.id, false)}>Rechazar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {pendientesDevolucion.length > 0 && (
        <div className="panel" style={{ marginBottom: "1.5rem" }}>
          <h3 className="section-title">Solicitudes de devolución pendientes</h3>
          <div className="appt-list">
            {pendientesDevolucion.map((d) => (
              <div key={d.id} className="appt-row">
                <div>
                  <div className="appt-service">{d.serviceName} · {money(d.price)}</div>
                  <div className="appt-meta">Solicitada por {d.employeeName}</div>
                </div>
                <div className="appt-right">
                  <button className="btn-primary" onClick={() => resolverDevolucion(d, true)}>Aceptar y eliminar</button>
                  <button className="btn-ghost" onClick={() => resolverDevolucion(d, false)}>Rechazar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="panel two-col">
        <div>
          {!onlyMine && (
            <select className="input" style={{ marginBottom: ".9rem" }} value={filterEmp} onChange={(e) => setFilterEmp(e.target.value)}>
              <option value="todas">Todo el equipo</option>
              {data.employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          <MonthCalendar
            year={calYear} month={calMonth} selectedDate={selectedDate}
            onMonthChange={(y, m) => { setCalYear(y); setCalMonth(m); }}
            onSelect={setSelectedDate}
            renderBadge={(iso) => (dayCount(iso) > 0 ? <span className="cal-badge">{dayCount(iso)}</span> : null)}
          />
        </div>
        <div>
          <h3 className="section-title">{selectedDate}</h3>
          {dayAppts.length === 0 && <p className="muted">Sin citas este día.</p>}
          <div className="appt-list">
            {dayAppts.map((a) => (
              <div key={a.id} className="appt-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: ".75rem", width: "100%" }}>
                  <div>
                    <div className="appt-service">{a.time} · {serviceName(a.serviceId)}</div>
                    <div className="appt-meta">
                      {clientName(a.clientId)} · {clientPhone(a.clientId)}{!onlyMine ? ` · con ${employeeName(a.employeeId)}` : ""} · Total {money(apptTotal(a))}
                    </div>
                  </div>
                  <div className="appt-right">
                    <span className={`tag tag-${a.status}`}>{a.status}</span>
                    {a.status === "confirmada" && (
                      <>
                        {isAdmin && (
                          <button className="btn-ghost" onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}>
                            {expandedId === a.id ? "Cerrar" : "+ Servicio"}
                          </button>
                        )}
                        {isAdmin && !onlyMine && (
                          <button className="btn-ghost" onClick={() => { setReassignId(reassignId === a.id ? null : a.id); setReassignEmp(a.employeeId); }}>
                            {reassignId === a.id ? "Cerrar" : "Reasignar"}
                          </button>
                        )}
                        {isAdmin && (
                          <button className="btn-ghost" onClick={() => enviarRecordatorio(a)}><MessageCircle size={14} /> Recordar</button>
                        )}
                        <button className="btn-ghost" onClick={() => setStatus(a.id, "completada")}>Completada</button>
                        {isAdmin && (
                          <button className="btn-ghost-danger" onClick={() => setStatus(a.id, "cancelada")}>Cancelar</button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {(a.extras || []).length > 0 && (
                  <div style={{ width: "100%", marginTop: ".7rem", display: "flex", flexDirection: "column", gap: ".4rem" }}>
                    {a.extras.map((e) => {
                      const pend = (data.devoluciones || []).find((d) => d.extraId === e.id && d.estado === "pendiente");
                      return (
                        <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: ".85rem", color: "var(--muted)" }}>
                          <span>+ {e.serviceName} · {money(e.price)}</span>
                          {a.status === "confirmada" && isAdmin && (
                            pend ? (
                              <span className="tag tag-completada">Devolución pendiente</span>
                            ) : (
                              <button className="btn-ghost-danger" onClick={() => eliminarExtraAdmin(a, e)}>Eliminar</button>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {reassignId === a.id && (
                  <div style={{ width: "100%", marginTop: ".9rem", paddingTop: ".9rem", borderTop: "1px solid var(--line)", display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
                    <select className="input" style={{ maxWidth: 260 }} value={reassignEmp} onChange={(e) => setReassignEmp(e.target.value)}>
                      {data.employees.filter((e) => e.active && e.serviceIds.includes(a.serviceId)).map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                    <button className="btn-primary" onClick={() => reasignar(a)}>Guardar asignación</button>
                  </div>
                )}

                {isAdmin && expandedId === a.id && (
                  <div style={{ width: "100%", marginTop: ".9rem", paddingTop: ".9rem", borderTop: "1px solid var(--line)", display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
                    <select className="input" style={{ maxWidth: 260 }} value={addServiceId} onChange={(e) => setAddServiceId(e.target.value)}>
                      <option value="">Elige un servicio</option>
                      {data.services.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}
                    </select>
                    <button className="btn-primary" onClick={() => agregarExtra(a)}>Agregar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function TeamManager({ data, persist }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [serviceIds, setServiceIds] = useState([]);
  const [workDays, setWorkDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [error, setError] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editPin, setEditPin] = useState("");
  const [editServiceIds, setEditServiceIds] = useState([]);
  const [editWorkDays, setEditWorkDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [editError, setEditError] = useState("");

  async function add() {
    if (!name.trim() || pin.length !== 4) { setError("Escribe el nombre y un PIN de 4 dígitos."); return; }
    if (data.employees.some((e) => e.name.toLowerCase() === name.trim().toLowerCase())) { setError("Ya existe alguien con ese nombre."); return; }
    const emp = { id: uid(), name: name.trim(), phone: phone.trim(), pin, isAdmin, active: true, serviceIds, workDays };
    await persist({ ...data, employees: [...data.employees, emp] });
    setName(""); setPhone(""); setPin(""); setIsAdmin(false); setServiceIds([]); setWorkDays([0, 1, 2, 3, 4, 5, 6]); setError("");
  }
  async function toggleActive(id) {
    await persist({ ...data, employees: data.employees.map((e) => (e.id === id ? { ...e, active: !e.active } : e)) });
  }
  async function toggleRole(target) {
    if (target.isAdmin) {
      const otrasAdmins = data.employees.filter((e) => e.isAdmin && e.id !== target.id).length;
      if (otrasAdmins === 0) {
        window.alert("No puedes quitarle el rol de administradora: es la única que queda. Primero haz administradora a alguien más.");
        return;
      }
    }
    await persist({ ...data, employees: data.employees.map((e) => (e.id === target.id ? { ...e, isAdmin: !e.isAdmin } : e)) });
  }
  async function remove(id) {
    const target = data.employees.find((e) => e.id === id);
    if (target?.isAdmin) {
      const otrasAdmins = data.employees.filter((e) => e.isAdmin && e.id !== id).length;
      if (otrasAdmins === 0) {
        window.alert("No puedes eliminar a la única administradora. Primero haz administradora a alguien más.");
        return;
      }
    }
    await persist({ ...data, employees: data.employees.filter((e) => e.id !== id) });
    if (editingId === id) setEditingId(null);
  }
  function toggleService(sid) {
    setServiceIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  }
  function toggleWorkDay(d) {
    setWorkDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function startEdit(e) {
    setEditingId(e.id);
    setEditName(e.name);
    setEditPhone(e.phone || "");
    setEditPin(e.pin || "");
    setEditServiceIds(e.serviceIds || []);
    setEditWorkDays(Array.isArray(e.workDays) && e.workDays.length > 0 ? e.workDays : [0, 1, 2, 3, 4, 5, 6]);
    setEditError("");
  }
  function cancelEdit() {
    setEditingId(null);
    setEditError("");
  }
  function toggleEditService(sid) {
    setEditServiceIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  }
  function toggleEditWorkDay(d) {
    setEditWorkDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }
  async function saveEdit(target) {
    if (!editName.trim() || editPin.length !== 4) { setEditError("Escribe el nombre y un PIN de 4 dígitos."); return; }
    if (data.employees.some((e) => e.id !== target.id && e.name.toLowerCase() === editName.trim().toLowerCase())) {
      setEditError("Ya existe alguien con ese nombre.");
      return;
    }
    const updated = { ...target, name: editName.trim(), phone: editPhone.trim(), pin: editPin, serviceIds: editServiceIds, workDays: editWorkDays };
    await persist({ ...data, employees: data.employees.map((e) => (e.id === target.id ? updated : e)) });
    setEditingId(null);
  }

  return (
    <div className="panel">
      <h3 className="section-title">Agregar integrante</h3>
      <div className="form-grid">
        <input className="input" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="Teléfono (para WhatsApp)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className="input" placeholder="PIN de 4 dígitos" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="checkbox-row">
        <label><input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Es administradora</label>
      </div>
      <p className="field-hint">Servicios que realiza:</p>
      <div className="chip-row">
        {data.services.map((s) => (
          <button key={s.id} type="button" className={`chip ${serviceIds.includes(s.id) ? "chip-active" : ""}`} onClick={() => toggleService(s.id)}>
            {s.name}
          </button>
        ))}
      </div>
      <p className="field-hint">Días que trabaja:</p>
      <div className="chip-row">
        {WEEKDAYS_FULL.map((w, i) => (
          <button key={w} type="button" className={`chip ${workDays.includes(i) ? "chip-active" : ""}`} onClick={() => toggleWorkDay(i)}>
            {w}
          </button>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}
      <button className="btn-primary" onClick={add}><Plus size={15} /> Agregar</button>

      <h3 className="section-title" style={{ marginTop: "2rem" }}>Equipo actual</h3>
      <div className="appt-list">
        {data.employees.map((e) => (
          <div key={e.id} className="appt-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            {editingId === e.id ? (
              <div style={{ width: "100%" }}>
                <div className="appt-service" style={{ marginBottom: ".5rem" }}>Modificando a {e.name}</div>
                <div className="form-grid">
                  <input className="input" placeholder="Nombre" value={editName} onChange={(ev) => setEditName(ev.target.value)} />
                  <input className="input" placeholder="Teléfono (para WhatsApp)" value={editPhone} onChange={(ev) => setEditPhone(ev.target.value)} />
                  <input className="input" placeholder="PIN de 4 dígitos" maxLength={4} value={editPin} onChange={(ev) => setEditPin(ev.target.value.replace(/\D/g, ""))} />
                </div>
                <p className="field-hint">Servicios que realiza:</p>
                <div className="chip-row">
                  {data.services.map((s) => (
                    <button key={s.id} type="button" className={`chip ${editServiceIds.includes(s.id) ? "chip-active" : ""}`} onClick={() => toggleEditService(s.id)}>
                      {s.name}
                    </button>
                  ))}
                </div>
                <p className="field-hint">Días que trabaja:</p>
                <div className="chip-row">
                  {WEEKDAYS_FULL.map((w, i) => (
                    <button key={w} type="button" className={`chip ${editWorkDays.includes(i) ? "chip-active" : ""}`} onClick={() => toggleEditWorkDay(i)}>
                      {w}
                    </button>
                  ))}
                </div>
                <div className="chip-row">
                  {data.services.map((s) => (
                    <button key={s.id} type="button" className={`chip ${editServiceIds.includes(s.id) ? "chip-active" : ""}`} onClick={() => toggleEditService(s.id)}>
                      {s.name}
                    </button>
                  ))}
                </div>
                {editError && <p className="error-text">{editError}</p>}
                <div style={{ display: "flex", gap: ".6rem" }}>
                  <button className="btn-primary" onClick={() => saveEdit(e)}>Guardar cambios</button>
                  <button className="btn-ghost" onClick={cancelEdit}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: ".75rem", flexWrap: "wrap" }}>
                <div>
                  <div className="appt-service">{e.name}{e.isAdmin && <span className="tag tag-admin">admin</span>}</div>
                  <div className="appt-meta">
                    {e.phone ? `${e.phone} · ` : ""}
                    {e.serviceIds.map((sid) => data.services.find((s) => s.id === sid)?.name).filter(Boolean).join(", ") || "Sin servicios asignados"}
                  </div>
                  <div className="appt-meta">
                    Trabaja: {Array.isArray(e.workDays) && e.workDays.length > 0 && e.workDays.length < 7 ? e.workDays.slice().sort().map((d) => WEEKDAYS[d]).join(", ") : "Todos los días"}
                  </div>
                </div>
                <div className="appt-right">
                  <span className={`tag ${e.active ? "tag-confirmada" : "tag-cancelada"}`}>{e.active ? "activa" : "inactiva"}</span>
                  <button className="btn-ghost" onClick={() => startEdit(e)}>Modificar</button>
                  <button className="btn-ghost" onClick={() => toggleRole(e)}>{e.isAdmin ? "Quitar admin" : "Hacer administradora"}</button>
                  <button className="btn-ghost" onClick={() => toggleActive(e.id)}>{e.active ? "Desactivar" : "Activar"}</button>
                  <button className="btn-ghost-danger" onClick={() => remove(e.id)}>Eliminar</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function validateServiceFields({ name, duration, price }) {
  // Devuelve solo las claves de los campos que están mal diligenciados,
  // para poder pintar en rojo justo el campo problemático, no un mensaje genérico.
  const errs = {};
  if (name !== undefined && !String(name).trim()) errs.name = "Escribe un nombre.";
  if (duration === "" || duration === null || duration === undefined || isNaN(Number(duration)) || Number(duration) <= 0) {
    errs.duration = "La duración debe ser un número mayor a 0.";
  }
  if (price === "" || price === null || price === undefined || isNaN(Number(price)) || Number(price) < 0) {
    errs.price = "El precio debe ser un número igual o mayor a 0.";
  }
  return errs;
}

function ServicesManager({ data, persist }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState(30000);
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const [editingId, setEditingId] = useState(null);
  const [editDuration, setEditDuration] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editErrors, setEditErrors] = useState({});

  const [cancelHours, setCancelHours] = useState(data.cancelMinHours != null ? String(data.cancelMinHours) : "3");
  async function saveCancelHours() {
    const n = Number(cancelHours);
    if (isNaN(n) || n < 0) return;
    await persist({ ...data, cancelMinHours: n });
  }
  const [pointsRate, setPointsRate] = useState(data.pointsPerThousand != null ? String(data.pointsPerThousand) : "1");
  async function savePointsRate() {
    const n = Number(pointsRate);
    if (isNaN(n) || n < 0) return;
    await persist({ ...data, pointsPerThousand: n });
  }
  const extendedOn = data.extendedHoursEnabled !== false;
  async function toggleExtendedHours() {
    await persist({ ...data, extendedHoursEnabled: !extendedOn });
  }

  async function add() {
    const errs = validateServiceFields({ name, duration, price });
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const s = { id: uid(), name: name.trim(), category, duration: Number(duration), price: Number(price), description: description.trim() };
    await persist({ ...data, services: [...data.services, s] });
    setName(""); setDuration(60); setPrice(30000); setDescription(""); setFieldErrors({});
  }
  async function remove(id) {
    await persist({
      ...data,
      services: data.services.filter((s) => s.id !== id),
      employees: data.employees.map((e) => ({ ...e, serviceIds: e.serviceIds.filter((x) => x !== id) })),
    });
    if (editingId === id) setEditingId(null);
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEditDuration(String(s.duration));
    setEditPrice(String(s.price));
    setEditDescription(s.description || "");
    setEditErrors({});
  }
  function cancelEdit() {
    setEditingId(null);
    setEditErrors({});
  }
  async function saveEdit(s) {
    const errs = validateServiceFields({ duration: editDuration, price: editPrice });
    setEditErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const updated = { ...s, duration: Number(editDuration), price: Number(editPrice), description: editDescription.trim() };
    await persist({ ...data, services: data.services.map((x) => (x.id === s.id ? updated : x)) });
    setEditingId(null);
  }

  return (
    <>
      <div className="panel" style={{ marginBottom: "1.5rem" }}>
        <h3 className="section-title">Reglas de cancelación</h3>
        <p className="field-hint">Las clientas no podrán cancelar una cita desde la app si faltan menos de estas horas.</p>
        <div style={{ display: "flex", gap: ".6rem", alignItems: "center", flexWrap: "wrap" }}>
          <input className="input" type="number" min="0" style={{ maxWidth: 140 }} value={cancelHours} onChange={(e) => setCancelHours(e.target.value)} />
          <button className="btn-ghost" onClick={saveCancelHours}>Guardar</button>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: "1.5rem" }}>
        <h3 className="section-title">Horario especial (7-9am y 6-7pm)</h3>
        <p className="field-hint">
          El negocio abre de 7am a 7pm. Entre 9am y 6pm las citas se confirman solas; fuera de esas horas (7-9am y 6-7pm),
          cada solicitud te queda pendiente en "Todas las citas" para que la aceptes o la rechaces.
        </p>
        <div className="checkbox-row" style={{ marginBottom: 0 }}>
          <label><input type="checkbox" checked={extendedOn} onChange={toggleExtendedHours} /> Ofrecer horario especial a las clientas</label>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: "1.5rem" }}>
        <h3 className="section-title">Puntos de fidelidad</h3>
        <p className="field-hint">Puntos que gana una clienta por cada $1.000 en servicios completados (0 para desactivar).</p>
        <div style={{ display: "flex", gap: ".6rem", alignItems: "center", flexWrap: "wrap" }}>
          <input className="input" type="number" min="0" step="0.1" style={{ maxWidth: 140 }} value={pointsRate} onChange={(e) => setPointsRate(e.target.value)} />
          <button className="btn-ghost" onClick={savePointsRate}>Guardar</button>
        </div>
      </div>
      <div className="panel">
      <h3 className="section-title">Agregar servicio</h3>
      <div className="form-grid">
        <div>
          <input
            className={`input ${fieldErrors.name ? "input-error" : ""}`}
            placeholder="Nombre del servicio"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {fieldErrors.name && <p className="field-error-text">{fieldErrors.name}</p>}
        </div>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div>
          <input
            className={`input ${fieldErrors.duration ? "input-error" : ""}`}
            type="number"
            placeholder="Duración (min)"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
          {fieldErrors.duration && <p className="field-error-text">{fieldErrors.duration}</p>}
        </div>
        <div>
          <input
            className={`input ${fieldErrors.price ? "input-error" : ""}`}
            type="number"
            placeholder="Precio"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          {fieldErrors.price && <p className="field-error-text">{fieldErrors.price}</p>}
        </div>
      </div>
      <textarea
        className="textarea"
        placeholder="Descripción del servicio (opcional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{ marginBottom: ".8rem" }}
      />
      <button className="btn-primary" onClick={add}><Plus size={15} /> Agregar servicio</button>

      {CATEGORIES.map((cat) => {
        const items = data.services.filter((s) => s.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat}>
            <h3 className="section-title" style={{ marginTop: "2rem" }}>{cat}</h3>
            <div className="appt-list">
              {items.map((s) => (
                <div key={s.id} className="appt-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  {editingId === s.id ? (
                    <div style={{ width: "100%" }}>
                      <div className="appt-service" style={{ marginBottom: ".5rem" }}>{s.name}</div>
                      <div className="form-grid">
                        <div>
                          <input
                            className={`input ${editErrors.duration ? "input-error" : ""}`}
                            type="number"
                            placeholder="Duración (min)"
                            value={editDuration}
                            onChange={(e) => setEditDuration(e.target.value)}
                          />
                          {editErrors.duration && <p className="field-error-text">{editErrors.duration}</p>}
                        </div>
                        <div>
                          <input
                            className={`input ${editErrors.price ? "input-error" : ""}`}
                            type="number"
                            placeholder="Precio"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                          />
                          {editErrors.price && <p className="field-error-text">{editErrors.price}</p>}
                        </div>
                      </div>
                      <textarea
                        className="textarea"
                        placeholder="Descripción del servicio (opcional)"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        style={{ marginBottom: ".7rem" }}
                      />
                      <div style={{ display: "flex", gap: ".6rem" }}>
                        <button className="btn-primary" onClick={() => saveEdit(s)}>Guardar cambios</button>
                        <button className="btn-ghost" onClick={cancelEdit}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: ".75rem", flexWrap: "wrap" }}>
                      <div>
                        <div className="appt-service">{s.name}</div>
                        <div className="appt-meta">{s.duration} min · {money(s.price)}</div>
                        {s.description && <div className="appt-meta">{s.description}</div>}
                      </div>
                      <div style={{ display: "flex", gap: ".5rem" }}>
                        <button className="btn-ghost" onClick={() => startEdit(s)}>Editar</button>
                        <button className="btn-ghost-danger" onClick={() => remove(s.id)}>Eliminar</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      </div>
    </>
  );
}

function isPromoVisible(promo) {
  // Controla si la promoción se muestra en la pantalla de la clienta: se anuncia
  // todos los días dentro de su rango de vigencia, aunque solo se pueda agendar
  // el día de la semana que repite (ej. "todos los lunes" se ve toda la semana).
  if (!promo.active) return false;
  const today = todayISO();
  if (promo.validFrom && today < promo.validFrom) return false;
  if (promo.validTo && today > promo.validTo) return false;
  return true;
}

function promoDateAllowed(promo, dateISO) {
  // Controla si una fecha puntual se puede agendar con el precio/condición de la promoción.
  if (!promo || !dateISO) return true;
  if (promo.validFrom && dateISO < promo.validFrom) return false;
  if (promo.validTo && dateISO > promo.validTo) return false;
  if (promo.weekday !== null && promo.weekday !== undefined && promo.weekday !== "") {
    if (fromISO(dateISO).getDay() !== Number(promo.weekday)) return false;
  }
  return true;
}

function promoValidityLabel(promo) {
  const hasWeekday = promo.weekday !== null && promo.weekday !== undefined && promo.weekday !== "";
  const weekdayName = hasWeekday ? WEEKDAYS_FULL[Number(promo.weekday)] : null;

  if (hasWeekday && promo.validFrom && promo.validTo) {
    return `Todos los ${weekdayName.toLowerCase()}s, del ${promo.validFrom} al ${promo.validTo}`;
  }
  if (hasWeekday && promo.validFrom) return `Todos los ${weekdayName.toLowerCase()}s desde el ${promo.validFrom}`;
  if (hasWeekday && promo.validTo) return `Todos los ${weekdayName.toLowerCase()}s hasta el ${promo.validTo}`;
  if (hasWeekday) return `Todos los ${weekdayName.toLowerCase()}s`;

  if (promo.validFrom && promo.validTo) {
    if (promo.validFrom === promo.validTo) return `Válida el ${promo.validFrom}`;
    return `Válida del ${promo.validFrom} al ${promo.validTo}`;
  }
  if (promo.validFrom) return `Válida desde el ${promo.validFrom}`;
  if (promo.validTo) return `Válida hasta el ${promo.validTo}`;
  return "Válida cualquier día";
}

function promoServiceIds(promo) {
  if (Array.isArray(promo.serviceIds) && promo.serviceIds.length > 0) return promo.serviceIds;
  return promo.serviceId ? [promo.serviceId] : [];
}

function PromotionsManager({ data, persist }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [serviceIds, setServiceIds] = useState([]);
  const [price, setPrice] = useState("");
  const [weekday, setWeekday] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [imageData, setImageData] = useState("");
  const [uploading, setUploading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const fileInputRef = useRef(null);

  function toggleService(sid) {
    setServiceIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await compressImageFile(file);
      setImageData(dataUrl);
      setFieldErrors((prev) => ({ ...prev, image: undefined }));
    } catch {
      window.alert("No se pudo cargar la imagen. Intenta de nuevo.");
    }
    setUploading(false);
  }

  async function add() {
    const errs = {};
    if (!title.trim()) errs.title = "Escribe un título para la promoción.";
    if (!imageData) errs.image = "Sube una imagen desde tu celular o computador.";
    if (price !== "" && (isNaN(Number(price)) || Number(price) < 0)) errs.price = "El valor debe ser un número igual o mayor a 0.";
    if (validFrom && validTo && validTo < validFrom) errs.validTo = "La fecha final no puede ser antes de la inicial.";
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const promo = {
      id: uid(),
      title: title.trim(),
      description: description.trim(),
      serviceIds: serviceIds,
      price: price === "" ? null : Number(price),
      weekday: weekday === "" ? null : Number(weekday),
      validFrom: validFrom || null,
      validTo: validTo || null,
      image: imageData,
      active: true,
      createdAt: todayISO(),
    };
    const ok = await persist({ ...data, promotions: [promo, ...(data.promotions || [])] });
    if (ok === false) {
      window.alert("No se pudo publicar la promoción: hubo un problema de conexión con el servidor. Intenta de nuevo.");
      return;
    }
    setTitle(""); setDescription(""); setServiceIds([]); setPrice(""); setWeekday(""); setValidFrom(""); setValidTo(""); setImageData(""); setFieldErrors({});
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function toggleActive(id) {
    await persist({
      ...data,
      promotions: (data.promotions || []).map((p) => (p.id === id ? { ...p, active: !p.active } : p)),
    });
  }
  async function remove(id) {
    await persist({ ...data, promotions: (data.promotions || []).filter((p) => p.id !== id) });
  }

  function serviceNames(sids) {
    return (sids || []).map((sid) => data.services.find((s) => s.id === sid)?.name).filter(Boolean).join(", ");
  }

  return (
    <div className="panel">
      <h3 className="section-title">Nueva promoción</h3>
      <p className="field-hint">Solo la administradora puede crear promociones. Se pueden subir desde el celular o el computador. Las clientas las verán en su pantalla principal y podrán pedir la cita directamente desde ahí, con el valor y en cualquier día disponible (o solo dentro del rango de fechas que definas).</p>
      <div className="form-grid-1">
        <div>
          <input
            className={`input ${fieldErrors.title ? "input-error" : ""}`}
            placeholder="Título de la promoción"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {fieldErrors.title && <p className="field-error-text">{fieldErrors.title}</p>}
        </div>
        <textarea
          className="textarea"
          placeholder="Descripción (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div>
          <p className="field-label">Servicios en promoción (opcional, puedes elegir uno o varios para que la clienta pueda pedir la cita directo)</p>
          <div className="chip-row">
            {data.services.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip ${serviceIds.includes(s.id) ? "chip-active" : ""}`}
                onClick={() => toggleService(s.id)}
              >
                {s.name} · {money(s.price)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="field-label">Valor de la promoción</p>
          <input
            className={`input ${fieldErrors.price ? "input-error" : ""}`}
            type="number"
            placeholder="Precio especial de la promoción"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          {fieldErrors.price && <p className="field-error-text">{fieldErrors.price}</p>}
        </div>
        <div>
          <p className="field-label">Repetir cada (opcional): elige un día de la semana para que la promoción se repita ese día dentro del rango de fechas, por ejemplo todos los jueves</p>
          <select className="input" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            <option value="">No repetir · aplica todos los días del rango</option>
            {WEEKDAYS_FULL.map((w, i) => <option key={w} value={i}>Todos los {w.toLowerCase()}s</option>)}
          </select>
        </div>
        <div>
          <p className="field-label">
            {weekday === "" ? "Vigencia de la promoción (déjalo vacío para que aplique cualquier día)" : `Rango de fechas: desde el primer ${WEEKDAYS_FULL[Number(weekday)]?.toLowerCase()} hasta el último ${WEEKDAYS_FULL[Number(weekday)]?.toLowerCase()} que quieras incluir`}
          </p>
          <div className="form-grid">
            <input className="input" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            <div>
              <input
                className={`input ${fieldErrors.validTo ? "input-error" : ""}`}
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
              />
              {fieldErrors.validTo && <p className="field-error-text">{fieldErrors.validTo}</p>}
            </div>
          </div>
        </div>
        <div className="file-input-wrap">
          <input
            ref={fileInputRef}
            className={`input ${fieldErrors.image ? "input-error" : ""}`}
            type="file"
            accept="image/*"
            onChange={handleFile}
          />
          {fieldErrors.image && <p className="field-error-text">{fieldErrors.image}</p>}
          {uploading && <p className="muted">Cargando imagen…</p>}
          {imageData && <img src={imageData} alt="Vista previa" className="promo-upload-preview" />}
        </div>
      </div>
      <button className="btn-primary" style={{ marginTop: ".9rem" }} onClick={add}><Plus size={15} /> Publicar promoción</button>

      <h3 className="section-title" style={{ marginTop: "2rem" }}>Promociones creadas</h3>
      {(data.promotions || []).length === 0 && <p className="muted">Todavía no has creado ninguna promoción.</p>}
      <div className="promo-grid">
        {(data.promotions || []).map((p) => (
          <div key={p.id} className="promo-card">
            {p.image && <img src={p.image} alt={p.title} className="promo-thumb" />}
            <div className="promo-body">
              <div className="promo-title">{p.title}{!p.active && <span className="tag tag-inactiva">oculta</span>}</div>
              {p.description && <div className="promo-desc">{p.description}</div>}
              {serviceNames(promoServiceIds(p)) && <div className="appt-meta">Servicios: {serviceNames(promoServiceIds(p))}</div>}
              {p.price != null && <div className="appt-meta">Valor: {money(p.price)}</div>}
              <div className="appt-meta">{promoValidityLabel(p)}</div>
            </div>
            <div className="promo-actions">
              <button className="btn-ghost" onClick={() => toggleActive(p.id)}>{p.active ? "Ocultar" : "Mostrar"}</button>
              <button className="btn-ghost-danger" onClick={() => remove(p.id)}>Eliminar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsView({ data }) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const monthAppts = data.appointments.filter((a) => {
    const d = fromISO(a.date);
    return d.getFullYear() === y && d.getMonth() === m;
  });
  const completed = monthAppts.filter((a) => a.status === "completada");
  const revenue = completed.reduce((sum, a) => sum + a.price, 0);
  const cancelled = monthAppts.filter((a) => a.status === "cancelada").length;

  const byService = {};
  monthAppts.filter((a) => a.status !== "cancelada").forEach((a) => { byService[a.serviceName] = (byService[a.serviceName] || 0) + 1; });
  const topService = Object.entries(byService).sort((a, b) => b[1] - a[1])[0];

  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  monthAppts.filter((a) => a.status !== "cancelada").forEach((a) => { byWeekday[fromISO(a.date).getDay()]++; });
  const maxDay = byWeekday.indexOf(Math.max(...byWeekday));
  const minDay = byWeekday.indexOf(Math.min(...byWeekday));

  const byClient = {};
  data.appointments.filter((a) => a.status !== "cancelada").forEach((a) => { byClient[a.clientId] = (byClient[a.clientId] || 0) + 1; });
  const topClientId = Object.entries(byClient).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topClient = data.clients.find((c) => c.id === topClientId);

  const keratinaCount = monthAppts.filter((a) => data.services.find((s) => s.id === a.serviceId)?.category === "Keratina").length;

  const reviewed = data.appointments.filter((a) => a.review);
  const avgRating = reviewed.length > 0 ? reviewed.reduce((s, a) => s + a.review.rating, 0) / reviewed.length : null;
  const recentReviews = reviewed.slice().sort((a, b) => b.review.createdAt - a.review.createdAt).slice(0, 5);

  const tips = [];
  if (topService) tips.push(`"${topService[0]}" es tu servicio más pedido este mes (${topService[1]} citas). Arma un combo o paquete con otro servicio para subir el ticket promedio.`);
  if (keratinaCount > 0) tips.push(`Tienes ${keratinaCount} citas de keratina este mes. Ofrece un mantenimiento a los 45 días para que esas clientas vuelvan.`);
  if (monthAppts.length > 0 && byWeekday[minDay] < byWeekday[maxDay]) tips.push(`Los ${WEEKDAYS[minDay]} son tus días más tranquilos. Prueba una promoción especial ese día para llenar la agenda.`);
  if (cancelled > 0) tips.push(`Tuviste ${cancelled} citas canceladas este mes. El botón "Recordar" por WhatsApp en la agenda, un día antes, suele bajar las cancelaciones.`);
  if (topClient) tips.push(`${topClient.name} es tu clienta más frecuente. Revísala en "Clientas" — ya está acumulando puntos de fidelidad automáticamente.`);
  if (reviewed.length === 0 && completed.length > 0) tips.push(`Todavía no tienes reseñas. Tus clientas ya pueden dejarlas desde "Mis citas" después de cada cita completada — coméntaselo la próxima vez que vengan.`);
  if (tips.length === 0) tips.push("Aún no hay suficientes citas este mes para sugerencias específicas. Vuelve cuando tengas más historial.");

  return (
    <div className="panel">
      <h3 className="section-title">Este mes ({MONTHS[m]})</h3>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-num">{monthAppts.length}</div><div className="stat-label">Citas agendadas</div></div>
        <div className="stat-card"><div className="stat-num">{completed.length}</div><div className="stat-label">Citas completadas</div></div>
        <div className="stat-card"><div className="stat-num">{money(revenue)}</div><div className="stat-label">Ingresos (completadas)</div></div>
        <div className="stat-card"><div className="stat-num">{cancelled}</div><div className="stat-label">Cancelaciones</div></div>
      </div>

      <h3 className="section-title" style={{ marginTop: "2rem" }}>Reseñas de clientas</h3>
      {reviewed.length === 0 && <p className="muted">Todavía no hay reseñas. Aparecerán aquí cuando tus clientas las dejen desde "Mis citas".</p>}
      {reviewed.length > 0 && (
        <>
          <p className="field-hint">Promedio: {avgRating.toFixed(1)} ★ · {reviewed.length} reseña{reviewed.length === 1 ? "" : "s"}</p>
          <div className="appt-list">
            {recentReviews.map((a) => (
              <div key={a.id} className="appt-row">
                <div>
                  <div className="appt-service">{"★".repeat(a.review.rating)}{"☆".repeat(5 - a.review.rating)}</div>
                  {a.review.comment && <div className="appt-meta">"{a.review.comment}"</div>}
                  <div className="appt-meta">{data.clients.find((c) => c.id === a.clientId)?.name || "—"} · {a.serviceName}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="section-title" style={{ marginTop: "2rem" }}>Ideas para hacer crecer tu negocio</h3>
      <ul className="tips-list">
        {tips.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}

/* ---------------------------------- Ventas ---------------------------------- */

function ventaEnRango(venta, filtro) {
  if (filtro === "todas") return true;
  const d = fromISO(venta.date);
  const today = new Date();
  if (filtro === "hoy") return venta.date === todayISO();
  if (filtro === "semana") {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const dOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const sOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const eOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    return dOnly >= sOnly && dOnly <= eOnly;
  }
  if (filtro === "mes") return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
  return true;
}

function VentaReceipt({ venta, businessName, onClose }) {
  return (
    <div className="modal-overlay no-print" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="receipt print-area">
          <h3>{businessName}</h3>
          <p className="receipt-num">Comprobante de servicio N.° {venta.consecutivo}</p>
          <hr />
          <p><strong>Clienta:</strong> {venta.clientName}</p>
          {venta.items && venta.items.length > 1 ? (
            <>
              {venta.items.map((it, i) => (
                <p key={i} className="receipt-line"><span>{it.name}</span><span>{money(it.price)}</span></p>
              ))}
            </>
          ) : (
            <p><strong>Servicio:</strong> {venta.serviceName}</p>
          )}
          <p><strong>Atendido por:</strong> {venta.employeeName}</p>
          <p><strong>Fecha:</strong> {venta.date} · {venta.time}</p>
          {venta.status === "anulada" && <p style={{ color: "var(--danger)" }}><strong>ANULADA</strong></p>}
          <hr />
          <p className="receipt-total"><strong>{money(venta.price)}</strong></p>
        </div>
        <div className="row-gap no-print" style={{ marginTop: "1.2rem" }}>
          <button className="btn-ghost" onClick={onClose}>Cerrar</button>
          <button className="btn-primary" onClick={() => window.print()}><Printer size={15} /> Imprimir / PDF</button>
        </div>
      </div>
    </div>
  );
}

function VentasManager({ data, persist, businessName }) {
  const [filtro, setFiltro] = useState("hoy");
  const [viendo, setViendo] = useState(null);

  const ventas = (data.ventas || []).slice().sort((a, b) => b.consecutivo - a.consecutivo);
  const filtradas = ventas.filter((v) => ventaEnRango(v, filtro));
  const activas = filtradas.filter((v) => v.status !== "anulada");
  const total = activas.reduce((sum, v) => sum + v.price, 0);

  async function anular(venta) {
    const ok = window.confirm(`¿Anular la venta N.° ${venta.consecutivo}? Queda marcada como anulada pero no se borra del historial.`);
    if (!ok) return;
    await persist({ ...data, ventas: (data.ventas || []).map((v) => (v.id === venta.id ? { ...v, status: "anulada" } : v)) });
  }
  async function eliminar(venta) {
    const ok = window.confirm(`¿Eliminar definitivamente la venta N.° ${venta.consecutivo}? Esta acción no se puede deshacer.`);
    if (!ok) return;
    await persist({ ...data, ventas: (data.ventas || []).filter((v) => v.id !== venta.id) });
  }
  function enviarWhatsapp(venta) {
    const phone = (venta.clientPhone || "").replace(/\D/g, "");
    if (!phone) { window.alert("Esta clienta no tiene teléfono registrado."); return; }
    const msg = `Hola ${venta.clientName}, aquí tienes tu comprobante de ${businessName}:\n\nN.° ${venta.consecutivo}\nServicio: ${venta.serviceName}\nValor: ${money(venta.price)}\nFecha: ${venta.date}\n\n¡Gracias por tu visita!`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  return (
    <div className="panel">
      <h3 className="section-title">Ventas</h3>
      <div className="filter-row">
        {[["hoy", "Hoy"], ["semana", "Esta semana"], ["mes", "Este mes"], ["todas", "Todas"]].map(([k, l]) => (
          <button key={k} className={`chip ${filtro === k ? "chip-active" : ""}`} onClick={() => setFiltro(k)}>{l}</button>
        ))}
      </div>
      <div className="summary-bar">
        <div className="summary-item">Ventas activas<strong>{activas.length}</strong></div>
        <div className="summary-item">Total facturado<strong>{money(total)}</strong></div>
      </div>
      <button
        className="btn-ghost" style={{ marginBottom: "1rem" }}
        onClick={() => exportCSV(
          `ventas-${filtro}.csv`,
          ["Fecha", "N.°", "Clienta", "Servicio", "Trabajadora", "Valor", "Estado"],
          filtradas.map((v) => [v.date, v.consecutivo, v.clientName, v.serviceName, v.employeeName, v.price, v.status])
        )}
      >
        <Download size={14} /> Descargar Excel (CSV)
      </button>
      {filtradas.length === 0 && <p className="muted">No hay ventas en este rango. Se generan solas cuando marcas una cita como "Completada" en la agenda.</p>}
      <div className="appt-list">
        {filtradas.map((v) => (
          <div key={v.id} className="appt-row">
            <div>
              <div className="appt-service"><span className="consec">#{v.consecutivo}</span>{v.serviceName}</div>
              <div className="appt-meta">{v.clientName} · {v.date} · con {v.employeeName} · {money(v.price)}</div>
            </div>
            <div className="appt-right">
              <span className={`tag ${v.status === "anulada" ? "tag-cancelada" : "tag-confirmada"}`}>{v.status === "anulada" ? "Anulada" : "Activa"}</span>
              <button className="btn-ghost" onClick={() => setViendo(v)}><Printer size={14} /> Ver / Imprimir</button>
              <button className="btn-ghost" onClick={() => enviarWhatsapp(v)}><MessageCircle size={14} /> WhatsApp</button>
              {v.status !== "anulada" && <button className="btn-ghost" onClick={() => anular(v)}><Ban size={14} /> Anular</button>}
              <button className="btn-ghost-danger" onClick={() => eliminar(v)}><Trash2 size={14} /> Eliminar</button>
            </div>
          </div>
        ))}
      </div>
      {viendo && <VentaReceipt venta={viendo} businessName={businessName} onClose={() => setViendo(null)} />}
    </div>
  );
}

function computeRango(rango, customStart, customEnd) {
  const today = todayISO();
  if (rango === "hoy") return { start: today, end: today };
  if (rango === "semana") {
    const t = new Date();
    const start = new Date(t);
    start.setDate(t.getDate() - t.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: toISO(start), end: toISO(end) };
  }
  if (rango === "mes") {
    const t = new Date();
    const start = new Date(t.getFullYear(), t.getMonth(), 1);
    const end = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    return { start: toISO(start), end: toISO(end) };
  }
  return { start: customStart || today, end: customEnd || today };
}

function ReportesView({ data, businessName }) {
  const [rango, setRango] = useState("hoy");
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());

  const { start, end } = computeRango(rango, customStart, customEnd);
  const ventas = (data.ventas || []).filter((v) => v.status !== "anulada" && v.date >= start && v.date <= end);
  const total = ventas.reduce((s, v) => s + v.price, 0);

  const porServicio = {};
  ventas.forEach((v) => {
    porServicio[v.serviceName] = porServicio[v.serviceName] || { count: 0, total: 0 };
    porServicio[v.serviceName].count++;
    porServicio[v.serviceName].total += v.price;
  });

  const porTrabajadora = {};
  ventas.forEach((v) => {
    porTrabajadora[v.employeeName] = porTrabajadora[v.employeeName] || { count: 0, total: 0 };
    porTrabajadora[v.employeeName].count++;
    porTrabajadora[v.employeeName].total += v.price;
  });

  const rangoLabel =
    rango === "hoy" ? `Diario · ${start}` :
    rango === "semana" ? `Semanal · ${start} a ${end}` :
    rango === "mes" ? `Mensual · ${start} a ${end}` :
    `${start} a ${end}`;

  return (
    <div className="panel">
      <h3 className="section-title">Reportes</h3>
      <div className="filter-row no-print">
        {[["hoy", "Diario"], ["semana", "Semanal"], ["mes", "Mensual"], ["custom", "Rango personalizado"]].map(([k, l]) => (
          <button key={k} className={`chip ${rango === k ? "chip-active" : ""}`} onClick={() => setRango(k)}>{l}</button>
        ))}
      </div>
      {rango === "custom" && (
        <div className="form-grid no-print" style={{ maxWidth: 420 }}>
          <input className="input" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          <input className="input" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
        </div>
      )}

      <div className="print-area">
        <div className="report-head">
          <h3>{businessName}</h3>
          <p className="muted">Reporte de ventas · {rangoLabel}</p>
        </div>
        <div className="summary-bar">
          <div className="summary-item">Ventas<strong>{ventas.length}</strong></div>
          <div className="summary-item">Total facturado<strong>{money(total)}</strong></div>
        </div>

        <h4 className="report-sub">Por servicio</h4>
        <div className="appt-list">
          {Object.entries(porServicio).map(([name, v]) => (
            <div key={name} className="appt-row">
              <div className="appt-service">{name}</div>
              <div className="appt-right"><span className="muted">{v.count} · {money(v.total)}</span></div>
            </div>
          ))}
          {Object.keys(porServicio).length === 0 && <p className="muted">Sin ventas en este rango.</p>}
        </div>

        <h4 className="report-sub" style={{ marginTop: "1.5rem" }}>Por trabajadora</h4>
        <div className="appt-list">
          {Object.entries(porTrabajadora).map(([name, v]) => (
            <div key={name} className="appt-row">
              <div className="appt-service">{name}</div>
              <div className="appt-right"><span className="muted">{v.count} servicios · {money(v.total)}</span></div>
            </div>
          ))}
          {Object.keys(porTrabajadora).length === 0 && <p className="muted">Sin ventas en este rango.</p>}
        </div>
      </div>

      <button className="btn-primary no-print" style={{ marginTop: "1.3rem" }} onClick={() => window.print()}>
        <Printer size={15} /> Imprimir reporte
      </button>
      <button
        className="btn-ghost no-print" style={{ marginTop: "1.3rem", marginLeft: ".6rem" }}
        onClick={() => exportCSV(
          `reporte-ventas-${start}_a_${end}.csv`,
          ["Fecha", "N.°", "Clienta", "Servicio", "Trabajadora", "Valor", "Estado"],
          ventas.map((v) => [v.date, v.consecutivo, v.clientName, v.serviceName, v.employeeName, v.price, v.status])
        )}
      >
        <Download size={15} /> Descargar Excel (CSV)
      </button>
    </div>
  );
}

function InventarioManager({ data, persist }) {
  const [prodNombre, setProdNombre] = useState("");
  const [prodCantidad, setProdCantidad] = useState(1);
  const [prodCosto, setProdCosto] = useState(0);
  const [prodProveedor, setProdProveedor] = useState("");
  const [compraError, setCompraError] = useState("");

  async function registrarCompra() {
    if (!prodNombre.trim() || Number(prodCantidad) <= 0 || Number(prodCosto) < 0) {
      setCompraError("Completa el nombre, la cantidad y el costo.");
      return;
    }
    const nombreNorm = prodNombre.trim();
    let productos = data.productos || [];
    let producto = productos.find((p) => p.name.toLowerCase() === nombreNorm.toLowerCase());
    if (producto) {
      productos = productos.map((p) =>
        p.id === producto.id ? { ...p, stock: p.stock + Number(prodCantidad), costoUnitario: Number(prodCosto) } : p
      );
    } else {
      producto = { id: uid(), name: nombreNorm, stock: Number(prodCantidad), costoUnitario: Number(prodCosto) };
      productos = [...productos, producto];
    }
    const compra = {
      id: uid(), productId: producto.id, productName: nombreNorm,
      cantidad: Number(prodCantidad), costoUnitario: Number(prodCosto),
      costoTotal: Number(prodCantidad) * Number(prodCosto),
      proveedor: prodProveedor.trim(), fecha: todayISO(), createdAt: Date.now(),
    };
    await persist({ ...data, productos, compras: [...(data.compras || []), compra] });
    setProdNombre(""); setProdCantidad(1); setProdCosto(0); setProdProveedor(""); setCompraError("");
  }

  const [ventaProductoId, setVentaProductoId] = useState("");
  const [ventaEmpleadoId, setVentaEmpleadoId] = useState("");
  const [ventaCantidad, setVentaCantidad] = useState(1);
  const [ventaPrecio, setVentaPrecio] = useState(0);
  const [ventaError, setVentaError] = useState("");

  const productoSel = (data.productos || []).find((p) => p.id === ventaProductoId);

  async function venderAlEquipo() {
    if (!productoSel || !ventaEmpleadoId || Number(ventaCantidad) <= 0 || Number(ventaPrecio) < 0) {
      setVentaError("Completa el producto, la trabajadora, la cantidad y el precio.");
      return;
    }
    if (Number(ventaCantidad) > productoSel.stock) {
      setVentaError(`Solo quedan ${productoSel.stock} unidades en inventario.`);
      return;
    }
    const empleado = data.employees.find((e) => e.id === ventaEmpleadoId);
    const cantidad = Number(ventaCantidad);
    const precioUnitario = Number(ventaPrecio);
    const total = cantidad * precioUnitario;
    const utilidad = (precioUnitario - productoSel.costoUnitario) * cantidad;
    const consecutivo = data.nextVentaEquipo || 1;
    const ventaEquipo = {
      id: uid(), consecutivo, productId: productoSel.id, productName: productoSel.name,
      employeeId: empleado.id, employeeName: empleado.name,
      cantidad, precioUnitario, costoUnitario: productoSel.costoUnitario,
      total, utilidad, fecha: todayISO(), createdAt: Date.now(), status: "activa",
    };
    const productos = (data.productos || []).map((p) => (p.id === productoSel.id ? { ...p, stock: p.stock - cantidad } : p));
    await persist({
      ...data, productos,
      ventasEquipo: [...(data.ventasEquipo || []), ventaEquipo],
      nextVentaEquipo: consecutivo + 1,
    });
    setVentaProductoId(""); setVentaEmpleadoId(""); setVentaCantidad(1); setVentaPrecio(0); setVentaError("");
  }

  async function anularVentaEquipo(v) {
    const ok = window.confirm(`¿Anular esta venta al equipo? Se devuelven ${v.cantidad} unidades al inventario.`);
    if (!ok) return;
    const productos = (data.productos || []).map((p) => (p.id === v.productId ? { ...p, stock: p.stock + v.cantidad } : p));
    await persist({
      ...data, productos,
      ventasEquipo: (data.ventasEquipo || []).map((x) => (x.id === v.id ? { ...x, status: "anulada" } : x)),
    });
  }

  const productos = data.productos || [];
  const compras = (data.compras || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const ventasEquipo = (data.ventasEquipo || []).slice().sort((a, b) => b.consecutivo - a.consecutivo);

  return (
    <>
      <div className="panel">
        <h3 className="section-title">Registrar compra</h3>
        <div className="form-grid">
          <input className="input" placeholder="Producto (ej: Esmalte rojo OPI)" value={prodNombre} onChange={(e) => setProdNombre(e.target.value)} />
          <input className="input" type="number" placeholder="Cantidad" value={prodCantidad} onChange={(e) => setProdCantidad(e.target.value)} />
          <input className="input" type="number" placeholder="Costo por unidad" value={prodCosto} onChange={(e) => setProdCosto(e.target.value)} />
          <input className="input" placeholder="Proveedor (opcional)" value={prodProveedor} onChange={(e) => setProdProveedor(e.target.value)} />
        </div>
        {compraError && <p className="error-text">{compraError}</p>}
        <button className="btn-primary" onClick={registrarCompra}><Plus size={15} /> Registrar compra</button>
      </div>

      <div className="panel" style={{ marginTop: "1.5rem" }}>
        <h3 className="section-title">Inventario actual</h3>
        {productos.length === 0 && <p className="muted">Aún no has registrado compras.</p>}
        <div className="appt-list">
          {productos.map((p) => (
            <div key={p.id} className="appt-row">
              <div>
                <div className="appt-service">{p.name}</div>
                <div className="appt-meta">Costo unitario {money(p.costoUnitario)}</div>
              </div>
              <span className={`tag ${p.stock > 0 ? "tag-confirmada" : "tag-cancelada"}`}>{p.stock} en stock</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: "1.5rem" }}>
        <h3 className="section-title">Venderle al equipo</h3>
        <div className="form-grid">
          <select className="input" value={ventaProductoId} onChange={(e) => setVentaProductoId(e.target.value)}>
            <option value="">Elige un producto</option>
            {productos.filter((p) => p.stock > 0).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.stock} disp.)</option>)}
          </select>
          <select className="input" value={ventaEmpleadoId} onChange={(e) => setVentaEmpleadoId(e.target.value)}>
            <option value="">Elige a la trabajadora</option>
            {data.employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input className="input" type="number" placeholder="Cantidad" value={ventaCantidad} onChange={(e) => setVentaCantidad(e.target.value)} />
          <input className="input" type="number" placeholder="Precio de venta por unidad" value={ventaPrecio} onChange={(e) => setVentaPrecio(e.target.value)} />
        </div>
        {productoSel && (
          <p className="field-hint">
            Costo: {money(productoSel.costoUnitario)} por unidad
            {Number(ventaPrecio) > 0 && ` · Utilidad estimada: ${money((Number(ventaPrecio) - productoSel.costoUnitario) * Number(ventaCantidad || 0))}`}
          </p>
        )}
        {ventaError && <p className="error-text">{ventaError}</p>}
        <button className="btn-primary" onClick={venderAlEquipo}><Plus size={15} /> Registrar venta al equipo</button>
      </div>

      <div className="panel" style={{ marginTop: "1.5rem" }}>
        <h3 className="section-title">Historial de ventas al equipo</h3>
        {ventasEquipo.length === 0 && <p className="muted">Todavía no le has vendido nada al equipo.</p>}
        <div className="appt-list">
          {ventasEquipo.map((v) => (
            <div key={v.id} className="appt-row">
              <div>
                <div className="appt-service"><span className="consec">#{v.consecutivo}</span>{v.productName} × {v.cantidad}</div>
                <div className="appt-meta">{v.employeeName} · {v.fecha} · {money(v.total)} · utilidad {money(v.utilidad)}</div>
              </div>
              <div className="appt-right">
                <span className={`tag ${v.status === "anulada" ? "tag-cancelada" : "tag-confirmada"}`}>{v.status === "anulada" ? "Anulada" : "Activa"}</span>
                {v.status !== "anulada" && <button className="btn-ghost-danger" onClick={() => anularVentaEquipo(v)}><Ban size={14} /> Anular</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: "1.5rem" }}>
        <h3 className="section-title">Historial de compras</h3>
        {compras.length === 0 && <p className="muted">Sin compras registradas.</p>}
        <div className="appt-list">
          {compras.map((c) => (
            <div key={c.id} className="appt-row">
              <div>
                <div className="appt-service">{c.productName} × {c.cantidad}</div>
                <div className="appt-meta">{c.fecha}{c.proveedor ? ` · ${c.proveedor}` : ""} · {money(c.costoUnitario)}/u</div>
              </div>
              <span className="tag tag-admin">{money(c.costoTotal)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const GASTO_CATEGORIAS = ["Arriendo", "Servicios públicos", "Insumos", "Nómina", "Otro"];

function GastosManager({ data, persist }) {
  const [concepto, setConcepto] = useState("");
  const [categoria, setCategoria] = useState(GASTO_CATEGORIAS[0]);
  const [monto, setMonto] = useState(0);
  const [fecha, setFecha] = useState(todayISO());
  const [error, setError] = useState("");

  async function addGasto() {
    if (!concepto.trim() || Number(monto) <= 0) { setError("Completa el concepto y el monto."); return; }
    const gasto = { id: uid(), concepto: concepto.trim(), categoria, monto: Number(monto), fecha, createdAt: Date.now() };
    await persist({ ...data, gastos: [...(data.gastos || []), gasto] });
    setConcepto(""); setMonto(0); setFecha(todayISO()); setError("");
  }
  async function removeGasto(g) {
    const ok = window.confirm(`¿Eliminar el gasto "${g.concepto}"?`);
    if (!ok) return;
    await persist({ ...data, gastos: (data.gastos || []).filter((x) => x.id !== g.id) });
  }

  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const enEsteMes = (fechaISO) => { const d = fromISO(fechaISO); return d.getFullYear() === y && d.getMonth() === m; };

  const gastosMes = (data.gastos || []).filter((g) => enEsteMes(g.fecha));
  const totalGastosManuales = gastosMes.reduce((s, g) => s + g.monto, 0);

  const ventasMes = (data.ventas || []).filter((v) => v.status !== "anulada" && enEsteMes(v.date));
  const totalIngresosServicios = ventasMes.reduce((s, v) => s + v.price, 0);

  const ventasEquipoMes = (data.ventasEquipo || []).filter((v) => v.status !== "anulada" && enEsteMes(v.fecha));
  const totalVentasEquipo = ventasEquipoMes.reduce((s, v) => s + v.total, 0);

  const comprasMes = (data.compras || []).filter((c) => enEsteMes(c.fecha));
  const totalCompras = comprasMes.reduce((s, c) => s + c.costoTotal, 0);

  const liquidacionesMes = (data.liquidaciones || []).filter((l) => {
    const d = new Date(l.createdAt);
    return d.getFullYear() === y && d.getMonth() === m;
  });
  const totalComisiones = liquidacionesMes.reduce((s, l) => s + l.comision, 0);

  const totalIngresos = totalIngresosServicios + totalVentasEquipo;
  const totalEgresos = totalGastosManuales + totalCompras + totalComisiones;
  const utilidadNeta = totalIngresos - totalEgresos;

  const porTrabajadora = {};
  ventasMes.forEach((v) => { porTrabajadora[v.employeeName] = (porTrabajadora[v.employeeName] || 0) + v.price; });

  const gastosOrdenados = (data.gastos || []).slice().sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.createdAt - a.createdAt));

  return (
    <>
      <div className="panel">
        <h3 className="section-title">Registrar gasto</h3>
        <div className="form-grid">
          <input className="input" placeholder="Concepto (ej: Arriendo local)" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
          <select className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {GASTO_CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="input" type="number" placeholder="Monto" value={monto} onChange={(e) => setMonto(e.target.value)} />
          <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn-primary" onClick={addGasto}><Plus size={15} /> Registrar gasto</button>
      </div>

      <div className="panel" style={{ marginTop: "1.5rem" }}>
        <h3 className="section-title">Resumen de {MONTHS[m]}</h3>
        <div className="appt-list">
          <div className="appt-row"><div className="appt-service">Ingresos por servicios</div><span className="muted">{money(totalIngresosServicios)}</span></div>
          <div className="appt-row"><div className="appt-service">Ingresos por ventas al equipo</div><span className="muted">{money(totalVentasEquipo)}</span></div>
          <div className="appt-row"><div className="appt-service">Compras del mes</div><span className="muted">-{money(totalCompras)}</span></div>
          <div className="appt-row"><div className="appt-service">Comisiones liquidadas</div><span className="muted">-{money(totalComisiones)}</span></div>
          <div className="appt-row"><div className="appt-service">Gastos varios</div><span className="muted">-{money(totalGastosManuales)}</span></div>
        </div>
        <div className="stat-grid" style={{ marginTop: "1.1rem" }}>
          <div className="stat-card"><div className="stat-num">{money(totalIngresos)}</div><div className="stat-label">Total ingresos</div></div>
          <div className="stat-card"><div className="stat-num">{money(totalEgresos)}</div><div className="stat-label">Total egresos</div></div>
          <div className="stat-card"><div className="stat-num">{money(utilidadNeta)}</div><div className="stat-label">Utilidad neta</div></div>
        </div>
        <h4 className="report-sub" style={{ marginTop: "1.3rem" }}>Ingresos por trabajadora (servicios)</h4>
        <div className="appt-list">
          {Object.entries(porTrabajadora).map(([name, tot]) => (
            <div key={name} className="appt-row">
              <div className="appt-service">{name}</div>
              <span className="muted">{money(tot)}</span>
            </div>
          ))}
          {Object.keys(porTrabajadora).length === 0 && <p className="muted">Sin ventas este mes todavía.</p>}
        </div>
      </div>

      <div className="panel" style={{ marginTop: "1.5rem" }}>
        <h3 className="section-title">Historial de gastos</h3>
        {gastosOrdenados.length === 0 && <p className="muted">Sin gastos registrados.</p>}
        <div className="appt-list">
          {gastosOrdenados.map((g) => (
            <div key={g.id} className="appt-row">
              <div>
                <div className="appt-service">{g.concepto}</div>
                <div className="appt-meta">{g.categoria} · {g.fecha}</div>
              </div>
              <div className="appt-right">
                <span className="tag tag-cancelada">{money(g.monto)}</span>
                <button className="btn-ghost-danger" onClick={() => removeGasto(g)}><Trash2 size={14} /> Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function ComisionesManager({ data, persist, businessName }) {
  const [tarifa, setTarifa] = useState(data.comisionDiaria || 20000);
  const [empleadoId, setEmpleadoId] = useState("");
  const [rango, setRango] = useState("hoy");
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());

  async function guardarTarifa(v) {
    setTarifa(v);
    await persist({ ...data, comisionDiaria: Number(v) || 0 });
  }

  const { start, end } = computeRango(rango, customStart, customEnd);
  const empleado = data.employees.find((e) => e.id === empleadoId);

  const ventasEmp = empleado
    ? (data.ventas || []).filter((v) => v.status !== "anulada" && v.employeeId === empleado.id && v.date >= start && v.date <= end)
    : [];
  const porDia = {};
  ventasEmp.forEach((v) => { porDia[v.date] = (porDia[v.date] || 0) + v.price; });
  const diasTrabajados = Object.keys(porDia).length;
  const totalGenerado = ventasEmp.reduce((s, v) => s + v.price, 0);
  const comision = diasTrabajados * Number(tarifa || 0);
  const neto = totalGenerado - comision;

  async function registrarLiquidacion() {
    if (!empleado) return;
    const liq = {
      id: uid(), employeeId: empleado.id, employeeName: empleado.name,
      desde: start, hasta: end, diasTrabajados, totalGenerado, tarifaDiaria: Number(tarifa || 0),
      comision, neto, createdAt: Date.now(),
    };
    await persist({ ...data, liquidaciones: [...(data.liquidaciones || []), liq] });
  }

  function enviarWhatsapp() {
    if (!empleado) return;
    const phone = (empleado.phone || "").replace(/\D/g, "");
    if (!phone) { window.alert("Esta trabajadora no tiene teléfono registrado. Agrégalo en la pestaña Equipo."); return; }
    const msg = `Hola ${empleado.name}, aquí está tu liquidación de ${businessName} del ${start} al ${end}:\n\nDías trabajados: ${diasTrabajados}\nTotal generado: ${money(totalGenerado)}\nComisión (${diasTrabajados} × ${money(tarifa)}): ${money(comision)}\n\nNeto a pagar: ${money(neto)}\n\n¡Gracias por tu trabajo!`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  const liquidacionesEmp = empleado
    ? (data.liquidaciones || []).filter((l) => l.employeeId === empleado.id).sort((a, b) => b.createdAt - a.createdAt)
    : [];

  return (
    <>
      <div className="panel">
        <h3 className="section-title">Comisión por día trabajado</h3>
        <div className="form-grid">
          <input className="input" type="number" placeholder="Tarifa diaria" value={tarifa} onChange={(e) => guardarTarifa(e.target.value)} />
          <select className="input" value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)}>
            <option value="">Elige una trabajadora</option>
            {data.employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="filter-row">
          {[["hoy", "Diario"], ["semana", "Semanal"], ["custom", "Rango personalizado"]].map(([k, l]) => (
            <button key={k} className={`chip ${rango === k ? "chip-active" : ""}`} onClick={() => setRango(k)}>{l}</button>
          ))}
        </div>
        {rango === "custom" && (
          <div className="form-grid" style={{ maxWidth: 420 }}>
            <input className="input" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <input className="input" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </div>
        )}
        {!empleado && <p className="muted">Elige una trabajadora para calcular su liquidación.</p>}
      </div>

      {empleado && (
        <div className="panel" style={{ marginTop: "1.5rem" }}>
          <h3 className="section-title">{empleado.name} · {start} a {end}</h3>
          <div className="stat-grid">
            <div className="stat-card"><div className="stat-num">{diasTrabajados}</div><div className="stat-label">Días trabajados</div></div>
            <div className="stat-card"><div className="stat-num">{money(totalGenerado)}</div><div className="stat-label">Total generado</div></div>
            <div className="stat-card"><div className="stat-num">{money(comision)}</div><div className="stat-label">Comisión</div></div>
            <div className="stat-card"><div className="stat-num">{money(neto)}</div><div className="stat-label">Neto a liquidar</div></div>
          </div>
          <h4 className="report-sub" style={{ marginTop: "1.2rem" }}>Detalle por día</h4>
          <div className="appt-list">
            {Object.entries(porDia).map(([fecha, total]) => (
              <div key={fecha} className="appt-row">
                <div className="appt-service">{fecha}</div>
                <span className="muted">{money(total)}</span>
              </div>
            ))}
            {diasTrabajados === 0 && <p className="muted">Sin ventas en este rango.</p>}
          </div>
          <div className="row-gap" style={{ marginTop: "1.2rem" }}>
            <button className="btn-ghost" onClick={enviarWhatsapp}><MessageCircle size={15} /> Enviar por WhatsApp</button>
            <button className="btn-primary" onClick={registrarLiquidacion}><Check size={15} /> Registrar liquidación</button>
          </div>
        </div>
      )}

      {empleado && liquidacionesEmp.length > 0 && (
        <div className="panel" style={{ marginTop: "1.5rem" }}>
          <h3 className="section-title">Historial de liquidaciones</h3>
          <div className="appt-list">
            {liquidacionesEmp.map((l) => (
              <div key={l.id} className="appt-row">
                <div>
                  <div className="appt-service">{l.desde} a {l.hasta}</div>
                  <div className="appt-meta">{l.diasTrabajados} días · comisión {money(l.comision)}</div>
                </div>
                <span className="tag tag-confirmada">Neto {money(l.neto)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function NuevaCitaAdmin({ data, persist }) {
  const [clientId, setClientId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("");
  const [error, setError] = useState("");

  const service = data.services.find((s) => s.id === serviceId);
  const eligibleEmployees = data.employees.filter((e) => e.active && e.serviceIds.includes(serviceId));
  const clientOptions = clientSearch.trim()
    ? data.clients.filter((c) => {
        const q = clientSearch.trim().toLowerCase();
        return c.name.toLowerCase().includes(q) || (c.phone || "").includes(q) || (c.email || "").toLowerCase().includes(q);
      })
    : data.clients;

  function isFreeFor(empId, dateISO, startMin, duration) {
    const end = startMin + duration;
    return !data.appointments.some((x) => {
      if (x.employeeId !== empId || x.date !== dateISO || (x.status === "cancelada" || x.status === "rechazada")) return false;
      const xStart = timeToMin(x.time);
      const xEnd = xStart + x.duration;
      return startMin < xEnd && end > xStart;
    });
  }

  const slots = [];
  const empSel = data.employees.find((e) => e.id === employeeId);
  const empWorksThatDay = empSel ? employeeWorksOn(empSel, date) : true;
  if (service && employeeId && empWorksThatDay) {
    for (let m = OPEN_START_MIN; m + service.duration <= OPEN_END_MIN; m += SLOT_STEP_MIN) {
      if (isFreeFor(employeeId, date, m, service.duration)) slots.push(minToTime(m));
    }
  }

  async function crear() {
    if (!clientId || !service || !employeeId || !time) { setError("Completa la clienta, el servicio, la trabajadora y la hora."); return; }
    const appt = {
      id: uid(), clientId, employeeId, serviceId,
      serviceName: service.name, price: service.price, duration: service.duration,
      date, time, status: "confirmada", createdAt: Date.now(),
    };
    const ok = await persist({ ...data, appointments: [...data.appointments, appt] });
    if (ok === false) {
      setError("No se pudo asignar la cita: hubo un problema de conexión con el servidor. Intenta de nuevo.");
      return;
    }
    setClientId(""); setServiceId(""); setEmployeeId(""); setTime(""); setError("");
  }

  return (
    <div className="panel" style={{ marginBottom: "1.5rem" }}>
      <h3 className="section-title">Asignar nueva cita</h3>
      <div className="form-grid">
        <div>
          <input className="input" placeholder="Buscar clienta por nombre o teléfono" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} style={{ marginBottom: ".4rem" }} />
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Elige una clienta</option>
            {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <select className="input" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setEmployeeId(""); setTime(""); }}>
          <option value="">Elige un servicio</option>
          {data.services.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}
        </select>
        <select className="input" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setTime(""); }} disabled={!serviceId}>
          <option value="">Elige una trabajadora</option>
          {eligibleEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <input className="input" type="date" value={date} min={todayISO()} onChange={(e) => { setDate(e.target.value); setTime(""); }} />
      </div>
      {employeeId && service && (
        <div className="slot-grid" style={{ marginBottom: ".9rem" }}>
          {slots.map((t) => (
            <button key={t} className={`slot-btn ${time === t ? "slot-btn-active" : ""}`} onClick={() => setTime(t)}>{t}</button>
          ))}
          {slots.length === 0 && <p className="muted">Sin horarios libres ese día para esa trabajadora.</p>}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <button className="btn-primary" onClick={crear}><Plus size={15} /> Asignar cita</button>
    </div>
  );
}

function ClientsManager({ data, persist }) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [redeemId, setRedeemId] = useState(null);
  const [redeemAmount, setRedeemAmount] = useState("");

  const filtered = data.clients.filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.phone || "").includes(q) || (c.email || "").toLowerCase().includes(q);
  }).slice().sort((a, b) => a.name.localeCompare(b.name));

  function statsFor(clientId) {
    const appts = data.appointments.filter((a) => a.clientId === clientId && a.status !== "cancelada");
    const last = appts.slice().sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1))[0];
    return { count: appts.length, last: last ? `${last.date} · ${last.serviceName}` : null };
  }

  function startEdit(c) {
    setEditingId(c.id);
    setNotesDraft(c.notes || "");
  }
  function cancelEdit() {
    setEditingId(null);
    setNotesDraft("");
  }
  async function saveNotes(c) {
    const ok = await persist({ ...data, clients: data.clients.map((x) => (x.id === c.id ? { ...x, notes: notesDraft.trim() } : x)) });
    if (ok === false) {
      window.alert("No se pudo guardar la nota: problema de conexión con el servidor. Intenta de nuevo.");
      return;
    }
    setEditingId(null);
  }
  async function redeem(c) {
    const n = Number(redeemAmount);
    if (!n || n <= 0 || n > (c.points || 0)) return;
    const ok = await persist({ ...data, clients: data.clients.map((x) => (x.id === c.id ? { ...x, points: (x.points || 0) - n } : x)) });
    if (ok === false) {
      window.alert("No se pudo canjear los puntos: problema de conexión con el servidor. Intenta de nuevo.");
      return;
    }
    setRedeemId(null); setRedeemAmount("");
  }

  return (
    <div className="panel">
      <h3 className="section-title">Clientas</h3>
      <input className="input" placeholder="Buscar por nombre, teléfono o correo" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: "1rem", maxWidth: 360 }} />
      {filtered.length === 0 && <p className="muted">No hay clientas que coincidan con la búsqueda.</p>}
      <div className="appt-list">
        {filtered.map((c) => {
          const stats = statsFor(c.id);
          return (
            <div key={c.id} className="appt-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: ".75rem", flexWrap: "wrap" }}>
                <div>
                  <div className="appt-service">{c.name}</div>
                  <div className="appt-meta">
                    {c.phone ? `${c.phone} · ` : ""}{c.email}
                  </div>
                  <div className="appt-meta">
                    {stats.count} cita{stats.count === 1 ? "" : "s"}{stats.last ? ` · última: ${stats.last}` : ""}
                    {(c.points || 0) > 0 && <> · <strong>{c.points} pts</strong></>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                  {(c.points || 0) > 0 && editingId !== c.id && (
                    <button className="btn-ghost" onClick={() => { if (redeemId === c.id) { setRedeemId(null); } else { setRedeemId(c.id); setRedeemAmount(""); } }}>
                      {redeemId === c.id ? "Cerrar" : "Canjear puntos"}
                    </button>
                  )}
                  {editingId !== c.id && (
                    <button className="btn-ghost" onClick={() => startEdit(c)}>{c.notes ? "Editar notas" : "+ Agregar notas"}</button>
                  )}
                </div>
              </div>
              {c.notes && editingId !== c.id && (
                <div className="appt-meta" style={{ marginTop: ".5rem", whiteSpace: "pre-wrap" }}>📝 {c.notes}</div>
              )}
              {redeemId === c.id && (
                <div style={{ width: "100%", marginTop: ".8rem", display: "flex", gap: ".6rem", alignItems: "center", flexWrap: "wrap" }}>
                  <input className="input" type="number" min="1" max={c.points || 0} placeholder={`Máx. ${c.points} pts`} style={{ maxWidth: 160 }} value={redeemAmount} onChange={(e) => setRedeemAmount(e.target.value)} />
                  <button className="btn-primary" onClick={() => redeem(c)}>Confirmar canje</button>
                </div>
              )}
              {editingId === c.id && (
                <div style={{ width: "100%", marginTop: ".8rem" }}>
                  <textarea
                    className="textarea"
                    placeholder="Preferencias, alergias, tono favorito, alguna anotación útil…"
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    style={{ marginBottom: ".6rem" }}
                  />
                  <div style={{ display: "flex", gap: ".6rem" }}>
                    <button className="btn-primary" onClick={() => saveNotes(c)}>Guardar</button>
                    <button className="btn-ghost" onClick={cancelEdit}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamApp({ data, persist, session, onLogout }) {
  const me = data.employees.find((e) => e.id === session.id);
  const [tab, setTab] = useState("agenda");
  const navItems = [{ key: "agenda", label: "Mi agenda", icon: Calendar }];
  if (me?.isAdmin) {
    navItems.push(
      { key: "citas", label: "Todas las citas", icon: Clock },
      { key: "clientas", label: "Clientas", icon: User },
      { key: "ventas", label: "Ventas", icon: Receipt },
      { key: "reportes", label: "Reportes", icon: FileText },
      { key: "equipo", label: "Equipo", icon: Users },
      { key: "servicios", label: "Servicios", icon: Scissors },
      { key: "promociones", label: "Promociones", icon: Megaphone },
      { key: "inventario", label: "Inventario", icon: Package },
      { key: "gastos", label: "Gastos", icon: Wallet },
      { key: "comisiones", label: "Comisiones", icon: Percent },
      { key: "estadisticas", label: "Estadísticas", icon: TrendingUp },
    );
  }
  return (
    <Shell
      title={data.businessName}
      personName={me?.name?.split(" ")[0] || ""}
      roleLabel={me?.isAdmin ? "Administradora" : "Equipo"}
      nav={navItems} active={tab} onNav={setTab} onLogout={onLogout}
    >
      {tab === "agenda" && <AgendaView data={data} persist={persist} employeeId={me.id} onlyMine isAdmin={!!me?.isAdmin} />}
      {tab === "citas" && me?.isAdmin && (
        <>
          <NuevaCitaAdmin data={data} persist={persist} />
          <AgendaView data={data} persist={persist} onlyMine={false} isAdmin />
        </>
      )}
      {tab === "ventas" && me?.isAdmin && <VentasManager data={data} persist={persist} businessName={data.businessName} />}
      {tab === "clientas" && me?.isAdmin && <ClientsManager data={data} persist={persist} />}
      {tab === "reportes" && me?.isAdmin && <ReportesView data={data} businessName={data.businessName} />}
      {tab === "equipo" && me?.isAdmin && <TeamManager data={data} persist={persist} />}
      {tab === "servicios" && me?.isAdmin && <ServicesManager data={data} persist={persist} />}
      {tab === "promociones" && me?.isAdmin && <PromotionsManager data={data} persist={persist} />}
      {tab === "inventario" && me?.isAdmin && <InventarioManager data={data} persist={persist} />}
      {tab === "gastos" && me?.isAdmin && <GastosManager data={data} persist={persist} />}
      {tab === "comisiones" && me?.isAdmin && <ComisionesManager data={data} persist={persist} businessName={data.businessName} />}
      {tab === "estadisticas" && me?.isAdmin && <StatsView data={data} />}
    </Shell>
  );
}

/* ---------------------------------- Puerta de entrada (código de empresa) ---------------------------------- */

function CompanyGate({ registry, initialCode, onEnter, onPlatform }) {
  const [code, setCode] = useState(initialCode || "");
  const [status, setStatus] = useState(null);
  const [expiredInfo, setExpiredInfo] = useState(null);
  const triedAuto = useRef(false);

  function submit(candidate) {
    const slug = slugify(candidate ?? code);
    if (!slug) return;
    const company = (registry.companies || []).find((c) => c.slug === slug);
    if (!company) { setStatus("not-found"); return; }
    if (vigenciaStatus(company) === "vencida") {
      setStatus("expired");
      setExpiredInfo(company);
      return;
    }
    setStatus(null);
    onEnter(company);
  }

  useEffect(() => {
    if (initialCode && !triedAuto.current) {
      triedAuto.current = true;
      submit(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  return (
    <div className="hero">
      <div className="hero-decor" aria-hidden="true" />
      <div className="hero-copy">
        <div className="brand-label">
          <span className="brand-photo"><img src={LOGO_SRC} alt="" /></span>
          BellaStudio
        </div>
        <h1>Tu talento,<br />bien agendado.</h1>
        <p>Escribe el código de tu empresa para entrar a tu espacio.</p>
        <div className="form-grid-1" style={{ maxWidth: 360 }}>
          <input
            className="input" placeholder="Código de tu empresa" value={code}
            onChange={(e) => { setCode(e.target.value); setStatus(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
          {status === "not-found" && <p className="error-text">No encontramos una empresa con ese código.</p>}
          {status === "expired" && (
            <p className="error-text">
              La vigencia de {expiredInfo?.name} venció el {expiredInfo?.vigenciaFin}. Contacta a la administradora de la plataforma para renovarla.
            </p>
          )}
          <button className="btn-primary" onClick={() => submit()}>Entrar</button>
        </div>
        <button className="back-link" style={{ marginTop: "1.4rem" }} type="button" onClick={onPlatform}>
          ¿Administras la plataforma? Entra aquí
        </button>
      </div>
      <div className="hero-card" aria-label="Tarjeta de servicios de belleza">
        <div className="hero-photo"><img src={LOGO_SRC} alt="BellaStudio" /></div>
        <strong>Manos que cuentan historias</strong>
        <span>Uñas · Keratina · Cuidado personal</span>
      </div>
    </div>
  );
}

/* ---------------------------------- Plataforma (super administración) ---------------------------------- */

function PlatformKeyForm({ onAuth }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function submit() {
    if (!key.trim()) { setError("Escribe la clave maestra."); return; }
    setChecking(true);
    const ok = await apiVerifyAdminKey(key.trim());
    setChecking(false);
    if (ok) {
      onAuth(key.trim());
    } else {
      setError("Clave incorrecta.");
    }
  }

  return (
    <>
      <h3 className="form-title">Panel de soporte</h3>
      <p className="form-sub">Escribe la clave maestra para crear y administrar las empresas.</p>
      <div className="form-grid-1">
        <input
          className="input" type="password" placeholder="Clave maestra" value={key}
          onChange={(e) => { setKey(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        {error && <p className="error-text">{error}</p>}
        <button className="btn-primary" onClick={submit} disabled={checking}>{checking ? "Verificando…" : "Entrar"}</button>
      </div>
    </>
  );
}

function PlatformAdmin({ registry, adminKey, persistRegistry, onEnterCompany, onLogout }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [inicio, setInicio] = useState(todayISO());
  const [vigenciaModo, setVigenciaModo] = useState("6m");
  const [customFecha, setCustomFecha] = useState("");
  const [error, setError] = useState("");
  const [renewingId, setRenewingId] = useState(null);
  const [renewModo, setRenewModo] = useState("1m");
  const [renewCustom, setRenewCustom] = useState("");
  const [copiedSlug, setCopiedSlug] = useState(null);

  async function createCompany() {
    const finalSlug = slugify(slug.trim() ? slug : name);
    if (!name.trim() || !finalSlug) { setError("Completa el nombre y el código de la empresa."); return; }
    if (vigenciaModo === "custom" && !customFecha) { setError("Elige la fecha personalizada de vencimiento."); return; }
    if ((registry.companies || []).some((c) => c.slug === finalSlug)) { setError("Ya existe una empresa con ese código."); return; }
    const vigenciaFin = computeVigenciaFin(vigenciaModo, inicio, customFecha);
    const company = { id: uid(), slug: finalSlug, name: name.trim(), vigenciaInicio: inicio, vigenciaFin, createdAt: Date.now() };
    await persistRegistry({ ...registry, companies: [...(registry.companies || []), company] });
    const seed = { ...defaultData(), businessName: name.trim() };
    await apiSetTenant(finalSlug, seed);
    setName(""); setSlug(""); setVigenciaModo("6m"); setCustomFecha(""); setError("");
  }

  function startRenew(company) {
    setRenewingId(company.id);
    setRenewModo(company.vigenciaFin ? "1m" : "permanente");
    setRenewCustom("");
  }

  async function applyRenew(company) {
    if (renewModo === "custom" && !renewCustom) return;
    const extendsFromCurrent = ["1m", "3m", "6m", "1a"].includes(renewModo);
    const base = extendsFromCurrent
      ? (company.vigenciaFin && vigenciaStatus(company) !== "vencida" ? company.vigenciaFin : todayISO())
      : todayISO();
    const vigenciaFin = computeVigenciaFin(renewModo, base, renewCustom);
    await persistRegistry({
      ...registry,
      companies: registry.companies.map((c) => (c.id === company.id ? { ...c, vigenciaFin } : c)),
    });
    setRenewingId(null);
  }

  async function removeCompany(company) {
    const ok = window.confirm(`¿Eliminar la empresa "${company.name}"? Esto borra su información (clientas, citas, equipo, servicios) de forma permanente.`);
    if (!ok) return;
    await persistRegistry({ ...registry, companies: registry.companies.filter((c) => c.id !== company.id) });
    await apiDeleteTenant(company.slug, adminKey);
  }

  async function copyLink(company) {
    const url = `${window.location.origin}/?empresa=${company.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(company.slug);
      setTimeout(() => setCopiedSlug(null), 1500);
    } catch {
      window.prompt("Copia el link manualmente:", url);
    }
  }

  const statusLabel = { activa: "Activa", "por-vencer": "Por vencer", vencida: "Vencida", permanente: "Sin vencimiento" };
  const statusTag = { activa: "tag-confirmada", "por-vencer": "tag-completada", vencida: "tag-cancelada", permanente: "tag-admin" };

  return (
    <Shell
      title="BellaStudio"
      personName="Soporte"
      roleLabel="Plataforma"
      nav={[{ key: "empresas", label: "Empresas", icon: Users }]}
      active="empresas" onNav={() => {}} onLogout={onLogout}
    >
      <div className="panel">
        <h3 className="section-title">Nueva empresa</h3>
        <div className="form-grid">
          <input className="input" placeholder="Nombre de la empresa" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Código (opcional, se genera solo)" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <input className="input" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <p className="field-hint">Vigencia:</p>
        <VigenciaPicker modo={vigenciaModo} setModo={setVigenciaModo} customFecha={customFecha} setCustomFecha={setCustomFecha} />
        {error && <p className="error-text">{error}</p>}
        <button className="btn-primary" onClick={createCompany}><Plus size={15} /> Crear empresa</button>
      </div>

      <div className="panel" style={{ marginTop: "1.5rem" }}>
        <h3 className="section-title">Empresas</h3>
        {(registry.companies || []).length === 0 && <p className="muted">Todavía no has creado ninguna empresa.</p>}
        <div className="appt-list">
          {(registry.companies || []).map((c) => {
            const st = vigenciaStatus(c);
            return (
              <div key={c.id} className="appt-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: ".75rem", width: "100%" }}>
                  <div>
                    <div className="appt-service">{c.name} <span className="muted">· {c.slug}</span></div>
                    <div className="appt-meta">Vigente {c.vigenciaInicio} → {c.vigenciaFin || "sin vencimiento"}</div>
                  </div>
                  <div className="appt-right">
                    <span className={`tag ${statusTag[st]}`}>{statusLabel[st]}</span>
                    <button className="btn-ghost" onClick={() => copyLink(c)}>{copiedSlug === c.slug ? "Copiado ✓" : "Copiar link"}</button>
                    <button className="btn-ghost" onClick={() => onEnterCompany(c)}>Entrar</button>
                    <button className="btn-ghost" onClick={() => (renewingId === c.id ? setRenewingId(null) : startRenew(c))}>
                      {renewingId === c.id ? "Cerrar" : "Renovar"}
                    </button>
                    <button className="btn-ghost-danger" onClick={() => removeCompany(c)}>Eliminar</button>
                  </div>
                </div>
                {renewingId === c.id && (
                  <div style={{ width: "100%", marginTop: ".9rem", paddingTop: ".9rem", borderTop: "1px solid var(--line)" }}>
                    <VigenciaPicker modo={renewModo} setModo={setRenewModo} customFecha={renewCustom} setCustomFecha={setRenewCustom} />
                    <button className="btn-primary" onClick={() => applyRenew(c)}>Guardar nueva vigencia</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}

/* ---------------------------------- App raíz ---------------------------------- */


export default function App() {
  const [registry, setRegistry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("gate"); // 'gate' | 'platform-auth' | 'platform-admin' | 'company'
  const [platformSession, setPlatformSession] = useState(null);
  const [activeCompany, setActiveCompany] = useState(null);
  const [tenantData, setTenantData] = useState(null);
  const [tenantWriteKey, setTenantWriteKey] = useState(null);
  const [companySession, setCompanySession] = useState(null);
  const [initialCode] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("empresa") || "";
    } catch {
      return "";
    }
  });

  const navStateRef = useRef({ view, companySession, platformSession });
  useEffect(() => {
    navStateRef.current = { view, companySession, platformSession };
  });

  useEffect(() => {
    // El botón "Atrás" del navegador no debe sacar a la usuaria de la app.
    // En vez de solo congelarla en la misma pantalla, la regresamos un paso
    // dentro del programa (cerrar sesión, salir de la empresa, etc.) y solo
    // cuando ya no hay a dónde volver, se evita salir del todo.
    try {
      window.history.pushState(null, "", window.location.href);
    } catch { /* noop */ }
    function handlePopState() {
      const { view: v, companySession: cs } = navStateRef.current;
      if (v === "company" && cs) {
        setCompanySession(null);
      } else if (v === "company" && !cs) {
        leaveCompany();
      } else if (v === "platform-admin") {
        setPlatformSession(null);
        setView("gate");
      } else if (v === "platform-auth") {
        setView("gate");
      }
      try {
        window.history.pushState(null, "", window.location.href);
      } catch { /* noop */ }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    (async () => {
      const res = await apiGetCompanies();
      if (res) {
        setRegistry(res);
      } else {
        const seed = defaultRegistry();
        setRegistry(seed);
        await apiSetCompanies(seed);
      }
      setLoading(false);
    })();
  }, []);

  const persistRegistry = useCallback(async (next) => {
    setRegistry(next);
    await apiSetCompanies(next, platformSession);
  }, [platformSession]);

  async function enterCompany(company) {
    setActiveCompany(company);
    setCompanySession(null);
    const res = await apiGetTenant(company.slug);
    if (res && res.__error) {
      // No se pudo confirmar si la empresa tiene datos o no: nunca sembrar
      // encima ante la duda, solo avisar y no continuar.
      window.alert("No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.");
      setActiveCompany(null);
      return;
    }
    if (res && res.__notFound) {
      const seed = { ...defaultData(), businessName: company.name };
      setTenantData(seed);
      setTenantWriteKey(null);
      await apiSetTenant(company.slug, seed, null);
    } else if (res) {
      const { _writeKey, ...rest } = res;
      setTenantWriteKey(_writeKey || null);
      setTenantData(rest);
    }
    setView("company");
  }

  const persistTenant = useCallback(async (next) => {
    const previous = tenantData;
    setTenantData(next);
    if (!activeCompany) return false;
    const ok = await apiSetTenant(activeCompany.slug, next, tenantWriteKey);
    if (!ok) setTenantData(previous);
    return ok;
  }, [activeCompany, tenantWriteKey, tenantData]);

  // La cuenta de la clienta consulta solo las promociones cada 10 segundos.
  // No reemplazamos toda la información de la empresa para evitar interrumpir una reserva.
  const refreshPromotions = useCallback(async () => {
    if (!activeCompany || !companySession || companySession.type !== "cliente") return;
    const res = await apiGetTenant(activeCompany.slug);
    if (!res || res.__error || res.__notFound) return;
    if (Array.isArray(res.promotions)) {
      setTenantData((prev) => prev ? { ...prev, promotions: res.promotions } : prev);
    }
  }, [activeCompany, companySession]);

  function leaveCompany() {
    setActiveCompany(null);
    setTenantData(null);
    setTenantWriteKey(null);
    setCompanySession(null);
    setView("gate");
  }

  async function handleClientAuth(client, isNew) {
    if (isNew) {
      const ok = await persistTenant({ ...tenantData, clients: [...tenantData.clients, client] });
      if (!ok) {
        setTenantData(tenantData);
        window.alert("No se pudo crear tu cuenta: hubo un problema de conexión con el servidor. Intenta de nuevo.");
        return;
      }
    }
    setCompanySession({ type: "cliente", id: client.id });
  }
  async function handleTeamAuth(emp, isNew) {
    if (isNew) {
      const ok = await persistTenant({ ...tenantData, employees: [...tenantData.employees, emp] });
      if (!ok) {
        setTenantData(tenantData);
        window.alert("No se pudo crear tu cuenta: hubo un problema de conexión con el servidor. Intenta de nuevo.");
        return;
      }
    }
    setCompanySession({ type: "empleado", id: emp.id });
  }
  function handlePlatformAuth(key) {
    setPlatformSession(key);
    setView("platform-admin");
  }

  if (loading || !registry) {
    return (
      <div className="app-shell loading">
        <style>{CSS}</style>
        <p>Cargando…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <style>{CSS}</style>

      {view === "gate" && (
        <CompanyGate registry={registry} initialCode={initialCode} onEnter={enterCompany} onPlatform={() => setView("platform-auth")} />
      )}

      {view === "platform-auth" && (
        <LoginSplit
          eyebrow="Plataforma"
          title={<>Todas tus<br />empresas,<br />en un lugar.</>}
          quote="Cada empresa que activas es un espacio de trabajo completo, con su propia información."
          onBack={() => setView("gate")}
        >
          <PlatformKeyForm onAuth={handlePlatformAuth} />
        </LoginSplit>
      )}

      {view === "platform-admin" && platformSession && (
        <PlatformAdmin
          registry={registry}
          adminKey={platformSession}
          persistRegistry={persistRegistry}
          onEnterCompany={enterCompany}
          onLogout={() => { setPlatformSession(null); setView("gate"); }}
        />
      )}

      {view === "company" && tenantData && !companySession && (
        <AuthScreen
          data={tenantData}
          persist={persistTenant}
          businessName={tenantData.businessName}
          onClientAuth={handleClientAuth}
          onTeamAuth={handleTeamAuth}
          onLeaveCompany={leaveCompany}
        />
      )}
      {view === "company" && tenantData && companySession?.type === "cliente" && (
        <ClientApp
          data={tenantData}
          persist={persistTenant}
          session={companySession}
          onRefreshPromotions={refreshPromotions}
          onLogout={() => setCompanySession(null)}
        />
      )}
      {view === "company" && tenantData && companySession?.type === "empleado" && (
        <TeamApp data={tenantData} persist={persistTenant} session={companySession} onLogout={() => setCompanySession(null)} />
      )}
    </div>
  );
}
