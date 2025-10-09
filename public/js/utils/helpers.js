/* ---------- DOM ---------- */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const on = (el, type, handler, opts) => el && el.addEventListener(type, handler, opts);
export const off = (el, type, handler, opts) => el && el.removeEventListener(type, handler, opts);

/* Append if missing */
export function ensureHost(id, mount = document.body) {
  let n = document.getElementById(id);
  if (!n) { n = document.createElement('div'); n.id = id; mount.appendChild(n); }
  return n;
}

/* One-time CSS link injection */
export function injectCssOnce(id, href) {
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet'; link.href = href;
  document.head.appendChild(link);
}

/* ---------- Utils ---------- */
export function debounce(fn, ms = 250) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function first(obj, keys) {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  return null;
}

/* Robust NDJSON parse (tolerant) */
export function parseNDJSON(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    try { out.push(JSON.parse(line)); }
    catch { const i = line.indexOf('{'), j = line.lastIndexOf('}'); if (i>=0 && j>i) { try { out.push(JSON.parse(line.slice(i, j+1))); } catch {} } }
  }
  return out;
}

/* Language-aware field picker (handles many shapes) */
export function pickLangField(obj, lang, bases) {
  const L = (lang || '').toLowerCase();
  const U = L.toUpperCase();
  const C = L.charAt(0).toUpperCase() + L.slice(1);

  const variants = [];
  for (const base of bases) {
    variants.push(
      `${base}_${L}`, `${L}_${base}`, `${base}_${U}`, `${U}_${base}`,
      `${base}${C}`, `${base}${U}`
    );
    if (base === 'definition' || base === 'def') variants.push(`def_${L}`, `${L}_def`, `def_${U}`, `${U}_def`);
    if (base === 'term')        variants.push(`name_${L}`, `${L}_name`, `entry_${L}`, `${L}_entry`);
  }

  for (const base of bases) {
    const nested = obj && obj[base];
    if (nested && typeof nested === 'object') {
      if (nested[L] != null) return nested[L];
      if (nested[U] != null) return nested[U];
    }
  }
  return first(obj, variants);
}