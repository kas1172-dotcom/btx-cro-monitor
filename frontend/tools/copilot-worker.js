// Cloudflare Worker version of the Jarvis proxy — for the DEPLOYED site.
// Deploy free at cloudflare.com, set the secret, and point the app at its URL:
//
//   npx wrangler deploy tools/copilot-worker.js
//   npx wrangler secret put ANTHROPIC_API_KEY
//   # then set VITE_COPILOT_ENDPOINT=<worker-url> at build time and redeploy Pages
//
// Same contract as the local proxy: POST { system, messages } -> { text }.
// The key lives in the Worker's secret store; the browser never sees it.

export default {
  async fetch(request, env) {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return new Response("POST only", { status: 405, headers: cors });

    try {
      const { system, messages } = await request.json();
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: env.COPILOT_MODEL ?? "claude-opus-4-8", max_tokens: 1024, system, messages }),
      });
      const data = await r.json();
      const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
      return Response.json({ text: text || data?.error?.message || "(no text)" }, { headers: cors });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500, headers: cors });
    }
  },
};
