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


/* ------------------------------------------- */

// SPA fallback (let client-side routing work)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`MedLex server running on port ${PORT}`)
);
