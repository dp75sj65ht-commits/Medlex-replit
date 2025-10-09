import { $, injectCssOnce, parseNDJSON, pickLangField, first } from './utils/helpers.js';

if (!window.__translateMod) {
  window.__translateMod = (() => {
    injectCssOnce('css-translate', '/css/translate.css');
    // ... rest of module
    return { init };
  })();
}