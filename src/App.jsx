import { useState, useEffect, useCallback } from "react";
import {
  Calendar, Clock, Users, TrendingUp, LogOut,
  Plus, Check, ChevronLeft, ChevronRight, Scissors, User,
} from "lucide-react";

const LOGO_SRC = "/logo.png";
const CATEGORIES = ["Uñas", "Keratina", "Otro"];
const OPEN_START_MIN = 10 * 60;
const OPEN_END_MIN = 19 * 60;
const SLOT_STEP_MIN = 30;
const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
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
function money(n) { return "$" + Math.round(n).toLocaleString("es-CO"); }
function todayISO() { return toISO(new Date()); }
function initialOf(name) { return (name || "?").trim().charAt(0).toUpperCase(); }

function defaultData() {
  return {
    businessName: "BellaStudio",
    services: [
      { id: uid(), name: "Manicure clásica", category: "Uñas", duration: 45, price: 25000 },
      { id: uid(), name: "Manicure semipermanente", category: "Uñas", duration: 60, price: 45000 },
      { id: uid(), name: "Pedicura spa", category: "Uñas", duration: 60, price: 35000 },
      { id: uid(), name: "Uñas acrílicas", category: "Uñas", duration: 90, price: 70000 },
      { id: uid(), name: "Keratina alisadora", category: "Keratina", duration: 180, price: 180000 },
      { id: uid(), name: "Botox capilar", category: "Keratina", duration: 150, price: 150000 },
    ],
    employees: [],
    clients: [],
    appointments: [],
  };
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
async function apiSetCompanies(obj) {
  try {
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obj),
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function apiGetTenant(slug) {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
async function apiSetTenant(slug, obj) {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obj),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function defaultRegistry() {
  return { platformAdmin: null, companies: [] };
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
  const today = todayISO();
  if (!company.vigenciaFin) return "sin-fin";
  if (today > company.vigenciaFin) return "vencida";
  const diffDays = Math.round((fromISO(company.vigenciaFin) - fromISO(today)) / 86400000);
  if (diffDays <= 7) return "por-vencer";
  return "activa";
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
.error-text{ color:var(--danger); font-size:.85rem; margin:0; }
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
.tag-completada{ background:var(--gold-bg); color:var(--gold-ink); }
.tag-cancelada{ background:var(--danger-bg); color:var(--danger); }
.tag-admin{ background:var(--lilac-bg); color:var(--lilac); margin-left:.4rem; }

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

@media (max-width: 760px){
  .hero{ flex-direction:column; padding:3rem 6%; min-height:auto; gap:2rem; }
  .hero-card{ transform:none; width:100%; max-width:320px; }
  .login-box{ grid-template-columns:1fr; }
  .login-art{ display:none; }
  .shell{ flex-direction:column; }
  .sidebar{ width:100%; flex-direction:row; align-items:center; flex-wrap:wrap; gap:.6rem; padding:.9rem; }
  .side-primary{ display:none; }
  .side-nav{ flex-direction:row; flex-wrap:wrap; flex:1; }
  .side-link span{ display:none; }
  .side-logout{ margin-top:0; }
  .main{ padding:1.1rem; }
  .two-col{ grid-template-columns:1fr; }
  .form-grid{ grid-template-columns:1fr; }
  .stat-grid{ grid-template-columns:repeat(2,1fr); }
  .appbar{ padding:0 1rem; }
  .profile span{ display:none; }
}
`;

/* ---------------------------------- Calendario ---------------------------------- */

function MonthCalendar({ year, month, selectedDate, onSelect, minDateISO, renderBadge, onMonthChange }) {
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
          const disabled = minDateISO ? iso < minDateISO : false;
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
              <Plus size={15} /> {primaryAction.label}
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

function ClientAuthFields({ data, onAuth }) {
  const [tab, setTab] = useState("ingresar");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

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

  return (
    <>
      <h3 className="form-title">{tab === "ingresar" ? "Inicia sesión" : "Crea tu cuenta"}</h3>
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

function AuthScreen({ data, businessName, onClientAuth, onTeamAuth, onLeaveCompany }) {
  const [mode, setMode] = useState("elegir");

  if (mode === "cliente") {
    return (
      <LoginSplit
        eyebrow="Bienvenida de nuevo"
        title={<>Tu cita.<br />Tu momento.<br />Tu mejor versión.</>}
        quote="Cada cita es una oportunidad para que alguien se sienta espectacular."
        onBack={() => setMode("elegir")}
      >
        <ClientAuthFields data={data} onAuth={onClientAuth} />
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
              <div className="choice-title">Soy clienta</div>
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

function BookingWizard({ data, persist, clientId, onBooked }) {
  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState(null);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(null);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [slot, setSlot] = useState(null);
  const [done, setDone] = useState(false);

  const service = data.services.find((s) => s.id === serviceId);
  const eligibleEmployees = data.employees.filter((e) => e.active && e.serviceIds.includes(serviceId));

  function candidatesFor(empId) {
    return empId ? eligibleEmployees.filter((e) => e.id === empId) : eligibleEmployees;
  }

  function isFree(empId, dateISO, startMin, duration) {
    const end = startMin + duration;
    return !data.appointments.some((a) => {
      if (a.employeeId !== empId || a.date !== dateISO || a.status === "cancelada") return false;
      const aStart = timeToMin(a.time);
      const aEnd = aStart + a.duration;
      return startMin < aEnd && end > aStart;
    });
  }

  function availableSlotsFor(dateISO) {
    if (!service) return [];
    const out = [];
    for (let m = OPEN_START_MIN; m + service.duration <= OPEN_END_MIN; m += SLOT_STEP_MIN) {
      const cands = candidatesFor(employeeId).filter((e) => isFree(e.id, dateISO, m, service.duration));
      if (cands.length > 0) out.push({ time: minToTime(m), employeeId: cands[0].id, employeeName: cands[0].name });
    }
    return out;
  }

  async function confirmBooking() {
    const appt = {
      id: uid(), clientId, employeeId: slot.employeeId, serviceId,
      serviceName: service.name, price: service.price, duration: service.duration,
      date, time: slot.time, status: "confirmada", createdAt: Date.now(),
    };
    await persist({ ...data, appointments: [...data.appointments, appt] });
    setDone(true);
  }

  function restart() {
    setStep(1); setServiceId(null); setEmployeeId(""); setDate(null); setSlot(null); setDone(false);
  }

  if (done) {
    return (
      <div className="panel empty-state">
        <div className="arch-icon"><Check size={22} /></div>
        <h3>Cita confirmada</h3>
        <p>Tu cita de {service?.name} quedó agendada para el {date} a las {slot?.time}. La puedes ver o cancelar desde "Mis citas".</p>
        <button className="btn-primary" onClick={() => { restart(); onBooked(); }}>Ver mis citas</button>
      </div>
    );
  }

  return (
    <div className="panel">
      <ol className="steps">
        {["Servicio", "Profesional", "Fecha", "Hora"].map((s, i) => (
          <li key={s} className={`step ${step === i + 1 ? "step-active" : ""} ${step > i + 1 ? "step-done" : ""}`}>{s}</li>
        ))}
      </ol>

      {step === 1 && (
        <div className="grid-cards">
          {CATEGORIES.map((cat) => {
            const items = data.services.filter((s) => s.category === cat);
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
          <p className="field-hint">Servicio: <strong>{service?.name}</strong></p>
          <div className="option-list">
            <button className={`option-row ${employeeId === "" ? "option-row-active" : ""}`} onClick={() => { setEmployeeId(""); setStep(3); }}>
              Cualquiera disponible
            </button>
            {eligibleEmployees.map((e) => (
              <button key={e.id} className={`option-row ${employeeId === e.id ? "option-row-active" : ""}`} onClick={() => { setEmployeeId(e.id); setStep(3); }}>
                {e.name}
              </button>
            ))}
            {eligibleEmployees.length === 0 && <p className="muted">Todavía no hay profesionales asignadas a este servicio. Vuelve pronto.</p>}
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <button className="back-link" onClick={() => setStep(2)}>&larr; Cambiar profesional</button>
          <MonthCalendar
            year={calYear} month={calMonth} selectedDate={date}
            minDateISO={todayISO()}
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
              <button key={s.time} className="slot-btn" onClick={() => setSlot(s)}>{s.time}</button>
            ))}
            {availableSlotsFor(date).length === 0 && <p className="muted">No hay horarios disponibles ese día. Prueba otra fecha.</p>}
          </div>
        </div>
      )}

      {step === 4 && slot && (
        <div className="confirm-box">
          <h4>Confirma tu cita</h4>
          <p><strong>{service?.name}</strong></p>
          <p>{date} a las {slot.time}</p>
          <p>Con {slot.employeeName}</p>
          <p>{money(service?.price)}</p>
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
  const upcoming = mine.filter((a) => a.date >= now && a.status !== "cancelada");
  const past = mine.filter((a) => a.date < now || a.status === "cancelada");

  async function cancel(id) {
    await persist({ ...data, appointments: data.appointments.map((a) => (a.id === id ? { ...a, status: "cancelada" } : a)) });
  }
  function employeeName(id) { return data.employees.find((e) => e.id === id)?.name || "—"; }

  return (
    <div className="panel">
      <h3 className="section-title">Próximas citas</h3>
      {upcoming.length === 0 && <p className="muted">No tienes citas próximas. Reserva una desde "Reservar cita".</p>}
      <div className="appt-list">
        {upcoming.map((a) => (
          <div key={a.id} className="appt-row">
            <div>
              <div className="appt-service">{a.serviceName}</div>
              <div className="appt-meta">{a.date} · {a.time} · con {employeeName(a.employeeId)}</div>
            </div>
            <div className="appt-right">
              <span className="tag tag-confirmada">{a.status}</span>
              <button className="btn-ghost-danger" onClick={() => cancel(a.id)}>Cancelar</button>
            </div>
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <>
          <h3 className="section-title" style={{ marginTop: "1.75rem" }}>Historial</h3>
          <div className="appt-list">
            {past.map((a) => (
              <div key={a.id} className="appt-row appt-row-past">
                <div>
                  <div className="appt-service">{a.serviceName}</div>
                  <div className="appt-meta">{a.date} · {a.time} · con {employeeName(a.employeeId)}</div>
                </div>
                <span className={`tag tag-${a.status}`}>{a.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ClientApp({ data, persist, session, onLogout }) {
  const [tab, setTab] = useState("reservar");
  const client = data.clients.find((c) => c.id === session.id);
  return (
    <Shell
      title={data.businessName}
      personName={client?.name?.split(" ")[0] || ""}
      roleLabel="Clienta"
      nav={[
        { key: "reservar", label: "Reservar cita", icon: Calendar },
        { key: "mis-citas", label: "Mis citas", icon: Clock },
      ]}
      active={tab} onNav={setTab} onLogout={onLogout}
      primaryAction={{ label: "Nueva cita", onClick: () => setTab("reservar") }}
    >
      {tab === "reservar" && <BookingWizard data={data} persist={persist} clientId={client.id} onBooked={() => setTab("mis-citas")} />}
      {tab === "mis-citas" && <MyAppointments data={data} persist={persist} clientId={client.id} />}
    </Shell>
  );
}

/* ---------------------------------- Vista equipo / admin ---------------------------------- */

function AgendaView({ data, persist, employeeId, onlyMine }) {
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [filterEmp, setFilterEmp] = useState("todas");

  const scoped = data.appointments.filter((a) =>
    onlyMine ? a.employeeId === employeeId : (filterEmp === "todas" || a.employeeId === filterEmp)
  );

  function dayCount(iso) { return scoped.filter((a) => a.date === iso && a.status !== "cancelada").length; }
  const dayAppts = scoped.filter((a) => a.date === selectedDate).sort((a, b) => (a.time < b.time ? -1 : 1));

  function clientName(id) { return data.clients.find((c) => c.id === id)?.name || "—"; }
  function clientPhone(id) { return data.clients.find((c) => c.id === id)?.phone || ""; }
  function employeeName(id) { return data.employees.find((e) => e.id === id)?.name || "—"; }
  function serviceName(sid) { return data.services.find((s) => s.id === sid)?.name || "—"; }

  async function setStatus(id, status) {
    await persist({ ...data, appointments: data.appointments.map((a) => (a.id === id ? { ...a, status } : a)) });
  }

  return (
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
            <div key={a.id} className="appt-row">
              <div>
                <div className="appt-service">{a.time} · {serviceName(a.serviceId)}</div>
                <div className="appt-meta">
                  {clientName(a.clientId)} · {clientPhone(a.clientId)}{!onlyMine ? ` · con ${employeeName(a.employeeId)}` : ""}
                </div>
              </div>
              <div className="appt-right">
                <span className={`tag tag-${a.status}`}>{a.status}</span>
                {a.status === "confirmada" && (
                  <>
                    <button className="btn-ghost" onClick={() => setStatus(a.id, "completada")}>Completada</button>
                    <button className="btn-ghost-danger" onClick={() => setStatus(a.id, "cancelada")}>Cancelar</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TeamManager({ data, persist }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [serviceIds, setServiceIds] = useState([]);
  const [error, setError] = useState("");

  async function add() {
    if (!name.trim() || pin.length !== 4) { setError("Escribe el nombre y un PIN de 4 dígitos."); return; }
    if (data.employees.some((e) => e.name.toLowerCase() === name.trim().toLowerCase())) { setError("Ya existe alguien con ese nombre."); return; }
    const emp = { id: uid(), name: name.trim(), pin, isAdmin, active: true, serviceIds };
    await persist({ ...data, employees: [...data.employees, emp] });
    setName(""); setPin(""); setIsAdmin(false); setServiceIds([]); setError("");
  }
  async function toggleActive(id) {
    await persist({ ...data, employees: data.employees.map((e) => (e.id === id ? { ...e, active: !e.active } : e)) });
  }
  async function remove(id) {
    await persist({ ...data, employees: data.employees.filter((e) => e.id !== id) });
  }
  function toggleService(sid) {
    setServiceIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  }

  return (
    <div className="panel">
      <h3 className="section-title">Agregar integrante</h3>
      <div className="form-grid">
        <input className="input" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
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
      {error && <p className="error-text">{error}</p>}
      <button className="btn-primary" onClick={add}><Plus size={15} /> Agregar</button>

      <h3 className="section-title" style={{ marginTop: "2rem" }}>Equipo actual</h3>
      <div className="appt-list">
        {data.employees.map((e) => (
          <div key={e.id} className="appt-row">
            <div>
              <div className="appt-service">{e.name}{e.isAdmin && <span className="tag tag-admin">admin</span>}</div>
              <div className="appt-meta">
                {e.serviceIds.map((sid) => data.services.find((s) => s.id === sid)?.name).filter(Boolean).join(", ") || "Sin servicios asignados"}
              </div>
            </div>
            <div className="appt-right">
              <span className={`tag ${e.active ? "tag-confirmada" : "tag-cancelada"}`}>{e.active ? "activa" : "inactiva"}</span>
              <button className="btn-ghost" onClick={() => toggleActive(e.id)}>{e.active ? "Desactivar" : "Activar"}</button>
              <button className="btn-ghost-danger" onClick={() => remove(e.id)}>Eliminar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ServicesManager({ data, persist }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState(30000);
  const [error, setError] = useState("");

  async function add() {
    if (!name.trim() || Number(duration) <= 0 || Number(price) < 0) { setError("Completa todos los campos."); return; }
    const s = { id: uid(), name: name.trim(), category, duration: Number(duration), price: Number(price) };
    await persist({ ...data, services: [...data.services, s] });
    setName(""); setDuration(60); setPrice(30000); setError("");
  }
  async function remove(id) {
    await persist({
      ...data,
      services: data.services.filter((s) => s.id !== id),
      employees: data.employees.map((e) => ({ ...e, serviceIds: e.serviceIds.filter((x) => x !== id) })),
    });
  }

  return (
    <div className="panel">
      <h3 className="section-title">Agregar servicio</h3>
      <div className="form-grid">
        <input className="input" placeholder="Nombre del servicio" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="input" type="number" placeholder="Duración (min)" value={duration} onChange={(e) => setDuration(e.target.value)} />
        <input className="input" type="number" placeholder="Precio" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      {error && <p className="error-text">{error}</p>}
      <button className="btn-primary" onClick={add}><Plus size={15} /> Agregar servicio</button>

      {CATEGORIES.map((cat) => {
        const items = data.services.filter((s) => s.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat}>
            <h3 className="section-title" style={{ marginTop: "2rem" }}>{cat}</h3>
            <div className="appt-list">
              {items.map((s) => (
                <div key={s.id} className="appt-row">
                  <div>
                    <div className="appt-service">{s.name}</div>
                    <div className="appt-meta">{s.duration} min · {money(s.price)}</div>
                  </div>
                  <button className="btn-ghost-danger" onClick={() => remove(s.id)}>Eliminar</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
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

  const tips = [];
  if (topService) tips.push(`"${topService[0]}" es tu servicio más pedido este mes (${topService[1]} citas). Arma un combo o paquete con otro servicio para subir el ticket promedio.`);
  if (keratinaCount > 0) tips.push(`Tienes ${keratinaCount} citas de keratina este mes. Ofrece un mantenimiento a los 45 días para que esas clientas vuelvan.`);
  if (monthAppts.length > 0 && byWeekday[minDay] < byWeekday[maxDay]) tips.push(`Los ${WEEKDAYS[minDay]} son tus días más tranquilos. Prueba una promoción especial ese día para llenar la agenda.`);
  if (cancelled > 0) tips.push(`Tuviste ${cancelled} citas canceladas este mes. Un recordatorio por WhatsApp el día anterior suele bajar las cancelaciones.`);
  if (topClient) tips.push(`${topClient.name} es tu clienta más frecuente. Un programa de puntos o descuento por fidelidad puede fortalecer esa relación y atraer referidos.`);
  if (completed.length > 0) tips.push(`Pide una reseña en Google después de cada cita completada: es de las formas más baratas de conseguir clientas nuevas.`);
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
      <h3 className="section-title" style={{ marginTop: "2rem" }}>Ideas para hacer crecer tu negocio</h3>
      <ul className="tips-list">
        {tips.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
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
      { key: "equipo", label: "Equipo", icon: Users },
      { key: "servicios", label: "Servicios", icon: Scissors },
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
      {tab === "agenda" && <AgendaView data={data} persist={persist} employeeId={me.id} onlyMine />}
      {tab === "citas" && me?.isAdmin && <AgendaView data={data} persist={persist} onlyMine={false} />}
      {tab === "equipo" && me?.isAdmin && <TeamManager data={data} persist={persist} />}
      {tab === "servicios" && me?.isAdmin && <ServicesManager data={data} persist={persist} />}
      {tab === "estadisticas" && me?.isAdmin && <StatsView data={data} />}
    </Shell>
  );
}

/* ---------------------------------- Puerta de entrada (código de empresa) ---------------------------------- */

function CompanyGate({ registry, onEnter, onPlatform }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState(null);
  const [expiredInfo, setExpiredInfo] = useState(null);

  function submit() {
    const slug = slugify(code);
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
          <button className="btn-primary" onClick={submit}>Entrar</button>
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

function PlatformAuthFields({ registry, onAuth }) {
  const hasAdmin = !!registry.platformAdmin;
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  function setup() {
    if (!name.trim() || pin.length !== 4) { setError("Escribe tu nombre y un PIN de 4 dígitos."); return; }
    onAuth({ name: name.trim(), pin }, true);
  }
  function login() {
    if (
      registry.platformAdmin &&
      registry.platformAdmin.name.toLowerCase() === name.trim().toLowerCase() &&
      registry.platformAdmin.pin === pin
    ) {
      onAuth(registry.platformAdmin, false);
    } else {
      setError("Nombre o PIN incorrectos.");
    }
  }

  if (!hasAdmin) {
    return (
      <>
        <h3 className="form-title">Configura la plataforma</h3>
        <p className="form-sub">Esta cuenta va a poder crear y administrar todas las empresas.</p>
        <div className="form-grid-1">
          <input className="input" placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Crea un PIN de 4 dígitos" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          {error && <p className="error-text">{error}</p>}
          <button className="btn-primary" onClick={setup}>Crear cuenta y entrar</button>
        </div>
      </>
    );
  }
  return (
    <>
      <h3 className="form-title">Panel de plataforma</h3>
      <p className="form-sub">Administra las empresas que usan BellaStudio.</p>
      <div className="form-grid-1">
        <input className="input" placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="PIN de 4 dígitos" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        {error && <p className="error-text">{error}</p>}
        <button className="btn-primary" onClick={login}>Entrar</button>
      </div>
    </>
  );
}

function PlatformAdmin({ registry, persistRegistry, onEnterCompany, onLogout }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [inicio, setInicio] = useState(todayISO());
  const [fin, setFin] = useState("");
  const [error, setError] = useState("");

  async function createCompany() {
    const finalSlug = slugify(slug.trim() ? slug : name);
    if (!name.trim() || !finalSlug || !fin) { setError("Completa nombre, código y fecha de vencimiento."); return; }
    if ((registry.companies || []).some((c) => c.slug === finalSlug)) { setError("Ya existe una empresa con ese código."); return; }
    const company = { id: uid(), slug: finalSlug, name: name.trim(), vigenciaInicio: inicio, vigenciaFin: fin, createdAt: Date.now() };
    await persistRegistry({ ...registry, companies: [...(registry.companies || []), company] });
    const seed = { ...defaultData(), businessName: name.trim() };
    await apiSetTenant(finalSlug, seed);
    setName(""); setSlug(""); setFin(""); setError("");
  }

  async function renovar(company) {
    const nueva = window.prompt(`Nueva fecha de vencimiento para ${company.name} (AAAA-MM-DD):`, company.vigenciaFin || "");
    if (!nueva) return;
    await persistRegistry({
      ...registry,
      companies: registry.companies.map((c) => (c.id === company.id ? { ...c, vigenciaFin: nueva } : c)),
    });
  }

  async function removeCompany(company) {
    await persistRegistry({ ...registry, companies: registry.companies.filter((c) => c.id !== company.id) });
  }

  const statusLabel = { activa: "Activa", "por-vencer": "Por vencer", vencida: "Vencida", "sin-fin": "Sin fecha" };
  const statusTag = { activa: "tag-confirmada", "por-vencer": "tag-completada", vencida: "tag-cancelada", "sin-fin": "tag-admin" };

  return (
    <Shell
      title="BellaStudio"
      personName={registry.platformAdmin?.name?.split(" ")[0] || ""}
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
          <input className="input" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
        </div>
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
              <div key={c.id} className="appt-row">
                <div>
                  <div className="appt-service">{c.name} <span className="muted">· {c.slug}</span></div>
                  <div className="appt-meta">Vigente {c.vigenciaInicio} → {c.vigenciaFin || "sin definir"}</div>
                </div>
                <div className="appt-right">
                  <span className={`tag ${statusTag[st]}`}>{statusLabel[st]}</span>
                  <button className="btn-ghost" onClick={() => onEnterCompany(c)}>Entrar</button>
                  <button className="btn-ghost" onClick={() => renovar(c)}>Renovar</button>
                  <button className="btn-ghost-danger" onClick={() => removeCompany(c)}>Eliminar</button>
                </div>
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
  const [companySession, setCompanySession] = useState(null);

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
    await apiSetCompanies(next);
  }, []);

  async function enterCompany(company) {
    setActiveCompany(company);
    setCompanySession(null);
    const res = await apiGetTenant(company.slug);
    if (res) {
      setTenantData(res);
    } else {
      const seed = { ...defaultData(), businessName: company.name };
      setTenantData(seed);
      await apiSetTenant(company.slug, seed);
    }
    setView("company");
  }

  const persistTenant = useCallback(async (next) => {
    setTenantData(next);
    if (activeCompany) await apiSetTenant(activeCompany.slug, next);
  }, [activeCompany]);

  function leaveCompany() {
    setActiveCompany(null);
    setTenantData(null);
    setCompanySession(null);
    setView("gate");
  }

  async function handleClientAuth(client, isNew) {
    if (isNew) await persistTenant({ ...tenantData, clients: [...tenantData.clients, client] });
    setCompanySession({ type: "cliente", id: client.id });
  }
  async function handleTeamAuth(emp, isNew) {
    if (isNew) await persistTenant({ ...tenantData, employees: [...tenantData.employees, emp] });
    setCompanySession({ type: "empleado", id: emp.id });
  }
  async function handlePlatformAuth(admin, isNew) {
    if (isNew) await persistRegistry({ ...registry, platformAdmin: admin });
    setPlatformSession(admin);
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
        <CompanyGate registry={registry} onEnter={enterCompany} onPlatform={() => setView("platform-auth")} />
      )}

      {view === "platform-auth" && (
        <LoginSplit
          eyebrow="Plataforma"
          title={<>Todas tus<br />empresas,<br />en un lugar.</>}
          quote="Cada empresa que activas es un espacio de trabajo completo, con su propia información."
          onBack={() => setView("gate")}
        >
          <PlatformAuthFields registry={registry} onAuth={handlePlatformAuth} />
        </LoginSplit>
      )}

      {view === "platform-admin" && platformSession && (
        <PlatformAdmin
          registry={registry}
          persistRegistry={persistRegistry}
          onEnterCompany={enterCompany}
          onLogout={() => { setPlatformSession(null); setView("gate"); }}
        />
      )}

      {view === "company" && tenantData && !companySession && (
        <AuthScreen
          data={tenantData}
          businessName={tenantData.businessName}
          onClientAuth={handleClientAuth}
          onTeamAuth={handleTeamAuth}
          onLeaveCompany={leaveCompany}
        />
      )}
      {view === "company" && tenantData && companySession?.type === "cliente" && (
        <ClientApp data={tenantData} persist={persistTenant} session={companySession} onLogout={() => setCompanySession(null)} />
      )}
      {view === "company" && tenantData && companySession?.type === "empleado" && (
        <TeamApp data={tenantData} persist={persistTenant} session={companySession} onLogout={() => setCompanySession(null)} />
      )}
    </div>
  );
}
