// --- One-time init guard (single entry point) ---
if (window.__medlexInit) {
  console.warn("MedLex already booted — ignoring subsequent init()");
} else {
  window.__medlexInit = true;
  console.log("MedLex app.js loaded v15");

  // Selector shims
  window.$  = window.$  || ((sel, root = document) => root.querySelector(sel));
  window.$$ = window.$$ || ((sel, root = document) => Array.from(root.querySelectorAll(sel)));

  // Bind the Load button
  if (window.__medlexGlossary) window.__medlexGlossary.wire();

  // Optional: auto-load on first open of the Glossary tab
  document.addEventListener('click', (e) => {
    const b = e.target.closest('nav button'); if (!b) return;
    if (b.dataset.tab === 'glossary' && window.__medlexGlossary && !window.__medlexGlossary.state.loaded) {
      window.__medlexGlossary.load();
    }
  });

  // ===== GLOSSARY MODULE (idempotent and self-contained) =====
  (() => {
    if (window.__medlexGlossary) return; // avoid duplicate modules
    window.__medlexGlossary = { state: { loaded:false, terms:[] } };

    const state = window.__medlexGlossary.state;

    // Ensure a host exists (won't crash if missing)
    function ensureHost() {
      let host = document.getElementById('glossary-list');
      if (!host) {
        const g = document.getElementById('glossary') || document.body;
        host = document.createElement('div');
        host.id = 'glossary-list';
        g.appendChild(host);
      }
      return host;
    }

    // Simple renderer
    function render(terms) {
      const host = ensureHost();
      if (!Array.isArray(terms) || terms.length === 0) {
        host.innerHTML = `<p style="opacity:.7">No terms to show.</p>`;
        return;
      }
      host.innerHTML = terms.slice(0, 500).map(t => {
        const term = (t.term || t.word || t.key || '').toString();
        const def  = (t.definition || t.def || t.explanation || '').toString();
        const spec = (t.specialty || t.category || '').toString();
        const lang = (t.lang || t.language || '').toString();
        return `
          <article class="glossary-item" style="padding:.6rem 1rem;border-bottom:1px solid #eee">
            <div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline;">
              <h4 style="margin:0">${term || '(term)'}</h4>
              <small style="opacity:.6">${[spec, lang].filter(Boolean).join(' · ')}</small>
            </div>
            <p style="margin:.4rem 0 0">${def || '<i style="opacity:.7">No definition</i>'}</p>
          </article>
        `;
      }).join('');
    }

    // NDJSON loader for /api/terms
    async function load() {
      const btn = document.querySelector('#btn-load-terms');
      try {
        if (btn) { btn.disabled = true; btn.dataset.label ??= btn.textContent; btn.textContent = 'Loading…'; }

        const res = await fetch('/api/terms', { cache: 'no-store' });
        const text = await res.text();

        const U = text.trim().toUpperCase();
        if (U.startsWith("<!DOCTYPE") || U.startsWith("<HTML")) {
          throw new Error("Got HTML instead of NDJSON — ensure /api/terms is above SPA catch-all");
        }

        // Parse NDJSON (one JSON object per line)
        const terms = [];
        for (const raw of text.split(/\r?\n/)) {
          const line = raw.trim();
          if (!line) continue;
          try {
            terms.push(JSON.parse(line));
          } catch {
            // salvage JSON if junk wraps the braces
            const i = line.indexOf("{"), j = line.lastIndexOf("}");
            if (i >= 0 && j > i) {
              try { terms.push(JSON.parse(line.slice(i, j + 1))); } catch {}
            }
          }
        }

        console.log("✅ Parsed terms:", terms.length);
        state.terms = terms;
        state.loaded = true;
        render(terms);

      } catch (err) {
        console.error('loadTerms failed:', err);
        ensureHost().innerHTML = `<p style="color:#b00">Failed to load terms: ${err.message}</p>`;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Load terms'; }
      }
    }

    // Bind #btn-load-terms exactly once
    function wire() {
      let btn = document.querySelector('#btn-load-terms');
      if (!btn) return;

      // ✨ Remove ANY previously attached listeners by cloning the node
      const clean = btn.cloneNode(true);
      btn.replaceWith(clean);
      btn = clean;

      // Bind ONLY our handler
      btn.addEventListener('click', load, { passive: true });
    }

    // expose for debugging
    window.__medlexGlossary.render = render;
    window.__medlexGlossary.load   = load;
    
    window.__medlexGlossary.wire   = wire;
    // Alias any legacy global calls to our new loader
    window.loadTerms = load;
  })();


  function init() {
    // Remove any prior handler (if hot-reloaded) then attach exactly one
    if (window.__medlexClickHandler) {
      document.removeEventListener("click", window.__medlexClickHandler);
    }
    window.__medlexClickHandler = (e) => {
      const b = e.target.closest('nav button');
      if (!b) return;
      $$('.active').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const pane = document.getElementById(b.dataset.tab);
      if (pane) pane.classList.add('active');
    };
    document.addEventListener("click", window.__medlexClickHandler, { passive: true });
    console.log("✅ Button listeners attached");

    // kick off your data loads exactly once
    refreshSpecialties();
    // loadTerms() — call here or only when that tab opens
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}



/* ---------------- User state ---------------- */
const state = {
  userId: (() => {
    try {
      const id = localStorage.getItem('medlex_user') || `user_${Math.random().toString(36).slice(2,10)}`;
      localStorage.setItem('medlex_user', id);
      return id;
    } catch { return 'anon'; }
  })(),
  plan: 'free'
};

document.addEventListener('DOMContentLoaded', () => {
  const uid = $('#user-id'); if (uid) uid.textContent = state.userId;
  refreshUser();
});

/* ---------------- Fetch helpers ---------------- */
async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(()=>r.statusText)}`);
  return r.json();
}

/* ---------------- Pretty helpers ---------------- */
function prettySpec(s) {
  if (!s) return 'General';
  return String(s).replace(/_/g, ' ').split(' ')
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
}
function capitalizeTerm (term = "") {
  return term
    ? term  
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
    : "";
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const escAttr = (s) => esc(String(s ?? '')).replace(/"/g,'&quot;');

function refresh() {
  const plan = getPlan();
  const badge   = document.getElementById('plan-badge');
  const goPro   = document.getElementById('upgrade-btn-inline');
  const manage  = document.getElementById('manage-sub-btn');
  const welBlk  = document.getElementById('welcome-upgrade-block');

  // badge text + styles
  if (badge) {
    const txt = (plan || 'free').toUpperCase();
    badge.textContent = txt;
    badge.classList.toggle('free', plan === 'free');
    badge.classList.toggle('pro',  plan === 'pro');
  }

  const isPro = plan === 'pro';
  if (goPro)  goPro.hidden  = isPro;     // show only for FREE
  if (manage) manage.hidden = !isPro;    // show only for PRO
  if (welBlk) welBlk.hidden = isPro;     // welcome upgrade card only for FREE
}

function bind() {
  const goPro  = document.getElementById('upgrade-btn-inline');
  const manage = document.getElementById('manage-sub-btn');
  const welBtn = document.getElementById('welcome-go-pro');

  // Don’t auto-upgrade; just route to Settings (or a Plans page)
  function showPlans() {
    document.querySelector('button[data-tab="settings"]')?.click();
  }

  goPro  && goPro.addEventListener('click', showPlans);
  welBtn && welBtn.addEventListener('click', showPlans);
  manage && manage.addEventListener('click', () => {
    // For PRO users—where should “Manage” go?
    document.querySelector('button[data-tab="settings"]')?.click();
    // Or open your billing portal later.
  });
}

/* ---- offline cache helpers (localStorage) ---- */
const DefCache = {
  key(term, lang) { return `medlex:def:${lang}:${term.toLowerCase()}`; },
  get(term, lang) { try { return localStorage.getItem(this.key(term, lang)) || ''; } catch { return ''; } },
  set(term, lang, text) { try { if (text && text.length) localStorage.setItem(this.key(term, lang), text); } catch {} }
};

// ---- Replace the old function with this version ----
async function refreshSpecialties() {
  try {
    const res = await fetch("/api/specialties", { cache: "no-store" });
    const text = await res.text();

    const T = text.trim().toUpperCase();
    if (T.startsWith("<!DOCTYPE") || T.startsWith("<HTML")) {
      throw new Error("Got HTML instead of JSON");
    }

    const data = JSON.parse(text);               // { specialties: [...] }
    const list = Array.isArray(data) ? data : (data.specialties || []);
    console.log("✅ Parsed specialties:", list.length);

    // TODO: render using `list`
  } catch (err) {
    console.error("specialty refresh failed:", err);
  }
}

// =============== MedLex Router (Welcome + Tabs) ===============
(function NavRouter(){
  const ID = {
    flashcards: 'flashcards',
    enrich:     'enrich',
    anatomy:    'anatomy',
    glossary:   'glossary',
    translate:  'translate',
    settings:   'settings'
  };

  function hideAllTabs() {
    document.querySelectorAll('main .tab').forEach(sec => {
      sec.classList.remove('active');
      sec.setAttribute('hidden', '');
      sec.style.display = 'none';
    });
  }

  function showWelcome() {
    hideAllTabs();
    const w = document.getElementById('welcome');
    if (w) w.hidden = false;
  }

  function showTab(key) {
    const id = ID[key] || key;
    const w = document.getElementById('welcome');
    if (w) w.hidden = true;

    hideAllTabs();

    const sec = document.getElementById(id);
    if (!sec) { console.warn('[router] missing section #' + id); return; }
    sec.removeAttribute('hidden');
    sec.style.display = '';           // let CSS decide layout
    sec.classList.add('active');

    // remember last tab (optional)
    try { localStorage.setItem('medlex_last_tab', id); } catch {}
  }

  // expose for debugging if needed
  window.MedLexRouter = { showWelcome, showTab };

  // Delegate clicks from ANY element with data-tab or data-go (dropdowns, tiles, header)
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tab], [data-go], #home-link');
    if (!el) return;

    // Brand/logo → Welcome
    if (el.id === 'home-link') {
      e.preventDefault();
      showWelcome();
      return;
    }

    const key = el.getAttribute('data-tab') || el.getAttribute('data-go');
    if (!key) return;

    e.preventDefault();
    e.stopPropagation();               // avoid legacy handlers double-running
    showTab(key);
  }, true); // capture: run before older handlers

  // Force Welcome after the whole app initialized (beats legacy "open flashcards" on load)
  window.addEventListener('load', () => {
    // If you *never* want Welcome, comment the next line and set a default below:
    showWelcome();
    // If you want to restore last tab instead:
    // const last = localStorage.getItem('medlex_last_tab'); last ? showTab(last) : showWelcome();
  });
})();

// =================== Nav Router (Welcome + Tabs) ===================
(function NavRouter(){
  // Map aliases (lets you use data-go or data-tab freely)
  const IDMAP = {
    flashcards: 'flashcards',
    enrich:     'enrich',
    anatomy:    'anatomy',
    glossary:   'glossary',
    translate:  'translate',
    settings:   'settings'
  };

  function hideAllTabs() {
    document.querySelectorAll('main .tab').forEach(sec => {
      sec.classList.remove('active');
      sec.setAttribute('hidden', '');
      sec.style.display = 'none'; // bulletproof vs custom CSS
    });
  }

  function showWelcome() {
    const welcome = document.getElementById('welcome');
    if (!welcome) return;
    hideAllTabs();
    welcome.hidden = false;
    // optional: don’t scroll jump
    // welcome.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showTab(id) {
    const targetId = IDMAP[id] || id;
    const welcome = document.getElementById('welcome');
    if (welcome) welcome.hidden = true;

    hideAllTabs();

    const sec = document.getElementById(targetId);
    if (!sec) {
      console.warn('[router] No section with id #' + targetId);
      return;
    }
    sec.removeAttribute('hidden');
    sec.style.display = '';       // let your CSS take over
    sec.classList.add('active');

    // Sync header state if you have buttons with data-tab
    document.querySelectorAll('header nav [data-tab]').forEach(b => b.classList.remove('active'));
    const headerBtn = document.querySelector(`header nav [data-tab="${targetId}"]`);
    if (headerBtn) headerBtn.classList.add('active');

    // Remember last tab (optional)
    try { localStorage.setItem('medlex_last_tab', targetId); } catch(_) {}
  }

  // Expose for other scripts if needed
  window.MedLexRouter = { showTab, showWelcome };

  // --------- Event delegation (works for dropdowns + tiles + old buttons) ---------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tab], [data-go], #home-link');
    if (!el) return;

    // Brand/home → Welcome
    if (el.id === 'home-link') {
      e.preventDefault();
      showWelcome();
      return;
    }

    // Tabs from any UI: dropdown menu items, welcome tiles, header links
    const key = el.getAttribute('data-tab') || el.getAttribute('data-go');
    if (!key) return;

    e.preventDefault();      // prevent default navigation
    e.stopPropagation();     // avoid old handlers double-running
    showTab(key);
  }, true); // capture so we run before legacy handlers

  // --------- Initial view: Welcome first (unless remembered) ----------
  document.addEventListener('DOMContentLoaded', () => {
    const remember = localStorage.getItem('remember_welcome') === 'true';
    const last = localStorage.getItem('medlex_last_tab');

    // If you want Welcome always first: showWelcome();
    // If you want “Welcome unless remember or last exists”, use:
    if (!remember && !last) {
      showWelcome();
    } else if (last) {
      showTab(last);
    } else {
      showWelcome();
    }
  });
})();

// ---------- MedLex Analytics (progress tracking) ----------
const MedLexAnalytics = (() => {
  const KEY = "medlex_stats_v1";

  function _todayStr(d = new Date()) {
    // store dates in local timezone as YYYY-MM-DD
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function _load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
  }

  function _save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  // Ensure container + streak calc on access
  function _ensure() {
    const data = _load();
    data.days = data.days || {};   // map of date -> count
    data.streak = data.streak || 0;
    data.lastDay = data.lastDay || null;
    return data;
  }

  function trackReviewed(n = 1) {
    const data = _ensure();
    const today = _todayStr();

    // increment today
    data.days[today] = (data.days[today] || 0) + n;

    // update streak logic
    if (data.lastDay !== today) {
      const y = new Date(today);
      const prev = new Date(today);
      prev.setDate(y.getDate() - 1);
      const prevKey = _todayStr(prev);
      if (!data.lastDay) {
        data.streak = data.days[today] > 0 ? 1 : 0;
      } else if (data.lastDay === prevKey) {
        data.streak = (data.days[today] > 0) ? (data.streak + 1) : data.streak;
      } else {
        data.streak = (data.days[today] > 0) ? 1 : 0;
      }
      data.lastDay = today;
    }

    _save(data);
    return getSummary();
  }

  function getSummary() {
    const data = _ensure();
    const today = _todayStr();
    const yesterday = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return _todayStr(d);
    })();

    // compute rolling 7-day incl. today
    let weekTotal = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = _todayStr(d);
      weekTotal += (data.days[key] || 0);
    }

    return {
      today: data.days[today] || 0,
      yesterday: data.days[yesterday] || 0,
      week: weekTotal,
      streak: data.streak || 0
    };
  }

  // helper if you want to set user name elsewhere
  function setUserName(name) {
    localStorage.setItem("medlex_user_name", String(name || "").trim());
  }

  return { trackReviewed, getSummary, setUserName };
})();

// Example: hook this into your flashcard review event
// call MedLexAnalytics.trackReviewed(1) each time a card is answered.
// E.g., inside your existing review handler:
// onAnswerCard(() => MedLexAnalytics.trackReviewed(1));


// ---------- Welcome / Landing behavior ----------
(function initWelcome() {
  const el = document.getElementById("welcome");
  if (!el) return;

  const SKIP_KEY = "medlex_skip_welcome";
  const LAST_TAB_KEY = "medlex_last_tab"; // set this whenever user switches tabs
  const skip = localStorage.getItem(SKIP_KEY) === "1";

  // If user chose to skip, do nothing
  if (skip) return;

  // Prepare dynamic content
  const greetEl = el.querySelector(".greet-text");
  const quoteEl = el.querySelector(".mini-quote");
  const btns = el.querySelectorAll(".welcome-actions .btn[data-go]");
  const remember = el.querySelector("#remember-welcome");
  const continueBtn = el.querySelector("#continue-btn");
  const continueLabel = el.querySelector("#continue-label");

  // Greeting
  const hour = new Date().getHours();
  const name = localStorage.getItem("medlex_user_name") || "";
  const hello =
    hour < 12 ? "Good morning" :
    hour < 18 ? "Good afternoon" : "Good evening";
  greetEl.textContent = name ? `${hello}, ${name} 👋` : `${hello} 👋`;

  // Quotes or Stats prompt
  const quotes = [
    "“Small, daily reviews beat cramming.”",
    "“Repetition carves memory.”",
    "“Short sessions, long retention.”",
    "“Learn a bit today; remember a lot tomorrow.”",
    "“Consistency > Intensity.”"
  ];

  // Progress summary (today/yesterday/week/streak)
  const stats = MedLexAnalytics.getSummary();
  document.getElementById("stat-today").textContent = stats.today;
  document.getElementById("stat-yesterday").textContent = stats.yesterday;
  document.getElementById("stat-week").textContent = stats.week;
  document.getElementById("stat-streak").textContent = stats.streak;

  // If they did nothing yesterday, encourage; else random quote
  if (stats.yesterday === 0) {
    quoteEl.textContent = "Tip: 5 quick cards today keeps your streak alive.";
  } else {
    quoteEl.textContent = quotes[Math.floor(Math.random() * quotes.length)];
  }

  // Continue button logic (show last tab)
  const lastTab = localStorage.getItem(LAST_TAB_KEY);
  if (lastTab) {
    const label =
      lastTab === "flashcards" ? "Flashcards" :
      lastTab === "glossary"   ? "Glossary"   :
      lastTab === "settings"   ? "Settings"   :
      "App";
    continueLabel.textContent = label;
    continueBtn.hidden = false;
    continueBtn.addEventListener("click", () => gotoTab(lastTab));
  }

  // Primary action clicks
  btns.forEach(b => {
    b.addEventListener("click", () => gotoTab(b.dataset.go));
  });

  // Remember choice
  remember.addEventListener("change", (e) => {
    localStorage.setItem(SKIP_KEY, e.target.checked ? "1" : "0");
  });

  // Show the welcome overlay last
  el.hidden = false;

  // Helper: activate your existing tab system
  function gotoTab(tabId) {
    // store last tab for "Continue" next time
    localStorage.setItem(LAST_TAB_KEY, tabId);

    // If you already have buttons with [data-tab] that toggle panels:
    const navBtn = document.querySelector(`nav button[data-tab="${tabId}"]`);
    if (navBtn) navBtn.click();

    // Fallback: directly activate the pane if needed
    const allBtns = document.querySelectorAll("nav button");
    const allTabs = document.querySelectorAll(".tab");
    if (allBtns.length && allTabs.length) {
      allBtns.forEach(x => x.classList.remove("active"));
      allTabs.forEach(x => x.classList.remove("active"));
      if (navBtn) navBtn.classList.add("active");
      const pane = document.getElementById(tabId);
      if (pane) pane.classList.add("active");
    }

    // Hide welcome
    document.getElementById("welcome").remove();
  }
})();

// ---------- Optional: track last tab whenever user clicks your nav ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest('nav button[data-tab]');
  if (!b) return;
  localStorage.setItem("medlex_last_tab", b.dataset.tab);
});

// ============== User & Subscription Layer ==============
const UserStore = (() => {
  const KEY = "medlex_user_profile_v1";
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
  function save(p) { localStorage.setItem(KEY, JSON.stringify(p || {})); }
  const defaultProfile = () => ({
    name: localStorage.getItem("medlex_user_name") || "",
    email: "",
    plan: "free",                  // "free" | "pro"
    license: null,                 // e.g. { provider: "stripe", id: "...", status: "active" }
    createdAt: new Date().toISOString()
  });
  function get() {
    const p = load();
    if (!p.plan) { const d = defaultProfile(); const merged = { ...d, ...p }; save(merged); return merged; }
    return p;
  }
  function set(updates) { const merged = { ...get(), ...updates }; save(merged); return merged; }
  function clear() { localStorage.removeItem(KEY); }
  return { get, set, clear };
})();

const SubscriptionManager = (() => {
  const ENTITLEMENTS = {
    free: { maxTerms: 200, translateMode: false, exportEnabled: false },
    pro:  { maxTerms: Infinity, translateMode: true,  exportEnabled: true  }
  };

  function currentPlan() { return UserStore.get().plan || "free"; }
  function entitlements() { return ENTITLEMENTS[currentPlan()]; }

  // Guards — no popups. If blocked, we nudge the inline upgrade UI.
  function guardFeature(featureKey, source = "feature") {
    const ent = entitlements();
    if (ent[featureKey]) return true;
    UpgradeUX.nudge({ reason: featureKey, source });
    return false;
  }
  function guardTermLimit(currentTermCount, source = "terms") {
    const ent = entitlements();
    if (currentTermCount < ent.maxTerms) return true;
    UpgradeUX.nudge({ reason: "term-limit", source, extra: { currentTermCount, limit: ent.maxTerms } });
    return false;
  }

  async function upgrade() {
    // TODO: replace with real checkout — for now, simulate success:
    UserStore.set({ plan: "pro", license: { provider: "mock", id: "MOCK-123", status: "active" } });
    UpgradeUX.refresh();
  }
  function downgrade() {
    UserStore.set({ plan: "free", license: null });
    UpgradeUX.refresh();
  }

  return { currentPlan, entitlements, guardFeature, guardTermLimit, upgrade, downgrade };
})();

// ============== Inline Upgrade UX (no modals) ==============
// Shows/hides:
//  • Header button:   #upgrade-btn-inline (optional)
//  • Welcome block:   #welcome-upgrade-block (shown only for Free)
//  • Plan badge:      #plan-badge (optional)
const UpgradeUX = (() => {
  let headerBtn, welcomeBlock, planBadge, welcomeCta;

  function init() {
    headerBtn    = document.getElementById("upgrade-btn-inline");
    welcomeBlock = document.getElementById("welcome-upgrade-block");
    planBadge    = document.getElementById("plan-badge");
    welcomeCta   = document.getElementById("welcome-go-pro");

    headerBtn?.addEventListener("click", () => SubscriptionManager.upgrade());
    welcomeCta?.addEventListener("click", () => SubscriptionManager.upgrade());

    refresh();
  }

  function refresh() {
    const plan = SubscriptionManager.currentPlan();
    // Header button visible only on Free
    if (headerBtn)  headerBtn.hidden  = (plan === "pro");
    // Welcome upgrade block visible only on Free
    if (welcomeBlock) welcomeBlock.hidden = (plan === "pro");
    // Badge (optional)
    if (planBadge) planBadge.textContent = plan.toUpperCase();
  }

  // When a guard blocks a feature, bring the user to the upgrade UI instead of a popup.
  function nudge({ reason, source, extra } = {}) {
    // Prefer welcome block if it exists (keeps flow simple)
    if (welcomeBlock && !welcomeBlock.hidden) {
      welcomeBlock.scrollIntoView({ behavior: "smooth", block: "center" });
      welcomeBlock.classList.add("pulse");
      setTimeout(() => welcomeBlock.classList.remove("pulse"), 1200);
    } else if (headerBtn && !headerBtn.hidden) {
      headerBtn.focus();
      headerBtn.classList.add("pulse");
      setTimeout(() => headerBtn.classList.remove("pulse"), 1200);
    }
    // (Optional) console tip for debugging:
    if (reason === "term-limit" && extra) {
      console.info(`[MedLex] Free plan term limit reached (${extra.currentTermCount}/${extra.limit}).`);
    } else {
      console.info(`[MedLex] Feature requires Pro: ${reason} (from ${source}).`);
    }
  }

  return { init, refresh, nudge };
})();

document.addEventListener("DOMContentLoaded", () => {
  UpgradeUX.init();
});

// ============== Example usage (keep these helpers) ==============
// 1) Enforce term ceiling when adding/importing terms:
function canAddTerm(currentCount) {
  return SubscriptionManager.guardTermLimit(currentCount, "add-term");
}
// 2) Gate pro-only features:
function tryTranslateFeature() {
  if (!SubscriptionManager.guardFeature("translateMode", "translate")) return;
  // ... run Translate Mode
}
function tryExportFeature() {
  if (!SubscriptionManager.guardFeature("exportEnabled", "export")) return;
  // ... run Export
}


/* ---------------- Translate ---------------- */
function selectedTargets() {
  return Array.from(document.querySelectorAll('input[name="lang"]:checked'))
    .map(b => String(b.value || '').toUpperCase())
    .slice(0, 2);
}
async function translateTerm() {
  const term = $('#term-input')?.value.trim();
  const from = ($('#from-lang')?.value || 'EN').toUpperCase();
  const to = selectedTargets();
  if (!term) return;
  if (!to.length) { alert('Select at least one target language.'); return; }

  const box = $('#result'); if (box) box.innerHTML = `<div class="card">Translating…</div>`;
  try {
    const { data } = await getJSON('/api/translate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ term, from, to })
    });

    const chunks = to.map(L => {
      if (L === 'ES') return `<p><strong>ES:</strong> ${data.term_es ? capitalizeTerm(data.term_es) : '-'}<br/><em>${data.def_es || ''}</em></p>`;
      if (L === 'PT') return `<p><strong>PT:</strong> ${data.term_pt ? capitalizeTerm(data.term_pt) : '-'}<br/><em>${data.def_pt || ''}</em></p>`;
      if (L === 'EN') return `<p><strong>EN:</strong> ${data.term_en ? capitalizeTerm(data.term_en) : '-'}</p>`;
      return '';
    }).join('');

    if (box) {
      box.innerHTML = `
        <div class="card">
          <h3>${capitalizeTerm(data.term_en || term)}</h3>
          ${chunks}
          <button class="to-flashcards"
                  data-id="${data.id || ''}"
                  data-front="${escAttr(data.term_en || term)}"
                  data-back="${escAttr((data.def_en || data.def_es || data.def_pt || ''))}"
                  data-deck="All"
                  data-en="${escAttr(data.term_en || '')}"
                  data-es="${escAttr(data.term_es || '')}"
                  data-pt="${escAttr(data.term_pt || '')}"
                  data-def-en="${escAttr(data.def_en || '')}"
                  data-def-es="${escAttr(data.def_es || '')}"
                  data-def-pt="${escAttr(data.def_pt || '')}">
            Add to Flashcards
          </button>
        </div>`;
    }
  } catch (e) {
    if (box) box.innerHTML = `<div class="card error">Error: ${e.message}</div>`;
    console.error(e);
  }
}

/* ---------------- Glossary (cards) ---------------- */
const LANGS = ['EN','ES','PT'];
function getPrimaryLang() { try { return localStorage.getItem('glossary_lang') || 'EN'; } catch { return 'EN'; } }
function setPrimaryLang(L) { try { localStorage.setItem('glossary_lang', L); } catch {} }
function pickTermByLang(t, L) { return L==='EN'?t.term_en : L==='ES'?t.term_es : t.term_pt; }
function pickDefByLang(t, L)  { return L==='EN'?t.def_en  : L==='ES'?t.def_es  : t.def_pt; }
function fallback(...vals) { for (const v of vals) if (v && String(v).trim()) return v; return ''; }

function renderTermsCards(rows) {
  if (!Array.isArray(rows) || !rows.length) return `<div class="card">No entries.</div>`;
  const L = (document.querySelector('#glossary-lang')?.value || getPrimaryLang()).toUpperCase();
  const order = (L === 'EN') ? ['ES','PT'] : (L === 'ES') ? ['EN','PT'] : ['EN','ES'];

  const cards = rows.map(t => {
    const title = fallback(
      pickTermByLang(t, L),
      L !== 'EN' ? t.term_en : '',
      L !== 'ES' ? t.term_es : '',
      L !== 'PT' ? t.term_pt : ''
    );
    const others = order.map(x => {
      const val = pickTermByLang(t, x);
      const shown = val ? capitalizeTerm(val) : '–';
      return `<span class="pill"><span class="langtag">${x}</span> ${esc(shown)}</span>`;
    }).join('');
    const def = fallback(pickDefByLang(t, L), L !== 'EN' ? t.def_en : '');

    return `
      <div class="gcard" data-term-id="${t.id}">
        <div class="meta"><span class="spec">${esc(prettySpec(t.specialty || 'general'))}</span></div>
        <h3>${esc(capitalizeTerm(title || ''))}</h3>
        <div class="pills">${others}</div>
        ${def ? `<div class="def">${esc(def)}</div>` : ``}
        <div style="margin-top:10px;">
          <button class="to-flashcards"
                  data-id="${t.id || ''}"
                  data-front="${escAttr(title || t.term_en || '')}"
                  data-back="${escAttr(def || t.def_en || '')}"
                  data-deck="${escAttr(t.specialty || 'All')}"
                  data-en="${escAttr(t.term_en || '')}"
                  data-es="${escAttr(t.term_es || '')}"
                  data-pt="${escAttr(t.term_pt || '')}"
                  data-def-en="${escAttr(t.def_en || '')}"
                  data-def-es="${escAttr(t.def_es || '')}"
                  data-def-pt="${escAttr(t.def_pt || '')}">
            Add to Flashcards
          </button>
        </div>
      </div>
    `;
  }).join('');

  return `<div class="gcards">${cards}</div>`;
}

/* --- Client-side filters used by Load and Search rendering --- */
function matchesSpecialty(termObj, spec) {
  if (!spec) return true;
  const tSpec = termObj.specialty || 'general';
  return String(tSpec) === String(spec);
}
function matchesSearch(termObj, q) {
  if (!q) return true;
  const L = (document.querySelector('#glossary-lang')?.value || getPrimaryLang()).toUpperCase();
  const termTxt =
    (L === 'EN' ? termObj.term_en :
     L === 'ES' ? termObj.term_es :
                  termObj.term_pt) || '';
  const defTxt =
    (L === 'EN' ? termObj.def_en :
     L === 'ES' ? termObj.def_es :
                  termObj.def_pt) || '';
  const hay = (termTxt + ' ' + defTxt + ' ' + (termObj.term_en||'') + ' ' + (termObj.def_en||'')).toLowerCase();
  return hay.includes(q.toLowerCase());
}
function applyClientFilters(rows) {
  const q = document.querySelector('#search-input')?.value.trim() || '';
  const spec = document.querySelector('#spec-filter')?.value || '';
  return rows.filter(t => matchesSpecialty(t, spec) && matchesSearch(t, q));
}

  

/* Fetch-all + filter on client */
async function loadTerms() {
  try {
    const res = await fetch("/api/terms", { cache: "no-store" });
    const text = await res.text();

    const T = text.trim().toUpperCase();
    if (T.startsWith("<!DOCTYPE") || T.startsWith("<HTML")) {
      throw new Error("Got HTML instead of NDJSON — check /api/terms route");
    }

    const terms = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      try {
        terms.push(JSON.parse(line));
      } catch {
        // try to salvage a JSON object if there is junk around it
        const i = line.indexOf("{"), j = line.lastIndexOf("}");
        if (i >= 0 && j > i) {
          try { terms.push(JSON.parse(line.slice(i, j + 1))); } catch {}
        }
      }
    }

    console.log("✅ Parsed terms:", terms.length);
    glossaryState.allTerms = terms;
    glossaryState.loaded = true;
    renderGlossary(terms);

  } catch (err) {
    console.error("loadTerms failed:", err);
    const host = $('#glossary-list');
    if (host) host.innerHTML = `<p style="color:#b00">Failed to load terms: ${err.message}</p>`;
  }
}

/* Server search + client filter */
async function searchGlossary() {
  const list = document.querySelector('#terms-list'); if (!list) return;
  const q = document.querySelector('#search-input')?.value.trim() || '';
  const spec = document.querySelector('#spec-filter')?.value || '';

  if (!q && spec) return loadTerms();
  if (!q) {
    list.innerHTML = `<div class="card">Type something to search, or pick a specialty and press Load.</div>`;
    return;
  }

  list.innerHTML = `<div class="card">Searching…</div>`;
  try {
    const url = `/api/search?q=${encodeURIComponent(q)}${spec ? `&spec=${encodeURIComponent(spec)}` : ''}`;
    const r = await fetch(url);
    const text = await r.text();
    const json = JSON.parse(text);
    const rows = applyClientFilters(Array.isArray(json.data) ? json.data : []);
    list.innerHTML = renderTermsCards(rows);
  } catch (e) {
    list.innerHTML = `<div class="card error">Error: ${e.message}</div>`;
    console.error(e);
  }
}

/* ---------------- Flashcards (server “due” list kept; safe if unused) ---------------- */
async function loadDue() {
  const cont = $('#due-list'); if (!cont) return;
  cont.innerHTML = `<div class="card">Loading…</div>`;
  try {
    const { data } = await getJSON(`/api/due?userId=${encodeURIComponent(state.userId)}`);
    if (!data.length) { cont.innerHTML = `<div class="card">No cards due.</div>`; return; }
    cont.innerHTML = data.map(t => `
      <div class="card">
        <h3>${t.term_en}</h3>
        <p><strong>ES:</strong> ${t.term_es || '-'}<br/><strong>PT:</strong> ${t.term_pt || '-'}</p>
        <div class="srs">
          <button data-rate="again" data-id="${t.id}">Again</button>
          <button data-rate="hard"  data-id="${t.id}">Hard</button>
          <button data-rate="good"  data-id="${t.id}">Good</button>
          <button data-rate="easy"  data-id="${t.id}">Easy</button>
        </div>
      </div>
    `).join('');
    cont.querySelectorAll('button[data-rate]').forEach(btn => {
      btn.onclick = async () => {
        const termId = Number(btn.getAttribute('data-id'));
        const rating = btn.getAttribute('data-rate');
        await getJSON('/api/srs', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ userId: state.userId, termId, rating })
        });
        loadDue();
      };
    });
  } catch (e) { cont.innerHTML = `<div class="card error">Error: ${e.message}</div>`; }
}

/* ---------------- Enrich (with offline cache) ---------------- */
async function enrichGenerate() {
  const term = document.querySelector('#enrich-term')?.value.trim();
  const lang = (document.querySelector('#enrich-lang')?.value || 'EN').toUpperCase();
  const box  = document.querySelector('#enrich-result');
  const saveBtn = document.querySelector('#btn-enrich-save');

  if (!term || !box) { alert('Enter a term.'); return; }

  const cached = DefCache.get(term, lang);
  if (cached) {
    box.innerHTML = `<h3>${capitalizeTerm(term)} — ${lang}</h3><p>${cached}</p><small>source: offline cache</small>`;
    saveBtn.disabled = false;
    saveBtn.dataset.lang = lang;
    saveBtn.dataset.term = term;
    return;
  }

  box.innerHTML = `<div class="card">Generating…</div>`;
  try {
    const { data } = await getJSON('/api/enrich', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ term, lang })
    });
    const def = (data?.definition || '').trim();

    box.innerHTML = `
      <h3>${capitalizeTerm(data?.term || term)} — ${lang}</h3>
      <p>${def || '(no output)'}</p>
      <small>source: ${data?.source || 'ai'}</small>
    `;
    if (def) DefCache.set(data?.term || term, lang, def);

    saveBtn.disabled = false;
    saveBtn.dataset.lang = lang;
    saveBtn.dataset.term = term;
  } catch (e) {
    box.innerHTML = `<span class="error">Error: ${e.message}</span>`;
    console.error(e);
    saveBtn.disabled = true;
  }
}
async function enrichSave() {
  const termId = Number(document.querySelector('#enrich-term-id')?.value || '');
  const lang = document.querySelector('#btn-enrich-save')?.dataset.lang || 'EN';
  const box = document.querySelector('#enrich-result');
  if (!termId) { alert('Enter the Term ID to save into.'); return; }
  const p = box?.querySelector('p')?.textContent || '';
  if (!p) { alert('Generate a definition first.'); return; }

  try {
    await getJSON('/api/define', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ termId, lang, definition: p })
    });
    alert('Definition saved to glossary!');
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

/* ---------------- Anatomy (male + female) ---------------- */
async function anatomySearch(q) {
  const list = document.querySelector('#anatomy-results'); 
  const spec = document.querySelector('#anatomy-spec')?.value || '';
  if (!q) { list && (list.innerHTML = `<div class="card">Pick a region or type a query.</div>`); return; }

  list && (list.innerHTML = `<div class="card">Searching “${q}”…</div>`);
  try {
    const url = `/api/search?q=${encodeURIComponent(q)}${spec ? `&spec=${encodeURIComponent(spec)}` : ''}`;
    const r = await fetch(url);
    const text = await r.text();
    const json = JSON.parse(text);
    list && (list.innerHTML = renderTermsCards(json.data));
  } catch (e) {
    list && (list.innerHTML = `<div class="card error">Error: ${e.message}</div>`);
  }
}
function wireAnatomySVG(id) {
  const svg = document.getElementById(id);
  if (!svg) return;
  svg.querySelectorAll('[data-q]').forEach(el => {
    el.addEventListener('click', () => {
      svg.querySelectorAll('[data-q].active').forEach(a => a.classList.remove('active'));
      el.classList.add('active');
      const q = el.getAttribute('data-q') || '';
      const input = document.querySelector('#anatomy-query');
      if (input) input.value = q.split(' ')[0];
      anatomySearch(q);
    });
  });
}

/* ---------------- Settings ---------------- */
async function refreshUser() {
  try {
    const { data } = await getJSON(`/api/user?userId=${encodeURIComponent(state.userId)}`);
    state.plan = data.plan || 'free';
    const planEl = $('#plan'); if (planEl) planEl.textContent = state.plan;
  } catch {}
}
async function redeem() {
  const codeEl = $('#license-code'); if (!codeEl) return;
  const code = codeEl.value.trim(); if (!code) return;
  try {
    await getJSON('/api/redeem', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ userId: state.userId, code })
    });
    await refreshUser();
    alert('Pro unlocked!');
  } catch (e) { alert('Invalid or used code.'); }
}

/* ---------------- Wiring (single DOMContentLoaded) ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  // Translate
  $('#btn-translate')?.addEventListener('click', translateTerm);

  // Glossary
  $('#btn-load-terms')?.addEventListener('click', loadTerms);
  $('#btn-search')?.addEventListener('click', searchGlossary);
  $('#search-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchGlossary(); });

  const gsel = $('#glossary-lang');
  if (gsel) {
    gsel.value = getPrimaryLang();
    gsel.addEventListener('change', () => {
      setPrimaryLang(gsel.value);
      const list = $('#terms-list');
      if (!list || !list.firstChild) return;
      const q = $('#search-input')?.value.trim();
      if (q) searchGlossary(); else loadTerms();
    });
  }

  // Enrich tab
  $('#btn-enrich')?.addEventListener('click', enrichGenerate);
  $('#btn-enrich-save')?.addEventListener('click', enrichSave);

  // Anatomy tab
  $('#btn-anatomy-search')?.addEventListener('click', () => {
    const q = document.querySelector('#anatomy-query')?.value.trim();
    anatomySearch(q);
  });
  document.querySelector('#anatomy-query')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') anatomySearch(e.currentTarget.value.trim());
  });
  wireAnatomySVG('anatomy-male');
  wireAnatomySVG('anatomy-female');

  // Settings
  $('#btn-redeem')?.addEventListener('click', redeem);

  // Build specialties dropdowns on load
  refreshSpecialties();

  console.log('✅ Button listeners attached');
});

/* === Anatomy Phase 1 glue (safe mock) === */
(function(){
  const root = document.getElementById("anatomy-phase1"); if(!root) return;
  const LOCALES = ["en","es","pt"];
  const resultsEl = document.getElementById("anatomy-results");
  function announce(html){ resultsEl && (resultsEl.innerHTML = html); }

  async function handleRegionSelect(el){
    const payload = { sex: el.dataset.sex, area: el.dataset.area, locales: LOCALES };
    const data = await mockSearch(payload); // demo only
    const pills = data.results.map(r =>
      `<span class="pill" title="${r.definition.en}">
        <b>${r.term.en}</b>
        <span>· ES: ${r.term.es}</span>
        <span>· PT: ${r.term.pt}</span>
      </span>`
    ).join(" ");
    announce(`<div><strong>Results:</strong> ${pills || "No matches"}</div>`);
  }
  function onActivate(e){ e.preventDefault(); handleRegionSelect(e.currentTarget); }
  root.querySelectorAll(".hit").forEach(hit => {
    hit.addEventListener("click", onActivate);
    hit.addEventListener("keydown", (e) => { if(e.key === "Enter" || e.key === " "){ onActivate(e); }});
  });

  async function mockSearch({area, sex}) {
    const demo = {
      head_neck: [
        { en:"Skull", es:"Cráneo", pt:"Crânio", def:"Bony structure protecting the brain." },
        { en:"Cervical spine", es:"Columna cervical", pt:"Coluna cervical", def:"Neck segment of the spine." }
      ],
      chest_abdomen: [
        { en:"Thorax", es:"Tórax", pt:"Tórax", def:"Region between neck and abdomen." },
        { en:"Abdomen", es:"Abdomen", pt:"Abdome", def:"Area containing digestive organs." }
      ],
      pelvis: [{ en:"Pelvis", es:"Pelvis", pt:"Pelve", def:"Bony basin of the lower trunk." }]
    };
    const items = (demo[area] || []).map(t => ({ term:{en:t.en, es:t.es, pt:t.pt}, definition:{en:t.def} }));
    return { results: sex === "female" ? items : items.slice().reverse() };
  }
})();

/* ----------------- Unified Glossary/Translate → Flashcards ------------------ */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.to-flashcards');
  if (!btn) return;

  const front  = (btn.dataset.front || '').trim();
  const back   = (btn.dataset.back  || '').trim();

  // Normalize deck name so all specialties look nice in UI
  const deckRaw   = (btn.dataset.deck || 'All').trim();
  const cleanDeck = prettySpec(deckRaw); // e.g., "infectious_disease" → "Infectious Disease"

  const termId = Number(btn.dataset.id || '');

  // Build multilingual payload if present
  const langs = {
    EN:      btn.dataset.en     || '',
    ES:      btn.dataset.es     || '',
    PT:      btn.dataset.pt     || '',
    DEF_EN:  btn.dataset.defEn  || '',
    DEF_ES:  btn.dataset.defEs  || '',
    DEF_PT:  btn.dataset.defPt  || ''
  };

  // 1) Local add (use normalized deck)
  const added = window.medlexFlashcards?.add(front, back, cleanDeck, langs);
  if (!added || added.ok === false) {
    console.warn('Local add failed:', added);
    toast('Couldn’t add card locally.');
    return;
  }

  btn.textContent = 'Added ✓';
  btn.disabled = true;
  toast(`Added to "${cleanDeck}" ✅`);

  // 2) Best-effort server save (unchanged)
  if (termId) {
    try {
      await getJSON('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: state.userId, termId })
      });
    } catch (err) {
      console.warn('Server save failed, local kept:', err);
      toast('Saved locally; server sync failed.');
      btn.disabled = false;
      btn.textContent = 'Retry Add to Flashcards';
    }
  }
});

/* ---------------- Flashcards (Quizlet-style; LOCAL) ---------------- */
(() => {
  const root = document.getElementById('flashcards');
  if (!root) return

  // --- Deck name normalization helpers ---
  function normalizeDeckName(name='All'){
    // prettySpec removes underscores and capitalizes each word
    return prettySpec(String(name || 'All'));
  }

  function normalizeAllDecks(){
    const lcToPretty = new Map();
    (store?.decks || []).forEach(d => lcToPretty.set(String(d).toLowerCase(), normalizeDeckName(d)));
    (store?.cards || []).forEach(c => lcToPretty.set(String(c.deck||'All').toLowerCase(), normalizeDeckName(c.deck||'All')));

    store.cards.forEach(c => c.deck = normalizeDeckName(c.deck));
    const uniqPretty = Array.from(new Set(Array.from(lcToPretty.values()))).sort((a,b)=>a.localeCompare(b));
    store.decks = ['All', ...uniqPretty.filter(d => d!=='All')];
    save(store);
  }

  // Ensure empty state starts hidden (JS will show it when truly empty)
  const __emptyInit = document.getElementById('fc-empty');
  if (__emptyInit && !__emptyInit.classList.contains('hidden')) {
    __emptyInit.classList.add('hidden');
  }

  // Storage + timing
  const dbKey = 'medlex_flashcards';
  const now = () => Date.now();
  const day = 24 * 60 * 60 * 1000;
  const defaultDecks = ['All', 'Anatomy', 'Pharm', 'Path', 'Phys', 'Micro'];
  const defaultEase = 2.5;
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  // Scoped selectors
  const $ = (sel) => root.querySelector(sel);
  // try inside #flashcards first, then global document
  const byId = (id) => root.querySelector('#' + id) || document.getElementById(id);

  // Unified empty-state toggler: supports multiple selectors
  function setEmptyVisible(show) {
    const selectors = ['#fc-empty', '#fc-empty-hint', '.fc-empty', '[data-fc-empty]'];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        // If your CSS has .hidden { display:none!important; } this will work everywhere
        el.classList.toggle('hidden', !show);
      });
    });
  }

  // UI refs
  const deckSel = byId('fc-specialty');
  const modeSel = byId('fc-mode');
  const searchInput = byId('fc-search');

  // Translate controls (and make sure AUTO exists)
  const translateOn  = byId('fc-translate-on');
  const langFromSel  = byId('fc-lang-from');
  const langToSel    = byId('fc-lang-to');
  const swapBtn      = byId('fc-swap');
  function ensureAutoOption(sel){
    if (!sel) return;
    const has = Array.from(sel.options).some(o=>o.value==='AUTO');
    if (!has){
      const opt = document.createElement('option');
      opt.value='AUTO'; opt.textContent='AUTO';
      sel.appendChild(opt);
    }
  }
  ensureAutoOption(langFromSel);
  ensureAutoOption(langToSel);

  // Load or seed
  let store = load();
  function load() {
    const raw = localStorage.getItem(dbKey);
    if (raw) return JSON.parse(raw);
    const seeded = { decks: defaultDecks.slice(), cards: [] };
    localStorage.setItem(dbKey, JSON.stringify(seeded));
    return seeded;
  }
  function save(s = store){ localStorage.setItem(dbKey, JSON.stringify(s)); }

  // CRUD
  function addDeck(name){
    name = (name||'').trim(); if(!name) return;
    if(!store.decks.includes(name)){ store.decks.push(name); save(); refreshDeckUI(); }
  }
  function renameDeck(oldName, newName){
    if(oldName==='All') return;
    newName = (newName||'').trim();
    if(!newName || store.decks.includes(newName)) return;
    store.decks = store.decks.map(d=>d===oldName?newName:d);
    store.cards.forEach(c=>{ if(c.deck===oldName) c.deck=newName; });
    save(); refreshDeckUI(); buildBrowse(); rebuildQueue();
  }
  function deleteDeck(name){
    if(name==='All') return;
    store.cards.forEach(c=>{ if(c.deck===name) c.deck='All'; });
    store.decks = store.decks.filter(d=>d!==name);
    save(); refreshDeckUI(); buildBrowse(); rebuildQueue();
  }
  function addCard({front, back, deck, langs}) {
    const card = {
      id: uid(),
      front: String(front||'').trim(),
      back:  String(back||'').trim(),
      deck: normalizeDeckName(deck || 'All'),
      suspended: false,
      created: now(),
      stats: { reps:0, ease:defaultEase, interval:0, due: now(), last:0 },
      langs: langs && typeof langs === 'object' ? langs : null
    };
    store.cards.push(card);
    save(); buildBrowse(); rebuildQueue();
    return card;
  }
  function removeCard(id){ store.cards = store.cards.filter(c=>c.id!==id); save(); buildBrowse(); rebuildQueue(); }
  function moveCard(id,newDeck){ const c=store.cards.find(x=>x.id===id); if(!c) return; c.deck=newDeck; save(); buildBrowse(); rebuildQueue(); }
  function suspendCard(id,flag=true){ const c=store.cards.find(x=>x.id===id); if(!c) return; c.suspended=!!flag; save(); buildBrowse(); rebuildQueue(); }

  // Scheduler (SM-2-lite)
  function schedule(card, rating){
    const s = card.stats; const t = now();
    if (s.reps===0){
      if (rating==='again') s.interval=0.02;
      else if (rating==='hard') s.interval=0.5;
      else if (rating==='good') s.interval=1;
      else if (rating==='easy') s.interval=3;
      s.reps=1; s.ease=defaultEase;
    } else {
      if (rating==='again') s.ease=Math.max(1.3, s.ease-0.3);
      if (rating==='hard')  s.ease=Math.max(1.3, s.ease-0.15);
      if (rating==='good')  s.ease=s.ease;
      if (rating==='easy')  s.ease=s.ease+0.15;

      if (rating==='again'){ s.interval=0.02; s.reps=0; }
      else if (rating==='hard'){ s.interval=Math.max(1, Math.round(s.interval*1.2)); s.reps+=1; }
      else if (rating==='good'){ s.interval=s.interval?Math.round(s.interval*s.ease):1; s.reps+=1; }
      else if (rating==='easy'){ s.interval=s.interval?Math.round(s.interval*(s.ease+0.15)):3; s.reps+=1; }
    }
    s.last=t; s.due=t + s.interval*day; save();
  }

  // ----- Direction helpers -----
  const ALL_DIRS = [
    ['EN','ES'], ['ES','EN'],
    ['EN','PT'], ['PT','EN'],
    ['ES','PT'], ['PT','ES']
  ];
  function randomDir(){
    return ALL_DIRS[Math.floor(Math.random()*ALL_DIRS.length)];
  }
  function pickDirForCard(card){
    // AUTO if either select is AUTO
    const fromSel = (langFromSel?.value || 'EN').toUpperCase();
    const toSel   = (langToSel?.value   || 'ES').toUpperCase();
    const useAuto = (fromSel==='AUTO') || (toSel==='AUTO');
    if (!translateOn?.checked) return null;

    if (useAuto){
      // choose among directions that have data if possible
      const candidates = ALL_DIRS.filter(([f,t]) => card?.langs?.[f] && card?.langs?.[t]);
      return (candidates.length ? candidates : ALL_DIRS)[Math.floor(Math.random()*(candidates.length?candidates.length:ALL_DIRS.length))];
    }
    return [fromSel, toSel];
  }
  function viewTexts(card, dir){
    if (!card) return {front:'', back:''};
    if (!translateOn?.checked || !card.langs) return { front:card.front, back:card.back };
    const [from,to] = dir || pickDirForCard(card) || [];
    if (!from || !to || !card.langs[from]) return { front:card.front, back:card.back };
    return { front: card.langs[from], back: (card.langs[to] || '(no translation)') };
  }

  // Queue
  let queue=[]; let current=null; let currentDir=null;
  let history = [];  // for prev navigation in cram

  function rebuildQueue(){
    const deck = deckSel?.value || 'All';
    const mode = modeSel?.value || 'due';
    const q=[]; const t=now();
    const qTxt = (searchInput?.value||'').toLowerCase();

    history = []; // reset seen

    for(const c of store.cards){
      if (c.suspended) continue;
      if (deck!=='All' && c.deck!==deck) continue;
      const matches = !qTxt || c.front.toLowerCase().includes(qTxt) || c.back.toLowerCase().includes(qTxt);
      if (!matches) continue;
      if (mode==='cram') q.push(c);
      else if ((c.stats?.due||0) <= t) q.push(c);
    }
    if (mode==='cram') q.sort(()=>Math.random()-.5);
    else q.sort((a,b)=>(a.stats.due||0)-(b.stats.due||0));

    queue = q; current = null; currentDir = null;
    updateCounts();
    setEmptyVisible(queue.length === 0);  // keep the banner in sync
    nextCard(false);
  }

  // Counts
  function updateCounts(){
    const total = store.cards.filter(c=>!c.suspended).length;
    const due = store.cards.filter(c=>!c.suspended && (c.stats?.due||0) <= now()).length;
    byId('fc-counts') && (byId('fc-counts').textContent = `${due} due • ${total} total`);
    if (window.__flashcardsDueHook) window.__flashcardsDueHook(due);
  }

// Study flow
function updateProgress(){
  const remaining = queue.length;
  const seen  = history.length + (current ? 1 : 0);
  const total = seen + remaining;
  const pct = total ? Math.round((seen/total)*100) : 0;
  const progFill = byId('fc-progress-fill');
  const idxText  = byId('fc-index');
  if (progFill) progFill.style.width = pct + '%';
  if (idxText)  idxText.textContent  = `${seen} / ${total}`;
}

function paintCard(){
  const cardEl = byId('fc-card');
  const front  = byId('fc-front');
  const back   = byId('fc-back');
  if (!current) return;
  const v = viewTexts(current, currentDir);
  cardEl?.classList.remove('revealed');
  if (front) front.textContent = v.front || '(front empty)';
  if (back)  back.textContent  = v.back  || '(back empty)';
}

function nextCard(pushHistory = true){
    const actions = byId('fc-actions');
    const cardEl  = byId('fc-card');
    const front   = byId('fc-front');
    const back    = byId('fc-back');

    if (pushHistory && current) {
      history.push({ card: current, dir: currentDir });
    }

    // nothing to study?
    const isEmpty = (!queue.length && !current);
    setEmptyVisible(isEmpty);                        // <— hide/show ALL empty-hint variants
    if (actions) actions.classList.add('hidden');

    if (isEmpty) {
      if (cardEl) cardEl.classList.remove('revealed');
      if (front) front.textContent = 'No cards available here.';
      if (back)  back.textContent  = '';
      updateProgress();
      return;
    }

    // show next card (or keep current if queue just refilled)
    current    = queue.shift() || current;
    currentDir = pickDirForCard(current);
    paintCard();
    updateProgress();
}

function prevCard(){
  if (!history.length) return;
  const last = history.pop();
  if (current) queue.unshift(current);
  current    = last.card;
  currentDir = last.dir || pickDirForCard(current);
  paintCard();
  updateProgress();
}

function reveal(){
  byId('fc-card')?.classList.add('revealed');
  byId('fc-actions')?.classList.remove('hidden');
}

function rate(r){
  if (!current) return;
  if ((modeSel?.value || 'due') === 'cram'){
    if (r === 'again') queue.splice(2, 0, current); // requeue soon
  } else {
    schedule(current, r);
  }
  updateStreak(true);
  nextCard();
}

  // ---- Learn mode (direction-aware) ----
  let learnQueue=[], learnIx=0, learnScore=0;
  function startLearn(){
    const deck = deckSel?.value || 'All';
    const pool = store.cards.filter(c=>!c.suspended && (deck==='All' || c.deck===deck));
    if (pool.length < 4){ byId('learn-q').textContent='Need at least 4 cards.'; byId('learn-opts').innerHTML=''; return; }
    learnQueue = pool.slice().sort(()=>Math.random()-.5);
    learnIx=0; learnScore=0;
    renderLearn();
  }
  function renderLearn(){
    const qEl = byId('learn-q'); const optsEl = byId('learn-opts');
    const cur = learnQueue[learnIx]; if(!cur){ qEl.textContent='Done!'; optsEl.innerHTML=''; return; }

    // choose direction
    const dir = pickDirForCard(cur);
    const askTxt = capitalizeTerm(viewTexts(cur, dir).front);
    const correct = capitalizeTerm(viewTexts(cur, dir).back);

    qEl.textContent = askTxt;

    const wrongs = store.cards
      .filter(c=>c.id!==cur.id)
      .map(c => viewTexts(c, dir).back)
      .filter(Boolean)
      .sort(()=>Math.random()-.5)
      .slice(0,3);

    const choices = [correct, ...wrongs].sort(()=>Math.random()-.5);

    optsEl.innerHTML = choices.map((txt)=>`<button>${escapeHTML(capitalizeTerm(txt))}</button>`).join('');
    optsEl.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
      const picked = b.textContent;
      const ok = picked === correct;
      b.classList.add(ok?'correct':'wrong');
      if(!ok){
        optsEl.querySelectorAll('button').forEach(x=>{ if(x.textContent===correct) x.classList.add('correct'); });
      } else learnScore++;
      setTimeout(()=>{ learnIx++; byId('learn-progress').textContent = `${learnIx} / ${learnQueue.length}`; byId('learn-score').textContent = `Score: ${learnScore}`; renderLearn(); }, 400);
    }));
    byId('learn-progress').textContent = `${learnIx} / ${learnQueue.length}`;
    byId('learn-score').textContent = `Score: ${learnScore}`;
  }

  // ---- Match mode (direction-aware pairs) ----
  let matchStart=0, matchTimer=null, matchOpen=null, matchPairs=0;
  function startMatch(){
    const deck = deckSel?.value || 'All';
    const pool = store.cards.filter(c=>!c.suspended && (deck==='All' || c.deck===deck));
    const pick = pool.slice().sort(()=>Math.random()-.5).slice(0,6);
    const tiles = [];
    pick.forEach(c=>{
      const dir = pickDirForCard(c);
      const left  = capitalizeTerm(viewTexts(c, dir).front);
      const right = capitalizeTerm(viewTexts(c, dir).back);
      tiles.push({id:c.id, txt:left, k:'f'}); tiles.push({id:c.id, txt:right, k:'b'});
    });
    tiles.sort(()=>Math.random()-.5);

    const grid = byId('match-grid');
    grid.innerHTML = tiles.map((t)=>`<button class="match-tile" data-id="${t.id}" data-k="${t.k}">${escapeHTML(t.txt)}</button>`).join('');
    matchOpen=null; matchPairs=0;
    byId('match-time').textContent='0.0s';
    clearInterval(matchTimer);
    matchStart = performance.now();
    matchTimer = setInterval(()=>{
      const s = (performance.now()-matchStart)/1000;
      byId('match-time').textContent = s.toFixed(1)+'s';
    },100);

    grid.onclick = (e)=>{
      const btn = e.target.closest('.match-tile'); if(!btn || btn.classList.contains('matched')) return;
      if (matchOpen === btn){ btn.classList.remove('active'); matchOpen=null; return; }
      btn.classList.add('active');
      if (!matchOpen){ matchOpen=btn; return; }
      const a=matchOpen, b=btn; matchOpen=null;
      const good = a.dataset.id===b.dataset.id && a.dataset.k!==b.dataset.k;
      if (good){
        a.classList.add('matched'); b.classList.add('matched');
        a.classList.remove('active'); b.classList.remove('active');
        matchPairs++;
        if (matchPairs===pick.length){
          clearInterval(matchTimer);
          toast('Matched all pairs! 🧠 ' + byId('match-time').textContent);
          updateStreak(true);
        }
      } else {
        setTimeout(()=>{ a.classList.remove('active'); b.classList.remove('active'); }, 300);
      }
    };

    byId('match-restart')?.addEventListener('click', startMatch, { once:true });
  }

  // extra UI refs + events
  const uiFlash = byId('fc-ui-flashcards');
  const uiLearn  = byId('fc-ui-learn');
  const uiMatch  = byId('fc-ui-match');
  const modeButtons = root.querySelectorAll('.fc-modebtn');
  const deckGrid = byId('fc-deck-grid');
  const deckChooseBtn = byId('fc-choose-deck');
  const streakBadge = byId('fc-streak');

  function updateStreak(onStudy=false){
    const k='medlex_streak';
    const today = new Date(); today.setHours(0,0,0,0);
    const d = JSON.parse(localStorage.getItem(k) || '{"count":0,"last":0}');
    const last = d.last ? new Date(d.last) : null;
    let count = d.count||0;
    const write = (n)=>localStorage.setItem(k, JSON.stringify({count:n, last: today.getTime()}));
    if (onStudy){
      if (!last) write((count||0)+1);
      else {
        const lastDay = new Date(last); lastDay.setHours(0,0,0,0);
        const diffDays = Math.round((today - lastDay)/(24*3600*1000));
        if (diffDays===0) { /* studied today already */ }
        else if (diffDays===1) write((count||0)+1);
        else write(1);
      }
    }
    const cur = JSON.parse(localStorage.getItem(k) || '{"count":0}');
    if (streakBadge) streakBadge.textContent = `🔥 ${cur.count||0}`;
  }
  updateStreak(false);

  // deck grid
  function buildDeckGrid(){
    const counts = {};
    store.cards.forEach(c=>{ if(!c.suspended) counts[c.deck]=(counts[c.deck]||0)+1; });
    const names = ['All', ...store.decks.filter(d=>d!=='All')];
    deckGrid.innerHTML = names.map(d=>`
      <button class="deck-tile" data-deck="${d}">
        <div><strong>${d}</strong></div>
        <div class="count">${counts[d]||0} cards</div>
      </button>
    `).join('');
  }
  deckChooseBtn?.addEventListener('click', ()=>{
    if (deckGrid.classList.contains('hidden')) { buildDeckGrid(); deckGrid.classList.remove('hidden'); }
    else deckGrid.classList.add('hidden');
  });
  deckGrid?.addEventListener('click',(e)=>{
    const t = e.target.closest('.deck-tile'); if(!t) return;
    const d = t.dataset.deck;
    if (deckSel) deckSel.value = d;
    deckGrid.classList.add('hidden');
    rebuildQueue(); buildBrowse();
  });

  // top mode buttons
  modeButtons.forEach(b=>b.addEventListener('click', ()=>{
    modeButtons.forEach(x=>x.classList.remove('active')); b.classList.add('active');
    const ui = b.dataset.ui;
    [uiFlash,uiLearn,uiMatch].forEach(x=>x.classList.add('hidden'));
    (ui==='learn'?uiLearn:ui==='match'?uiMatch:uiFlash).classList.remove('hidden');
    if (ui==='learn') startLearn();
    if (ui==='match') startMatch();
  }));

  // translate controls listeners
  translateOn?.addEventListener('change', rebuildQueue);
  langFromSel?.addEventListener('change', rebuildQueue);
  langToSel?.addEventListener('change', rebuildQueue);
  swapBtn?.addEventListener('click', () => {
    if (!langFromSel || !langToSel) return;
    const f = langFromSel.value; langFromSel.value = langToSel.value; langToSel.value = f;
    rebuildQueue();
  });

  // progress + navigation
  byId('fc-prev')?.addEventListener('click', prevCard);
  byId('fc-next')?.addEventListener('click', ()=>{ if(current) rate('good'); });

  // Reveal + rating + hotkeys + swipe
  byId('fc-card')?.addEventListener('click', reveal);
  byId('fc-card')?.addEventListener('keydown', e => { if (e.code==='Space'){ e.preventDefault(); reveal(); }});
  byId('fc-actions')?.addEventListener('click', e=>{
    const b = e.target.closest('button[data-rate]'); if(!b) return; rate(b.dataset.rate);
  });
  document.addEventListener('keydown', e=>{

    // Optional: restrict by checking flashcards tab visibility
    if (!current) return;
    if (e.key==='1') rate('again');
    if (e.key==='2') rate('hard');
    if (e.key==='3') rate('good');
    if (e.key==='4') rate('easy');
    if (e.code==='Space'){ e.preventDefault(); reveal(); }
  });
  (function(){
    const el = byId('fc-card'); if (!el) return;
    let sx=0,sy=0,moved=false;
    el.addEventListener('touchstart', (e)=>{ const t=e.changedTouches[0]; sx=t.clientX; sy=t.clientY; moved=false; }, {passive:true});
    el.addEventListener('touchmove', ()=>{ moved=true; }, {passive:true});
    el.addEventListener('touchend', (e)=>{
      const t=e.changedTouches[0]; const dx=t.clientX-sx; const dy=t.clientY-sy;
      if (!moved || (Math.abs(dx)<24 && Math.abs(dy)<24)) { reveal(); return; }
      if (Math.abs(dx)>Math.abs(dy)){
        if (dx>0) rate('good'); else rate('again');
      } else { if (dy<0) rate('easy'); else reveal(); }
    }, {passive:true});
  })();

  // Browse (edit/move/suspend/delete)
  function buildBrowse(){
    const ul = byId('fc-list'); 
    if (!ul) return;

    // fresh rebuild (prevents duplicates)
    ul.innerHTML = '';

    // normalize the selected deck name (Title Case, no underscores)
    const deck = normalizeDeckName(deckSel?.value || 'All');
    const qTxt = (searchInput?.value || '').toLowerCase();

    // 1) Gather rows from store, but first normalize each card's deck label
    const rows = store.cards
      .map(c => ({ ...c, deck: normalizeDeckName(c.deck) }))
      .filter(c => !qTxt || c.front.toLowerCase().includes(qTxt) || c.back.toLowerCase().includes(qTxt))
      .filter(c => deck === 'All' || c.deck === deck);

    // 2) Sort (group by deck when "All" is selected; otherwise alpha by front)
    rows.sort((a, b) => {
      if (deck === 'All' && a.deck !== b.deck) {
        return a.deck.localeCompare(b.deck);
      }
      return a.front.localeCompare(b.front);
    });

    // 3) Render list (with deck headers only for "All")
    let currentDeckHeader = '';
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'fc-item';
      li.innerHTML = `<div class="meta" style="opacity:.8">No cards found.</div>`;
      ul.appendChild(li);
      return;
    }

    for (const c of rows) {
      // deck header per group when viewing All
      if (deck === 'All' && c.deck !== currentDeckHeader) {
        currentDeckHeader = c.deck;
        const header = document.createElement('li');
        header.className = 'fc-deck-header';
        header.innerHTML = `<h4 style="margin:.4rem 0;color:var(--accent);font-weight:600;">${c.deck}</h4>`;
        ul.appendChild(header);
      }

      const li = document.createElement('li');
      li.className = 'fc-item';
      li.innerHTML = `
        <div><strong>${escapeHTML(capitalizeTerm(c.front))}</strong></div>
        <div>${escapeHTML(capitalizeTerm(c.back))}</div>
        <div class="meta">
          <span>Deck: ${c.deck}</span>
          <span>Due: ${new Date(c.stats?.due || 0).toLocaleDateString()}</span>
          <span>Reps: ${c.stats?.reps || 0}</span>
          ${c.suspended ? '<span>Suspended</span>' : ''}
        </div>
        <div class="actions">
          <button data-act="edit" data-id="${c.id}">Edit</button>
          <button data-act="move" data-id="${c.id}">Move</button>
          <button data-act="suspend" data-id="${c.id}">${c.suspended ? 'Unsuspend' : 'Suspend'}</button>
          <button data-act="delete" data-id="${c.id}" style="color:#b00">Delete</button>
        </div>
      `;
      ul.appendChild(li);
    }
  }

  // Helpers for browse
  function escapeHTML(s=''){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function refreshDeckUI(){
    const allFromCards = new Set(store.cards.map(c => normalizeDeckName(c.deck)));
    const allFromStore = new Set((store.decks || []).map(normalizeDeckName));
    const merged = new Set(['All', ...allFromStore, ...allFromCards]);
    store.decks = Array.from(merged).sort((a,b)=> a==='All'? -1 : (b==='All'? 1 : a.localeCompare(b)));
    save(store);

    if (deckSel) {
      const current = normalizeDeckName(deckSel.value || 'All');
      deckSel.innerHTML = store.decks.map(d=>`<option value="${d}">${d}</option>`).join('');
      deckSel.value = store.decks.includes(current) ? current : 'All';
    }

    const edSel = byId('fc-specialty-input');
    if (edSel) {
      edSel.innerHTML = store.decks.filter(d => d!=='All').map(d=>`<option value="${d}">${d}</option>`).join('')
                    || '<option value="All">All</option>';
    }

    const list = byId('fc-deck-list');
    if (list) {
      list.innerHTML = store.decks.filter(d=>d!=='All').map(d=>{
        const rid = `r_${d.replace(/\s+/g,'_')}`;
        return `
        <div class="row" style="align-items:center; gap:.5rem;">
          <input id="${rid}" value="${d}" />
          <button data-deck="${d}" data-act="rename">Rename</button>
          <button data-deck="${d}" data-act="delete" style="color:#b00">Delete</button>
        </div>`;
      }).join('') || '<div style="opacity:.7">No custom specialties yet.</div>';
    }
  }

  // Events for deck + mode + search
  deckSel?.addEventListener('change', ()=>{ rebuildQueue(); buildBrowse(); });
  modeSel?.addEventListener('change', rebuildQueue);
  searchInput?.addEventListener('input', ()=>{ rebuildQueue(); buildBrowse(); });

  // Editor
  const editor = byId('fc-editor'); let editingId=null;
  byId('fc-add')?.addEventListener('click', ()=>{
    editingId=null;
    byId('fc-editor-title').textContent='New Card';
    byId('fc-front-input').value=''; byId('fc-back-input').value='';
    if (byId('fc-specialty-input')) {
      byId('fc-specialty-input').value = (deckSel && deckSel.value!=='All' ? deckSel.value : (store.decks[1]||'All'));
    }
    editor?.showModal();
  });
  byId('fc-save')?.addEventListener('click', (e)=>{
    e.preventDefault();
    const front = byId('fc-front-input')?.value || '';
    const back  = byId('fc-back-input')?.value || '';
    const deck  = byId('fc-specialty-input')?.value || 'All';

    if (editingId){
      const c = store.cards.find(x=>x.id===editingId);
      if (c){
        c.front = front.trim();
        c.back  = back.trim();
        c.deck  = deck;
        save();
      }
    } else {
      addCard({ front, back, deck });
    }

    editor?.close();
    buildBrowse();   // <- refresh list immediately
    rebuildQueue();  // <- keep study queue in sync
  });

  // Browse actions — handle Edit / Move / Suspend / Delete
  byId('fc-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;

    const id  = btn.dataset.id;
    const act = btn.dataset.act;

    if (act === 'delete') {
      if (confirm('Delete this card?')) removeCard(id);
      return;
    }

    if (act === 'suspend') {
      const c = store.cards.find(x => x.id === id);
      if (c) suspendCard(id, !c.suspended);
      buildBrowse();
      return;
    }

    if (act === 'move') {
      const newDeck = prompt('Move to which specialty?', deckSel?.value || 'All');
      if (newDeck && store.decks.includes(newDeck)) moveCard(id, newDeck);
      return;
    }

    if (act === 'edit') {
      const c = store.cards.find(x => x.id === id);
      if (!c) return;
      editingId = id;
      byId('fc-editor-title').textContent = 'Edit Card';
      byId('fc-front-input').value = c.front;
      byId('fc-back-input').value  = c.back;
      if (byId('fc-specialty-input')) byId('fc-specialty-input').value = c.deck;
      editor?.showModal();
    }
  });

  // Deck manager
  const decksDlg = byId('fc-decks');
  byId('fc-manage')?.addEventListener('click', ()=>{ refreshDeckUI(); decksDlg?.showModal(); });
  byId('fc-deck-add')?.addEventListener('click', ()=>{
    const name = byId('fc-deck-new')?.value || ''; addDeck(name); if (byId('fc-deck-new')) byId('fc-deck-new').value='';
  });
  byId('fc-deck-list')?.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-deck]'); if(!btn) return;
    const name = btn.dataset.deck; const act = btn.dataset.act;
    if (act==='delete'){ if (confirm(`Delete specialty "${name}"? Cards will move to "All".`)) deleteDeck(name); }
    if (act==='rename'){
      const input = btn.previousElementSibling; const val = (input.value||'').trim();
      if (val && val!==name) renameDeck(name, val);
    }
  });

  // Init
  if (!store.decks || !store.decks.length) store.decks = defaultDecks.slice();
  save(store);

  // normalize historical deck names once at startup
  normalizeAllDecks();

  refreshDeckUI();
  buildBrowse();
  rebuildQueue();

  // ------- PUBLIC BRIDGE (inside IIFE): local add + surface immediately -------
  window.medlexFlashcards = {
    add(front, back, deck = (deckSel?.value || 'All'), langs = null) {
      front = (front || '').trim();
      back  = (back  || '').trim();
      deck = normalizeDeckName(deck);
      if (!front || !back) return { ok:false, reason:'empty' };

      // 👇 normalize the deck name once, centrally
      const cleanDeck = prettySpec(deck || 'All'); // turns "infectious_disease" → "Infectious Disease"

      // ensure deck exists with normalized label
      if (!store.decks.includes(cleanDeck)) {
        store.decks.push(cleanDeck);
        save();
        refreshDeckUI();
      }

      // add card using normalized deck
      const c = addCard({ front, back, deck: cleanDeck, langs });

      // re-select deck, reset filters, rebuild
      if (deckSel) deckSel.value = cleanDeck;
      if (modeSel) modeSel.value = 'cram';
      if (searchInput) searchInput.value = '';
      rebuildQueue();
      buildBrowse();

      try {
        const cardEl = byId('fc-card');
        cardEl?.classList.add('pulse');
        setTimeout(()=>cardEl?.classList.remove('pulse'), 600);
      } catch(e){}

      return { ok:true, id:c.id, deck: cleanDeck };
    }
  };
})();

// =================== Nav Router (Welcome + Tabs) ===================
(function NavRouter(){
  // Map aliases (lets you use data-go or data-tab freely)
  const IDMAP = {
    flashcards: 'flashcards',
    enrich:     'enrich',
    anatomy:    'anatomy',
    glossary:   'glossary',
    translate:  'translate',
    settings:   'settings'
  };

  function hideAllTabs() {
    document.querySelectorAll('main .tab').forEach(sec => {
      sec.classList.remove('active');
      sec.setAttribute('hidden', '');
      sec.style.display = 'none'; // bulletproof vs custom CSS
    });
  }

  function showWelcome() {
    const welcome = document.getElementById('welcome');
    if (!welcome) return;
    hideAllTabs();
    welcome.hidden = false;
    // optional: don’t scroll jump
    // welcome.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showTab(id) {
    const targetId = IDMAP[id] || id;
    const welcome = document.getElementById('welcome');
    if (welcome) welcome.hidden = true;

    hideAllTabs();

    const sec = document.getElementById(targetId);
    if (!sec) {
      console.warn('[router] No section with id #' + targetId);
      return;
    }
    sec.removeAttribute('hidden');
    sec.style.display = '';       // let your CSS take over
    sec.classList.add('active');

    // Sync header state if you have buttons with data-tab
    document.querySelectorAll('header nav [data-tab]').forEach(b => b.classList.remove('active'));
    const headerBtn = document.querySelector(`header nav [data-tab="${targetId}"]`);
    if (headerBtn) headerBtn.classList.add('active');

    // Remember last tab (optional)
    try { localStorage.setItem('medlex_last_tab', targetId); } catch(_) {}
  }

  // Expose for other scripts if needed
  window.MedLexRouter = { showTab, showWelcome };

  // --------- Event delegation (works for dropdowns + tiles + old buttons) ---------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tab], [data-go], #home-link');
    if (!el) return;

    // Brand/home → Welcome
    if (el.id === 'home-link') {
      e.preventDefault();
      showWelcome();
      return;
    }

    // Tabs from any UI: dropdown menu items, welcome tiles, header links
    const key = el.getAttribute('data-tab') || el.getAttribute('data-go');
    if (!key) return;

    e.preventDefault();      // prevent default navigation
    e.stopPropagation();     // avoid old handlers double-running
    showTab(key);
  }, true); // capture so we run before legacy handlers

  // --------- Initial view: Welcome first (unless remembered) ----------
  document.addEventListener('DOMContentLoaded', () => {
    const remember = localStorage.getItem('remember_welcome') === 'true';
    const last = localStorage.getItem('medlex_last_tab');

    // If you want Welcome always first: showWelcome();
    // If you want “Welcome unless remember or last exists”, use:
    if (!remember && !last) {
      showWelcome();
    } else if (last) {
      showTab(last);
    } else {
      showWelcome();
    }
  });
})();

// --- BOOT GUARD: prevent double attach ---
if (window.__medlexBooted) {
  console.warn("MedLex already booted — ignoring second include");
  throw new Error("BOOT_GUARD");
}
window.__medlexBooted = true;
// -----------------------------------------

console.log("MedLex app.js loaded v15");

function init() {
  // attach tab click handlers etc.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('nav button');
    if (!b) return;
    document.querySelectorAll('nav button').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const pane = document.getElementById(b.dataset.tab);
    if (pane) pane.classList.add('active');
  });
  console.log("✅ Button listeners attached");
}

if (window.__medlexBooted && !window.__medlexInited) {
  window.__medlexInited = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

/* ===== EMERGENCY GLOSSARY OVERRIDE (append at end of app.js) ===== */
(function () {
  // Hard guard so we don't re-append on hot reloads
  if (window.__medlexGlossaryOverride) return;
  window.__medlexGlossaryOverride = true;

  // Ensure helpers exist
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Create/ensure host
  function ensureHost() {
    let host = document.getElementById('glossary-list');
    if (!host) {
      const g = document.getElementById('glossary') || document.body;
      host = document.createElement('div');
      host.id = 'glossary-list';
      g.appendChild(host);
    }
    // ensure visible if tabs use .active
    const pane = document.getElementById('glossary');
    if (pane && !pane.classList.contains('active')) {
      // if you require manual click to show the pane, comment this out
      pane.classList.add('active');
      // also deactivate other tabs if your CSS requires it
      $$('.tab.active').forEach(x => { if (x !== pane) x.classList.remove('active'); });
    }
    return host;
  }

  // Robust NDJSON parser
  function parseNDJSON(text) {
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        const i = line.indexOf('{'), j = line.lastIndexOf('}');
        if (i >= 0 && j > i) { try { out.push(JSON.parse(line.slice(i, j + 1))); } catch {} }
      }
    }
    return out;
  }

  // Minimal renderer (tolerant of varied field names)
  function renderTerms(terms) {
    const host = ensureHost();
    if (!Array.isArray(terms) || terms.length === 0) {
      host.innerHTML = `<p style="opacity:.7">No terms to show.</p>`;
      return;
    }

    const lang = currentLang();                // 'en' | 'es' | 'pt'
    const altLangs = ['en','es','pt'].filter(l => l !== lang);

    host.innerHTML = terms.slice(0, 500).map((t) => {
      const specialty = (t.specialty || t.category || t.section || '').toString();
      const reviewed  = (t.reviewed === true) || (t.status === 'reviewed');

      // primary term/def in selected language, with flexible fallbacks
      const termPrimary =
        pickField(t, lang, ['term']) ||
        t.term || t.word || t.key || t.title || t.phrase || '';

      const defPrimary =
        pickField(t, lang, ['definition']) ||
        t.definition || t.def || t.explanation || t.meaning || t.desc || '';

      // alt language pills like "EN analgesia", "PT analgesia"
      const langPills = altLangs.map(L => {
        const alt = pickField(t, L, ['term']) || pickField(t, L, ['definition']) || '';
        return alt ? `<span class="g-lang">${L.toUpperCase()} ${String(alt).trim()}</span>` : '';
      }).join('');

      return `
        <article class="g-card">
          <div class="g-head">
            ${specialty ? `<span>${specialty}</span>` : ``}
            ${reviewed ? `<span class="g-pill">reviewed</span>` : ``}
          </div>
          <h4 class="g-title">${String(termPrimary || '').trim() || '(term)'}</h4>
          <div class="g-langbar">${langPills}</div>
          <p class="g-def">${String(defPrimary || '').trim() || '<i style="opacity:.7">No definition</i>'}</p>
        </article>
      `;
    }).join('');
  }

  // re-render on primary-language change using cached terms (if present)
  const langSel = document.querySelector('#primary-language, #glossary-language, #lang-primary');
  if (langSel) {
    langSel.addEventListener('change', () => {
      // keep what’s currently displayed by re-parsing last loaded list
      const host = document.getElementById('glossary-list');
      // If you saved terms somewhere, reuse them; else call loader again:
      loadTermsNew();
    }, { passive: true });
  }
  
    host.innerHTML = terms.slice(0, 500).map(t => {
      const term = t.term ?? t.word ?? t.key ?? t.title ?? t.phrase ?? '';
      const def  = t.definition ?? t.def ?? t.explanation ?? t.meaning ?? t.desc ?? '';
      const spec = t.specialty ?? t.category ?? t.section ?? '';
      const lang = t.lang ?? t.language ?? '';
      const readable = (String(term).trim() || String(def).trim());
      const body = readable
        ? `<p style="margin:.4rem 0 0">${String(def||'').trim() || '<i style="opacity:.7">No definition</i>'}</p>`
        : `<pre style="white-space:pre-wrap;margin:.4rem 0 0;opacity:.8">${JSON.stringify(t, null, 2)}</pre>`;
      return `
        <article class="term-card">
          <h4>${String(term || '').trim() || '(term)'}</h4>
          <div class="term-meta">
            ${spec ? `<span class="pill">${spec}</span>` : ``}
            ${lang ? `<span class="pill">${lang}</span>` : ``}
          </div>
          <div class="term-def">
            ${String(def || '').trim() || '<i style="opacity:.7">No definition</i>'}
          </div>
        </article>
      `;
    }).join('');
  }

  async function loadTermsNew() {
    let btn = document.querySelector('#btn-load-terms');
    try {
      if (btn) {
        // wipe any old listeners bound to this node
        const clean = btn.cloneNode(true);
        btn.replaceWith(clean);
        btn = clean;
        btn.disabled = true;
        btn.dataset.label ??= btn.textContent;
        btn.textContent = 'Loading…';
      }

      const res  = await fetch('/api/terms', { cache: 'no-store' });
      const text = await res.text();

      const U = text.trim().toUpperCase();
      if (U.startsWith('<!DOCTYPE') || U.startsWith('<HTML')) {
        throw new Error('Got HTML instead of NDJSON — /api/terms is being swallowed by the SPA catch-all');
      }

      const terms = parseNDJSON(text);
      console.log('✅ Parsed terms (override):', terms.length);
      
      // pick primary language from your dropdowns (fallback to 'en')
      function currentLang() {
        const el = document.querySelector('#primary-language, #glossary-language, #lang-primary');
        const val = (el && el.value || '').toLowerCase();
        return ['en','es','pt'].includes(val) ? val : 'en';
      }

      // try several key shapes for term/definition per language
      function pickField(obj, lang, baseKeys) {
        // e.g. baseKeys = ['term'] tries: term_{lang}, {lang}_term, {lang}, term.{lang}, termLang
        const variants = [
          `${baseKeys[0]}_${lang}`, `${lang}_${baseKeys[0]}`, lang,
          `${baseKeys[0]}${lang.toUpperCase()}`, `${baseKeys[0]}${lang[0].toUpperCase()+lang.slice(1)}`,
        ];
        for (const k of variants) if (obj && obj[k]) return obj[k];
        // nested map: { term: { en: ..., es: ... } } or { definition:{...} }
        if (obj && obj[baseKeys[0]] && typeof obj[baseKeys[0]] === 'object' && obj[baseKeys[0]][lang]) {
          return obj[baseKeys[0]][lang];
        }
        return null;
      }
      renderTerms(terms);

    } catch (err) {
      console.error('Glossary override load failed:', err);
      ensureHost().innerHTML = `<p style="color:#b00">Failed to load terms: ${err.message}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Load terms'; }
    }
  }

  // Hijack any inline onclick="loadTerms()"
  window.loadTerms = loadTermsNew;

  // Replace the button node to nuke old listeners, then bind exactly one
  (function wireButton() {
    let btn = document.querySelector('#btn-load-terms');
    if (!btn) return;
    const clean = btn.cloneNode(true);
    btn.replaceWith(clean);
    btn = clean;
    btn.addEventListener('click', loadTermsNew, { passive: true });
  })();

  // Optional: auto-load when the Glossary pane becomes active for the first time
  document.addEventListener('click', (e) => {
    const b = e.target.closest('nav button'); if (!b) return;
    if (b.dataset.tab === 'glossary') {
      const host = document.getElementById('glossary-list');
      if (!host || !host.dataset.loaded) {
        loadTermsNew().then(() => {
          const h = document.getElementById('glossary-list');
          if (h) h.dataset.loaded = '1';
        });
      }
    }
  }, { passive: true });
})();