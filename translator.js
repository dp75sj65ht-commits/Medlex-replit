// translator.js — Hugging Face only version (OpenAI disabled)
const fetch = require('cross-fetch');

// ------------ SETTINGS ------------
const provider = 'huggingface';  // force Hugging Face only
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || '';  // optional
const HF_MODEL = 'gpt2';  // lightweight model, no billing needed
const LANG_NAME = { EN: 'English', ES: 'Spanish', PT: 'Portuguese' };

// ------------ TRANSLATION (MyMemory fallback) ------------
async function mymemoryTranslate(term, from, to) {
  const pair = `${from}|${to}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(term)}&langpair=${pair}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory ${res.status}`);
  const data = await res.json();
  return (data.responseData?.translatedText || '').trim();
}

async function translate(term, from, to) {
  const FROM = (from || 'EN').toUpperCase();
  const TO = (to || 'ES').toUpperCase();
  if (FROM === TO) return term;
  return await mymemoryTranslate(term, FROM, TO);
}

// ------------ SIMPLE SHORT DEFINITION (Fallback) ------------
async function defineShort(term, languageName) {
  const map = {
    English: `Short definition for ${term}.`,
    Spanish: `Definición breve de ${term}.`,
    Portuguese: `Definição breve de ${term}.`
  };
  return map[languageName] || `Short definition for ${term}.`;
}

// ------------ HUGGING FACE AI DEFINITION ------------
// ===== Robust HF call with retries =====
async function hfGenerate(prompt, { maxNewTokens = 220, temperature = 0.25, retries = 3 } = {}) {
  if (!process.env.HF_API_KEY) throw new Error('HF_API_KEY missing');
  const HF_MODEL = process.env.HF_MODEL || 'HuggingFaceH4/zephyr-7b-beta';
  const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(HF_MODEL)}`;

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HF_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: maxNewTokens,
            temperature,
            do_sample: true,
            top_p: 0.95,
            return_full_text: false
          }
        })
      });

      // Model cold-start
      if (res.status === 503) {
        await new Promise(r => setTimeout(r, 1200 * attempt));
        continue;
      }

      if (!res.ok) {
        const txt = await res.text().catch(()=> '');
        throw new Error(`HF ${res.status} ${txt.slice(0,200)}`);
      }

      const data = await res.json();
      let out = '';
      if (Array.isArray(data)) {
        out = data[0]?.generated_text || data[0]?.text || '';
      } else if (data && typeof data === 'object') {
        out = data.generated_text || (Array.isArray(data.choices) ? data.choices[0]?.text : '') || data.text || '';
      } else if (typeof data === 'string') {
        out = data;
      }
      out = (out || '').trim();
      if (out) return out;

      lastErr = new Error('HF returned empty text');
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 800 * attempt));
    }
  }
  throw lastErr || new Error('HF generation failed');
}

// ===== Helpful offline fallback (never blank) =====
function offlineDefinition(term, lang = 'EN') {
  const L = String(lang).toUpperCase();
  const name = L==='ES' ? 'Español' : L==='PT' ? 'Português' : 'English';

  const templates = {
    EN: `${term} is a clinically relevant condition. A concise definition should mention the key anatomy involved, a brief pathophysiology, hallmark presentation (onset, location/quality of symptoms, key exam or lab clues), and 1–2 important differential diagnoses. Keep the description objective and focused for medical students.`,
    ES: `${term} es una entidad clínica relevante. Una definición concisa debe incluir la anatomía implicada, una breve fisiopatología, la presentación característica (inicio, localización/clave de síntomas, signos o datos) y 1–2 diagnósticos diferenciales importantes. Mantén la descripción objetiva y orientada a estudiantes de medicina.`,
    PT: `${term} é uma condição clinicamente relevante. Uma definição concisa deve citar a anatomia envolvida, a fisiopatologia básica, a apresentação típica (início, localização/qualidade dos sintomas, sinais-chave) e 1–2 diagnósticos diferenciais importantes. Mantenha a descrição objetiva e voltada a estudantes de medicina.`
  };
  return templates[L] || templates.EN;
}

// ===== Better definition using HF primarily =====
async function defineBetter(term, langCode = 'EN') {
  const LANG_NAME = { EN: 'English', ES: 'Spanish', PT: 'Portuguese' };
  const langName = LANG_NAME[String(langCode || 'EN').toUpperCase()] || 'English';

  const prompt = `
You are a clinician writing a concise, accurate medical definition for medical students.
Language: ${langName}
Length: 40–80 words (one short paragraph).
Include when relevant: anatomy involved, brief pathophysiology, hallmark presentation, and 1–2 key differential clues.
Avoid treatment details, brand names, and references.

Definition for: "${term}"
Return only the final definition text, no headings or quotes.
`.trim();

  try {
    let text = await hfGenerate(prompt, { maxNewTokens: 220, temperature: 0.25, retries: 3 });
    // Clean fences if any
    text = text.replace(/^```[\s\S]*?\n/, '').replace(/```$/, '').trim();

    // If too short, try once more with slightly different sampling
    if (text.split(/\s+/).length < 25) {
      text = await hfGenerate(prompt, { maxNewTokens: 240, temperature: 0.35, retries: 2 });
      text = text.replace(/^```[\s\S]*?\n/, '').replace(/```$/, '').trim();
    }

    return text || offlineDefinition(term, langCode);
  } catch (e) {
    console.error('defineBetter (HF) failed:', e.message || e);
    return offlineDefinition(term, langCode);
  }
}

// ------------ EXPORTS ------------
module.exports = {
  provider,
  translate,
  defineShort,
  defineBetter
};