// scripts/fix_terms_unique.js
const db = require('../db');

// 1) Make sure table exists (columns may vary but these are typical)
db.exec(`
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY,
  term_en TEXT,
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

// 2) Deduplicate by lower(term_en): keep the smallest id
const dups = db.prepare(`
  SELECT LOWER(term_en) AS k, COUNT(*) AS c
  FROM terms
  WHERE term_en IS NOT NULL AND TRIM(term_en) <> ''
  GROUP BY LOWER(term_en)
  HAVING COUNT(*) > 1
`).all();

for (const d of dups) {
  const rows = db.prepare(`
    SELECT id, term_en FROM terms
    WHERE LOWER(term_en) = ?
    ORDER BY id ASC
  `).all(d.k);

  const keep = rows[0]?.id;
  const remove = rows.slice(1).map(r => r.id);
  if (remove.length) {
    const del = db.prepare(`DELETE FROM terms WHERE id = ?`);
    for (const id of remove) del.run(id);
    console.log(`Deduped "${d.k}": kept id=${keep}, removed ${remove.length}`);
  }
}

// 3) Add UNIQUE index on term_en so ON CONFLICT(term_en) works
// We use a plain UNIQUE index (case-sensitive). If you want case-insensitive uniqueness,
// you can normalize inputs or create the index on LOWER(term_en).
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_terms_term_en ON terms(term_en);`);

console.log('✅ terms table deduped (if needed) and UNIQUE index added.');