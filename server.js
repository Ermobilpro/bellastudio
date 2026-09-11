import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data.json");

const app = express();
app.use(express.json({ limit: "2mb" }));

function readData() {
  if (!fs.existsSync(DATA_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return null;
  }
}
function writeData(obj) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj));
}

// La app entera comparte un único documento (igual que el almacenamiento
// compartido que usaba dentro de Claude): { businessName, services, employees, clients, appointments }
app.get("/api/data", (req, res) => {
  const data = readData();
  if (!data) return res.status(404).json(null);
  res.json(data);
});

app.post("/api/data", (req, res) => {
  writeData(req.body);
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
