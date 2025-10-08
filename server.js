process.on('uncaughtException', err => {
  if (err.code === 'EADDRINUSE') {
    console.error('Port 5000 busy, retrying in 2s...');
    setTimeout(() => process.exit(1), 2000);
  } else {
    console.error(err);
    process.exit(1);
  }
});

// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Basic middleware
app.use(cors());
app.use(express.json());

// Static frontend
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
  }
}));

/* ---------- Example API endpoints ---------- */
// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

// Translate (wire your translator.js here)
app.post('/api/translate', async (req, res) => {
  try {
    const { text, source, target } = req.body || {};
    console.log('[translate] body:', { text, source, target });
    console.log('[translate] env:', {
      HF_API_KEY: Boolean(process.env.HF_API_KEY),
      HF_MODEL: process.env.HF_MODEL
    });

    const out = await translateText({ text, source, target });
    return res.json({ ok: true, result: out });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('translate error:', msg, err?.stack || '');
    // keep HTTP 200 so curl/UI can read the message
    return res.status(200).json({ ok: false, error: msg });
  }
});

import fs from 'fs';
import readline from 'readline';
import path from 'path';

// --- Helpers ---
const DATA_DIR = path.join(__dirname, 'data');
const TERMS_JSONL = path.join(DATA_DIR, 'terms.jsonl');

/**
 * Stream-read terms.jsonl into an array of objects.
 * Each line should be a JSON object like:
 * {"specialty":"cardiology","term_en":"tachycardia","term_es":"taquicardia", ...}
 */
async function readTermsJsonl() {
  const items = [];
  if (!fs.existsSync(TERMS_JSONL)) return items;

  const rl = readline.createInterface({
    input: fs.createReadStream(TERMS_JSONL, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    try {
      items.push(JSON.parse(s));
    } catch (e) {
      console.warn('Bad JSONL line (skipped):', s.slice(0, 120));
    }
  }
  return items;
}

// GET /api/specialties -> ["cardiology", "neurology", ...]
app.get('/api/specialties', async (req, res) => {
  try {
    const data = await readTermsJsonl();
    const set = new Set(data.map(x => (x.specialty || '').trim()).filter(Boolean));
    return res.json({ ok: true, specialties: Array.from(set).sort() });
  } catch (e) {
    console.error('specialties error', e);
    return res.status(200).json({ ok: false, error: 'specialties_failed' });
  }
});

// POST /api/terms { specialty, limit? } -> [{ term_en, term_es, ... }]
app.post('/api/terms', async (req, res) => {
  try {
    const { specialty = '', limit = 200 } = req.body || {};
    const low = String(specialty || '').toLowerCase();
    const data = await readTermsJsonl();
    const out = data.filter(x => String(x.specialty || '').toLowerCase() === low)
                    .slice(0, Math.max(1, Math.min(limit, 1000)));
    return res.json({ ok: true, items: out });
  } catch (e) {
    console.error('terms error', e);
    return res.status(200).json({ ok: false, error: 'terms_failed' });
  }
});

// POST /api/translate-term { text, source?, target? } -> { translation }
app.post('/api/translate-term', async (req, res) => {
  try {
    const { text = '', source = 'auto', target = 'en' } = req.body || {};
    const out = await translateText({ text, source, target });
    return res.json({ ok: true, result: out });
  } catch (e) {
    console.error('translate-term error', e);
    return res.status(200).json({ ok: false, error: e?.message || 'translate_term_failed' });
  }
});

/* ------------------------------------------- */

// SPA fallback (let client-side routing work)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`MedLex server running on port ${PORT}`)
);
