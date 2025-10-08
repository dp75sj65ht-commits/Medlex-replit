// -------------------- imports (ONE TIME at top) --------------------
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import readline from 'readline';
import { translateText } from './translator.js';

// -------------------- env / paths --------------------
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const TERMS_JSONL = path.join(DATA_DIR, 'terms.jsonl');

// -------------------- app & middleware --------------------
const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend from /public
app.use(
  express.static(path.join(__dirname, 'public'), {
    index: 'index.html',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      }
    },
  })
);

// -------------------- helpers --------------------
/**
 * Stream-read data/terms.jsonl into an array of objects.
 * Each line should be JSON like:
 * {"specialty":"cardiology","term_en":"tachycardia","term_es":"taquicardia"}
 */
async function readTermsJsonl() {
  const items = [];
  if (!fs.existsSync(TERMS_JSONL)) return items;

  const rl = readline.createInterface({
    input: fs.createReadStream(TERMS_JSONL, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    try {
      items.push(JSON.parse(s));
    } catch {
      // skip malformed line
    }
  }
  return items;
}

// -------------------- API routes --------------------

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

// Translate (LLM-backed; safe stub if no key)
app.post('/api/translate', async (req, res) => {
  try {
    const { text, source, target } = req.body || {};
    const out = await translateText({ text, source, target });
    return res.json({ ok: true, result: out });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('translate error:', msg);
    return res.status(200).json({ ok: false, error: msg });
  }
});

// Optional alias for translating a single term
app.post('/api/translate-term', async (req, res) => {
  try {
    const { text = '', source = 'auto', target = 'en' } = req.body || {};
    const out = await translateText({ text, source, target });
    return res.json({ ok: true, result: out });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || 'translate_term_failed' });
  }
});

// Distinct specialties from data/terms.jsonl
app.get('/api/specialties', async (req, res) => {
  try {
    const data = await readTermsJsonl();
    const set = new Set(
      data.map((x) => String(x.specialty || '').trim()).filter(Boolean)
    );
    return res.json({ ok: true, specialties: Array.from(set).sort() });
  } catch (e) {
    console.error('specialties error', e);
    return res.status(200).json({ ok: false, error: 'specialties_failed' });
  }
});

// Terms for a given specialty
app.post('/api/terms', async (req, res) => {
  try {
    const { specialty = '', limit = 200 } = req.body || {};
    const low = String(specialty || '').toLowerCase();
    const data = await readTermsJsonl();
    const out = data
      .filter((x) => String(x.specialty || '').toLowerCase() === low)
      .slice(0, Math.max(1, Math.min(limit, 1000)));
    return res.json({ ok: true, items: out });
  } catch (e) {
    console.error('terms error', e);
    return res.status(200).json({ ok: false, error: 'terms_failed' });
  }
});

// Enrich (stub for now; wire real logic later)
app.post('/api/enrich', async (req, res) => {
  try {
    const { term = '', lang = 'en' } = req.body || {};
    return res.json({
      ok: true,
      term,
      lang,
      definition: '',
      synonyms: [],
      related: [],
      notes: '',
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'enrich_failed' });
  }
});

// If your JSON is at: ./data/specialties.json (repo root)
const SPECIALTIES_PATH = path.join(__dirname, "data", "specialties.json");

app.get("/api/specialties", (req, res) => {
  res.sendFile(SPECIALTIES_PATH, (err) => {
    if (err) {
      console.error("Failed to send specialties.json:", err);
      res.status(500).json({ error: "Failed to load specialties" });
    }
  });
});

import fs from 'fs';

// specialties.json (outside public)
const SPECIALTIES_PATH = path.join(__dirname, 'data', 'specialties.json');
app.get('/api/specialties', (req, res) => {
  fs.access(SPECIALTIES_PATH, fs.constants.R_OK, (err) => {
    if (err) return res.status(500).json({ error: 'specialties.json not readable' });
    res.sendFile(SPECIALTIES_PATH);
  });
});

// terms.jsonl (outside public)
const TERMS_PATH = path.join(__dirname, 'data', 'terms.jsonl');
app.get('/api/terms', (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const stream = fs.createReadStream(TERMS_PATH, { encoding: 'utf8' });
  stream.on('error', (e) => {
    console.error('Failed to open terms.jsonl:', e);
    res.status(500).end(JSON.stringify({ error: 'Failed to load terms' }) + '\n');
  });
  stream.pipe(res);
});

// -------------------- SPA fallback (LAST) --------------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------- listen --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`MedLex server running on port ${PORT}`));

// Serve specialties.json that lives OUTSIDE public/
// Adjust the path below to your actual on-disk location

// Example: file at project root: ./data/specialties.json
// If yours is elsewhere, update this join(..) accordingly:

// Strongly prefer res.sendFile to avoid MIME/type issues
app.get("/api/specialties", (req, res) => {
  res.sendFile(SPECIALTIES_PATH, (err) => {
    if (err) {
      console.error("Failed to send specialties.json:", err);
      res.status(500).json({ error: "Failed to load specialties" });
    }
  });
});

// --- Listen (Replit/Render/Heroku style) ---
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`MedLex server listening on http://${HOST}:${PORT}`);
});