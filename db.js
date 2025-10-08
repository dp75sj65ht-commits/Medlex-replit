const Database = require('better-sqlite3');
const db = new Database('medlex.db');

db.exec(`
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term_en TEXT NOT NULL,
  term_es TEXT,
  term_pt TEXT,
  def_en TEXT,
  def_es TEXT,
  def_pt TEXT,
  specialty TEXT DEFAULT 'general',
  reviewed INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_terms_en ON terms(term_en);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  plan TEXT DEFAULT 'free',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_saves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  term_id INTEGER,
  deck_name TEXT DEFAULT 'My Saved',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, term_id, deck_name)
);

CREATE TABLE IF NOT EXISTS srs_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  term_id INTEGER,
  ease REAL DEFAULT 2.5,
  interval_days INTEGER DEFAULT 1,
  due_date TEXT DEFAULT (date('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, term_id)
);

CREATE TABLE IF NOT EXISTS license_codes (
  code TEXT PRIMARY KEY,
  status TEXT DEFAULT 'unused',
  user_id TEXT,
  redeemed_at TEXT
);
`);

const countTerms = db.prepare(`SELECT COUNT(*) AS c FROM terms`).get().c;
if (countTerms === 0) {
  const seed = db.prepare(`
    INSERT INTO terms (term_en, term_es, term_pt, def_en, def_es, def_pt, specialty, reviewed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  seed.run('appendicitis','apendicitis','apendicite','Inflammation of the appendix.','Inflamación del apéndice.','Inflamação do apêndice.','emergency',1);
  seed.run('suture','suturas','suturas','Stitches to close a wound.','Puntos para cerrar una herida.','Pontos para fechar um ferimento.','procedures',1);
  seed.run('myocardial infarction','infarto de miocardio','infarto do miocárdio','Heart attack due to blocked blood flow.','Ataque cardíaco por flujo sanguíneo bloqueado.','Ataque cardíaco por fluxo sanguíneo bloqueado.','cardiology',1);
}

const envCodes = (process.env.LICENSE_CODES || '').split(',').map(s => s.trim()).filter(Boolean);
if (envCodes.length) {
  const up = db.prepare(`INSERT OR IGNORE INTO license_codes (code) VALUES (?)`);
  envCodes.forEach(code => up.run(code));
}

module.exports = db;
