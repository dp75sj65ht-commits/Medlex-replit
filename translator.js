const HF_API_KEY = process.env.HF_API_KEY;
const HF_MODEL   = process.env.HF_MODEL || "HuggingFaceH4/zephyr-7b-beta";

export async function translateText({ text, source = "auto", target = "en" } = {}) {
  if (!text || !text.trim()) {
    return { translation: "", model: HF_MODEL, mode: "empty" };
  }

  // No key? safe stub so app keeps working
  if (!HF_API_KEY) {
    return { translation: `[stub] (${source}→${target}) ${text}`, model: "NO_API_KEY", mode: "stub_no_key" };
  }

  const prompt = [
    "You are a precise translator for clinical/medical terminology.",
    `Translate the following text from ${source} to ${target}.`,
    "Return ONLY the translated text, with no extra words.",
    "",
    `Text: """${text}"""`
  ].join("\n");

  const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(HF_MODEL)}`;
  const body = { inputs: prompt, parameters: { max_new_tokens: 128, temperature: 0.2, return_full_text: false } };

  // up to 3 tries if model is "loading"
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const textBody = await res.text();
      let data;
      try { data = JSON.parse(textBody); } catch { data = textBody; }

      // HF returns 503 with { "error": "...", "estimated_time": n } while spinning up the model
      if (res.status === 503 && typeof data === 'object' && data?.estimated_time) {
        console.warn(`HF warming up (~${data.estimated_time}s). attempt=${attempt}`);
        await new Promise(r => setTimeout(r, Math.min(4000, (data.estimated_time * 1000) || 3000)));
        continue; // try again
      }

      if (!res.ok) {
        console.warn(`HF ${res.status}:`, textBody);
        return { translation: `[stub_on_error] (${source}→${target}) ${text}`, model: HF_MODEL, mode: "stub_hf_error", note: `HF ${res.status}` };
      }

      const out = extractText(data) || "";
      return { translation: out.trim(), model: HF_MODEL, mode: "hf_live" };

    } catch (e) {
      console.warn('HF call failed:', e?.message || e);
      // brief backoff then retry
      await new Promise(r => setTimeout(r, 800));
    }
  }

  // After retries, return a safe stub
  return { translation: `[stub_on_exception] (${source}→${target}) ${text}`, model: HF_MODEL, mode: "stub_exception" };
}

function extractText(data) {
  if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
  if (data && typeof data.generated_text === 'string') return data.generated_text;
  if (data?.choices?.[0]?.text) return data.choices[0].text;
  return typeof data === 'string' ? data : '';
}
