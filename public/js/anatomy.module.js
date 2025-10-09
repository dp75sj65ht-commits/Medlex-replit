import { $, injectCssOnce, parseNDJSON, pickLangField, first } from './utils/helpers.js';

if (!window.__anatomyMod) {
  window.__anatomyMod = (() => {
    injectCssOnce('css-anatomy', '/css/anatomy.css');
    // ... rest of module
    return { init };
  })();
}