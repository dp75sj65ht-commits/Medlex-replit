// translator.js (ESM)
// Reads HF_API_KEY and HF_MODEL from env, calls Hugging Face Inference API.
// Falls back to safe stubs so the app never crashes.

const HF_API_KEY = process.env.HF_API_KEY; // set in Replit Secrets
const HF_MODEL   = process.env.HF_MODEL || "HuggingFaceH4/zephyr-7b-beta";

/**
 * Translate text from source -> target
 * @param {Object} opts
 * @param {string} opts.text
 * @param {string} [opts.source="auto"]
 * @param {string} [opts.target="en"]
 * @returns {Promise<{translation: string, model: string, mode?: string, note?: string}>}
 */
export async function translateText({ text, source = "auto", target = "en" } = {}) {
  if (!text || !text.trim()) {
    return { translation: "", model: HF_MODEL, mode: "empty" };
  }

  // If no API key, return stub instead of throwing
  if (!HF_API_KEY) {
    return {
      translation: `[stub] (${source}→${target}) ${text}`,
      model: "NO_API_KEY",
      mode: "stub_no_key"
    };
  }

  const prompt = [
    "You are a precise translator for clinical/medical terminology.",
    `Translate the following text from ${source} to ${target}.`,
    "Return ONLY the translated text, with no extra words.",
    "",
    `Text: """${text}"""`
  ].join("\n");

  const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(HF_MODEL)}`;
  const body = {
    inputs: prompt,
    parameters: { max_new_tokens: 128, temperature: 0.2, return_full_text: false }
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`HF API ${res.status}: ${errText}`);
      return {
        translation: `[stub_on_error] (${source}→${target}) ${text}`,
        model: HF_MODEL,
        mode: "stub_hf_error",
        note: `HF ${res.status}`
      };
    }

    const data = await res.json();
    const translation = extractText(data) || "";
    return { translation: translation.trim(), model: HF_MODEL, mode: "hf_live" };
  } catch (e) {
    console.warn("HF call failed:", e?.message || e);
    return {
      translation: `[stub_on_exception] (${source}→${target}) ${text}`,
      model: HF_MODEL,
      mode: "stub_exception"
    };
  }
}

/** Try common HF response shapes */
function extractText(data) {
  if (Array.isArray(data) && data.length && typeof data[0]?.generated_text === "string") {
    return data[0].generated_text;
  }
  if (data && typeof data.generated_text === "string") {
    return data.generated_text;
  }
  if (data?.choices && Array.isArray(data.choices) && typeof data.choices[0]?.text === "string") {
    return data.choices[0].text;
  }
  return typeof data === "string" ? data : "";
}
