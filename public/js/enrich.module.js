import { $, injectCssOnce, parseNDJSON, pickLangField, first } from './utils/helpers.js';

if (!window.__enrichMod) {
  window.__enrichMod = (() => {
    injectCssOnce('css-enrich', '/css/enrich.css');
    // ... rest of module
    return { init };
  })();
}