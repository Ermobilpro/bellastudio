import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const COMPANIES_FILE = path.join(DATA_DIR, "companies.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}
function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj));
}
function tenantFile(slug) {
  const safe = String(slug).toLowerCase().replace(/[^a-z0-9-]/g, "");
  return path.join(DATA_DIR, `tenant-${safe}.json`);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

// Registro de empresas de la plataforma (nombre, código, vigencia, admin de plataforma)
app.get("/api/companies", (req, res) => {
  const reg = readJSON(COMPANIES_FILE);
  if (!reg) return res.status(404).json(null);
  res.json(reg);
});
app.post("/api/companies", (req, res) => {
  writeJSON(COMPANIES_FILE, req.body);
  res.json({ ok: true });
});

// Datos operativos propios de cada empresa (clientas, equipo, servicios, citas)
app.get("/api/tenant/:slug", (req, res) => {
  const data = readJSON(tenantFile(req.params.slug));
  if (!data) return res.status(404).json(null);
  res.json(data);
});
app.post("/api/tenant/:slug", (req, res) => {
  writeJSON(tenantFile(req.params.slug), req.body);
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
