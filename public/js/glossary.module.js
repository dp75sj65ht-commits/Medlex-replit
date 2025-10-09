import { $, injectCssOnce, parseNDJSON, pickLangField, first } from './utils/helpers.js';

if (!window.__glossaryMod) {
  window.__glossaryMod = (() => {
    injectCssOnce('css-glossary', '/css/glossary.css');
    // ... rest of module
    return { init };
  })();
}