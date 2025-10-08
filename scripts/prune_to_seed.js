// scripts/prune_to_seed.js
const fs = require('fs');
const path = require('path');
// 🔴 OLD: open a separate DB file
// ✅ NEW: use the SAME db module as the server:
const db = require('../db');

const seedPath = path.join(__dirname, '..', 'data', 'terms.jsonl');
if (!fs.existsSync(seedPath)) {
  console.error('Missing data/terms.jsonl');
  process.exit(1);
}

const wanted = new Set();
for (const line of fs.readFileSync(seedPath, 'utf8').split('\n')) {
  const s = line.trim();
  if (!s) continue;
  try { const obj = JSON.parse(s); if (obj.term_en) wanted.add(obj.term_en.toLowerCase()); } catch {}
}

const before = db.prepare(`SELECT COUNT(*) AS n FROM terms`).get().n;

const rows = db.prepare(`SELECT id, term_en FROM terms`).all();
let deleted = 0;
const del = db.prepare(`DELETE FROM terms WHERE id=?`);
for (const r of rows) {
  if (!wanted.has(String(r.term_en || '').toLowerCase())) { del.run(r.id); deleted++; }
}

const after = db.prepare(`SELECT COUNT(*) AS n FROM terms`).get().n;
console.log(`✅ Pruned terms: deleted ${deleted}. Count before=${before}, after=${after}. Keeping ${wanted.size} seed terms.`);