// scripts/db_inspect.js
const db = require('../db');
const rows = db.prepare(`PRAGMA database_list`).all();
console.log('DB PRAGMA:', rows);
const cnt = db.prepare(`SELECT COUNT(*) AS n FROM terms`).get().n;
console.log('Terms count =', cnt);
const sample = db.prepare(`SELECT term_en FROM terms ORDER BY term_en LIMIT 5`).all();
console.log('Sample terms:', sample);