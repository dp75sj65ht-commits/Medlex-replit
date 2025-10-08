import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

// 1) Serve /public
app.use(express.static(path.join(__dirname, "public")));

// 2) APIs (ABOVE catch-all)

// /api/specialties (optional; keep if you use it)
const SPECIALTIES_PATH = path.join(__dirname, "data", "specialties.json");
app.get("/api/specialties", (req, res) => {
  fs.access(SPECIALTIES_PATH, fs.constants.R_OK, (err) => {
    if (err) return res.status(500).json({ error: "specialties.json not readable" });
    res.sendFile(SPECIALTIES_PATH);
  });
});

// /api/terms -> stream NDJSON from data/terms.jsonl
const TERMS_PATH = path.join(__dirname, "data", "terms.jsonl");
app.get("/api/terms", (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  const stream = fs.createReadStream(TERMS_PATH, { encoding: "utf8" });
  stream.on("error", (e) => {
    console.error("Failed to open terms.jsonl:", e);
    res.status(500).end(JSON.stringify({ error: "Failed to load terms" }) + "\n");
  });
  stream.pipe(res);
});

// 3) health check (handy)
app.get("/healthz", (req, res) => res.status(200).json({ ok: true }));

// 4) SPA catch-all LAST
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 5) Listen
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`MedLex server listening on http://${HOST}:${PORT}`);
});