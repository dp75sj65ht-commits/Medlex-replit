// scripts/seed_terms.js
const fs = require('fs');
const path = require('path');
// 🔴 OLD: const Database = require('better-sqlite3'); const db = new Database(dbPath);
// ✅ NEW: use the SAME db module as the server:
const db = require('../db');

const file = path.join(__dirname, '..', 'data', 'terms.jsonl');

// Ensure table exists (safe to run)
db.exec(`
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY,
  term_en TEXT UNIQUE,
  term_es TEXT,
  term_pt TEXT,
  def_en  TEXT,
  def_es  TEXT,
  def_pt  TEXT,
  specialty TEXT DEFAULT 'general',
  reviewed INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

const upsert = db.prepare(`
INSERT INTO terms (term_en, term_es, term_pt, def_en, def_es, def_pt, specialty, reviewed, updated_at)
VALUES (@term_en, @term_es, @term_pt, @def_en, @def_es, @def_pt, @specialty, 1, datetime('now'))
ON CONFLICT(term_en) DO UPDATE SET
  term_es=excluded.term_es,
  term_pt=excluded.term_pt,
  def_en =excluded.def_en,
  def_es =excluded.def_es,
  def_pt =excluded.def_pt,
  specialty=excluded.specialty,
  reviewed=1,
  updated_at=datetime('now');
`);

const lines = fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
let count = 0;
for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    if (!obj.term_en) continue;
    upsert.run(obj);
    count++;
  } catch (e) {
    console.error('Bad line:', line);
  }
}
console.log(`✅ Seeded/updated ${count} terms (same DB as server)`);