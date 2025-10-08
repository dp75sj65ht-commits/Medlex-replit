require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const { provider, translate, defineShort } = require('./translator');

const app = express();
const port = process.env.PORT || 3000;

// ------------ MIDDLEWARE (order matters) ------------
app.use(express.json());

// no-cache while debugging
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

// serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ------------ DB HELPERS ------------
function getTermByEN(term_en) {
  return db.prepare(`SELECT * FROM terms WHERE LOWER(term_en) = LOWER(?)`).get(term_en);
}
function upsertTerm(row) {
  const existing = getTermByEN(row.term_en);
  if (existing) {
    db.prepare(`
      UPDATE terms SET term_es=?, term_pt=?, def_en=?, def_es=?, def_pt=?, specialty=?, reviewed=?, updated_at=datetime('now')
      WHERE id=?
    `).run(row.term_es, row.term_pt, row.def_en, row.def_es, row.def_pt, row.specialty || 'general', row.reviewed ? 1 : 0, existing.id);
    return db.prepare(`SELECT * FROM terms WHERE id=?`).get(existing.id);
  } else {
    const info = db.prepare(`
      INSERT INTO terms (term_en, term_es, term_pt, def_en, def_es, def_pt, specialty, reviewed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.term_en, row.term_es, row.term_pt, row.def_en, row.def_es, row.def_pt, row.specialty || 'general', row.reviewed ? 1 : 0);
    return db.prepare(`SELECT * FROM terms WHERE id=?`).get(info.lastInsertRowid);
  }
}

// Add indexes once (safe to run multiple times)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_terms_term_en ON terms(term_en);
  CREATE INDEX IF NOT EXISTS idx_terms_term_es ON terms(term_es);
  CREATE INDEX IF NOT EXISTS idx_terms_term_pt ON terms(term_pt);
  CREATE INDEX IF NOT EXISTS idx_terms_spec   ON terms(specialty);
`);

// ------------ API ROUTES (must be before catch-all) ------------

// Translate (read-from-glossary-first; no DB writes for ad-hoc)
app.post('/api/translate', async (req, res) => {
  try {
    const { term, from = 'EN', to = [] } = req.body || {};
    if (!term) return res.status(400).json({ error: 'term required' });

    const FROM = String(from || 'EN').toUpperCase();
    const toLangs = (Array.isArray(to) ? to : [to])
      .map(s => String(s || '').toUpperCase())
      .filter(s => ['EN','ES','PT'].includes(s) && s !== FROM)
      .slice(0, 2);

    // 1) glossary hit?
    let row = getTermByEN(term);
    if (row) {
      const payload = {
        id: row.id,
        term_en: row.term_en,
        term_es: toLangs.includes('ES') ? row.term_es : null,
        term_pt: toLangs.includes('PT') ? row.term_pt : null,
        def_en:  row.def_en,
        def_es:  toLangs.includes('ES') ? row.def_es : null,
        def_pt:  toLangs.includes('PT') ? row.def_pt : null,
        specialty: row.specialty,
        reviewed: row.reviewed,
        updated_at: row.updated_at
      };
      return res.json({ ok: true, data: payload });
    }

    // 2) ad-hoc translate (no DB write)
    const out = { id: null, term_en: term, term_es: null, term_pt: null, def_en: null, def_es: null, def_pt: null };
    for (const L of toLangs) {
      if (L === 'ES') out.term_es = await translate(term, FROM, 'ES');
      if (L === 'PT') out.term_pt = await translate(term, FROM, 'PT');
    }
    out.def_en = await defineShort(out.term_en, 'English');
    if (toLangs.includes('ES') && out.term_es) out.def_es = await defineShort(out.term_es, 'Spanish');
    if (toLangs.includes('PT') && out.term_pt) out.def_pt = await defineShort(out.term_pt, 'Portuguese');

    res.json({ ok: true, data: out });
  } catch (e) {
    console.error('translate error:', e);
    res.status(500).json({ ok: false, error: 'translate_failed', detail: String(e.message || e) });
  }
});

// Glossary list (bounded)
app.get('/api/terms', (req, res) => {
  try {
    const { specialty } = req.query;
    const sql = specialty
      ? `SELECT * FROM terms WHERE specialty = ? ORDER BY term_en COLLATE NOCASE LIMIT 500`
      : `SELECT * FROM terms ORDER BY term_en COLLATE NOCASE LIMIT 500`;
    const rows = specialty
      ? db.prepare(sql).all(specialty)
      : db.prepare(sql).all();
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('terms error:', e);
    res.status(500).json({ ok: false, error: 'terms_failed', detail: String(e.message || e) });
  }
});

// Fast in-glossary search
app.get('/api/search', (req, res) => {
  try {
    console.log('🔎 /api/search', req.query);
    const q = String(req.query.q || '').trim();
    const spec = String(req.query.spec || '').trim();
    if (!q) return res.json({ ok: true, data: [] });

    const like = `%${q}%`;
    const params = [like, like, like, like, like, like];
    let sql = `
      SELECT id, term_en, term_es, term_pt, def_en, def_es, def_pt, specialty, reviewed, updated_at
      FROM terms
      WHERE (term_en LIKE ? OR term_es LIKE ? OR term_pt LIKE ?
             OR def_en LIKE ?  OR def_es LIKE ?  OR def_pt LIKE ?)
    `;
    if (spec) { sql += ` AND specialty = ?`; params.push(spec); }
    sql += ` ORDER BY term_en COLLATE NOCASE LIMIT 100`;

    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('search error:', e);
    res.status(500).json({ ok: false, error: 'search_failed', detail: String(e.message || e) });
  }
});

// Save term to user's deck (unchanged)
app.post('/api/save', (req, res) => {
  const { userId = 'anon', termId, deck = 'My Saved' } = req.body || {};
  if (!termId) return res.status(400).json({ error: 'termId required' });
  db.prepare(`INSERT OR IGNORE INTO user_saves (user_id, term_id, deck_name) VALUES (?, ?, ?)`)
    .run(userId, termId, deck);
  res.json({ ok: true });
});

// Due flashcards (unchanged)
app.get('/api/due', (req, res) => {
  const { userId = 'anon' } = req.query;
  const rows = db.prepare(`
    SELECT t.*, s.interval_days, s.due_date, s.ease
    FROM user_saves us
    JOIN terms t ON us.term_id = t.id
    LEFT JOIN srs_progress s ON s.user_id = us.user_id AND s.term_id = us.term_id
    WHERE us.user_id = ?
      AND (s.due_date IS NULL OR date(s.due_date) <= date('now'))
    ORDER BY t.term_en
    LIMIT 30
  `).all(userId);
  res.json({ ok: true, data: rows });
});

// SRS rating (unchanged)
app.post('/api/srs', (req, res) => {
  const { userId = 'anon', termId, rating } = req.body || {};
  if (!termId || !rating) return res.status(400).json({ error: 'termId & rating required' });

  const get = db.prepare(`SELECT * FROM srs_progress WHERE user_id=? AND term_id=?`).get(userId, termId);
  let ease = get?.ease ?? 2.5;
  let interval = get?.interval_days ?? 1;

  if (rating === 'again') interval = 0;
  else if (rating === 'hard') interval = Math.max(1, Math.round(interval * 0.7));
  else if (rating === 'good') interval = Math.max(1, Math.round(interval * 1.0));
  else if (rating === 'easy') interval = Math.round(interval * 1.4);

  const dueSQL = interval === 0 ? `date('now')` : `date('now', '+' || ${interval} || ' day')`;
  if (get) {
    db.prepare(`UPDATE srs_progress SET ease=?, interval_days=?, due_date=${dueSQL}, updated_at=datetime('now') WHERE id=?`)
      .run(ease, interval, get.id);
  } else {
    db.prepare(`INSERT INTO srs_progress (user_id, term_id, ease, interval_days, due_date) VALUES (?, ?, ?, ?, ${dueSQL})`)
      .run(userId, termId, ease, interval);
  }
  res.json({ ok: true, interval_days: interval });
});

// Redeem license (unchanged)
app.post('/api/redeem', (req, res) => {
  const { userId = 'anon', code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code required' });
  const row = db.prepare(`SELECT * FROM license_codes WHERE code=?`).get(code);
  if (!row) return res.status(404).json({ error: 'invalid code' });
  if (row.status === 'used' && row.user_id && row.user_id !== userId) {
    return res.status(409).json({ error: 'code already used' });
  }
  db.prepare(`INSERT OR IGNORE INTO users (id, plan) VALUES (?, 'pro')`).run(userId);
  db.prepare(`UPDATE users SET plan='pro' WHERE id=?`).run(userId);
  db.prepare(`UPDATE license_codes SET status='used', user_id=?, redeemed_at=datetime('now') WHERE code=?`).run(userId, code);
  res.json({ ok: true, plan: 'pro' });
});

// Get user plan (unchanged)
app.get('/api/user', (req, res) => {
  const { userId = 'anon' } = req.query;
  const row = db.prepare(`SELECT * FROM users WHERE id=?`).get(userId) || { id: userId, plan: 'free' };
  res.json({ ok: true, data: row });
});

// Generate a richer medical definition (no DB write unless you call /api/define)
// Generate AI definition, then persist into DB when useful
app.post('/api/enrich', async (req, res) => {
  try {
    const { term, lang = 'EN' } = req.body || {};
    if (!term) return res.status(400).json({ ok:false, error:'term required' });
    const L = String(lang || 'EN').toUpperCase();
    const col = (L === 'ES') ? 'def_es' : (L === 'PT') ? 'def_pt' : 'def_en';

    // 1) If we already have a decent def in DB, return it (no AI)
    const row = db.prepare(`
      SELECT * FROM terms
      WHERE LOWER(term_en)=LOWER(?)
         OR LOWER(term_es)=LOWER(?)
         OR LOWER(term_pt)=LOWER(?)
      LIMIT 1
    `).get(term, term, term);

    const existing = row?.[col];
    if (existing && existing.trim().split(/\s+/).length >= 25) {
      return res.json({ ok:true, data:{ term: row.term_en || term, lang: L, definition: existing, source:'db' }});
    }

    // 2) Use your translator to generate a better def (HF-first)
    const { defineBetter } = require('./translator');
    let def = await defineBetter(row?.term_en || term, L);
    def = (def || '').trim().replace(/^```[\s\S]*?\n/, '').replace(/```$/, '').trim();

    // 3) Persist only if it looks decent (25+ words)
    if (row && def && def.split(/\s+/).length >= 25) {
      db.prepare(`UPDATE terms SET ${col}=?, updated_at=datetime('now') WHERE id=?`).run(def, row.id);
    }

    res.json({ ok:true, data:{ term: row?.term_en || term, lang: L, definition: def, source: row ? 'ai+saved' : 'ai' }});
  } catch (e) {
    console.error('enrich error:', e);
    res.status(500).json({ ok:false, error:'enrich_failed', detail:String(e.message||e) });
  }
});
// Persist a generated definition into the glossary for a given termId + lang
app.post('/api/define', (req, res) => {
  try {
    const { termId, lang = 'EN', definition } = req.body || {};
    if (!termId || !definition) return res.status(400).json({ ok:false, error:'termId and definition required' });

    const col = lang === 'ES' ? 'def_es' : lang === 'PT' ? 'def_pt' : 'def_en';
    const stmt = db.prepare(`UPDATE terms SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`);
    stmt.run(definition, termId);

    const row = db.prepare(`SELECT * FROM terms WHERE id=?`).get(termId);
    res.json({ ok:true, data: row });
  } catch (e) {
    console.error('define save error:', e);
    res.status(500).json({ ok:false, error:'define_failed', detail:String(e.message||e) });
  }
});

app.get('/__routes', (_, res) => {
  res.json({
    ok: true,
    has_enrich: !!app._router.stack.find(l => l.route && l.route.path === '/api/enrich'),
    has_define: !!app._router.stack.find(l => l.route && l.route.path === '/api/define'),
    routes: app._router.stack
      .filter(l => l.route)
      .map(l => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path }))
  });
});

app.get('/__diag', (_, res) => {
  res.json({
    ok: true,
    translator_provider: process.env.TRANSLATOR || '(unset)',
    has_OPENAI: !!process.env.OPENAI_API_KEY,
    has_HF: !!process.env.HF_API_KEY,
    hf_model: process.env.HF_MODEL || 'default',
    node_env: process.env.NODE_ENV || '(unset)'
  });
});

// ------------ SPA CATCH-ALL (MUST BE LAST) ------------
app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ------------ START SERVER ------------
app.listen(port, () => {
  console.log(`[MedLex] running on http://localhost:${port}  (translator=${provider})`);
});