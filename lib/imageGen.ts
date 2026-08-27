// Thumbnail image generation — pure API calls, no Python, no local tools.
// Prefers OpenRouter (one key for everything); falls back to OpenAI direct.
// Reference images (competitor thumbs + the avatar likeness bundle) go along
// as input references so the model edits/anchors instead of guessing.

interface GenOpts { prompt: string; refs: string[] } // refs = data URLs

function cred(): { key: string; provider: "openrouter" | "openai" } {
  if (process.env.OPENROUTER_API_KEY) return { key: process.env.OPENROUTER_API_KEY, provider: "openrouter" };
  if (process.env.OPENAI_API_KEY) return { key: process.env.OPENAI_API_KEY, provider: "openai" };
  throw new Error("Set OPENROUTER_API_KEY (or OPENAI_API_KEY) in .env.local");
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!m) return null;
  return new Blob([Buffer.from(m[2], "base64")], { type: m[1] });
}

// Returns a PNG data URL.
export async function generateImage({ prompt, refs }: GenOpts): Promise<string> {
  const { key, provider } = cred();

  if (provider === "openrouter") {
    const body: Record<string, unknown> = {
      model: "openai/gpt-image-2",
      prompt,
      size: "1536x1024",
      n: 1,
    };
    if (refs.length) body.input_references = refs.map((r) => ({ type: "image_url", image_url: { url: r } }));
    const r = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(280_000),
    });
    const j = await r.json();
    const b64 = j?.data?.[0]?.b64_json;
    const url = j?.data?.[0]?.url;
    if (b64) return `data:image/png;base64,${b64}`;
    if (url) {
      const img = await fetch(url).then((x) => x.arrayBuffer());
      return `data:image/png;base64,${Buffer.from(img).toString("base64")}`;
    }
    throw new Error(`Image API returned no image: ${JSON.stringify(j).slice(0, 300)}`);
  }

  // OpenAI direct: /images/edits with refs, /images/generations without.
  if (refs.length) {
    const fd = new FormData();
    fd.append("model", "gpt-image-1");
    fd.append("prompt", prompt);
    fd.append("size", "1536x1024");
    refs.forEach((ref, i) => {
      const blob = dataUrlToBlob(ref);
      if (blob) fd.append("image[]", blob, `ref-${i}.png`);
    });
    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd,
      signal: AbortSignal.timeout(280_000),
    });
    const j = await r.json();
    if (!j?.data?.[0]?.b64_json) throw new Error(j?.error?.message || "no image produced");
    return `data:image/png;base64,${j.data[0].b64_json}`;
  }
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024", n: 1 }),
    signal: AbortSignal.timeout(280_000),
  });
  const j = await r.json();
  if (!j?.data?.[0]?.b64_json) throw new Error(j?.error?.message || "no image produced");
  return `data:image/png;base64,${j.data[0].b64_json}`;
}

// One LLM text call via OpenRouter — used by the hook optimizer and voice draft.
export async function llm(prompt: string, maxTokens = 2000): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || "anthropic/claude-sonnet-4.5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = await r.json();
  return String(j?.choices?.[0]?.message?.content || "");
}
