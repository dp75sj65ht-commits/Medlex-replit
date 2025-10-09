import { $, injectCssOnce, parseNDJSON, pickLangField, first } from './utils/helpers.js';

if (!window.__flashcardsMod) {
  window.__flashcardsMod = (() => {
    injectCssOnce('css-flashcards', '/css/flashcards.css');
    // ... rest of module
    return { init };
  })();
}