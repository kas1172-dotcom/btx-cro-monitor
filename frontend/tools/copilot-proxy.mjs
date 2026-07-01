// Local Jarvis proxy — holds ANTHROPIC_API_KEY server-side so the browser never
// sees it. Plain Node, no deps. Run it, then point the app at it:
//
//   ANTHROPIC_API_KEY=sk-ant-... node tools/copilot-proxy.mjs
//   echo 'VITE_COPILOT_ENDPOINT=http://localhost:8787' > .env.local
//   npm run dev
//
// The browser POSTs { system, messages }; this forwards to Claude and returns
// { text }. For the DEPLOYED site, use tools/copilot-worker.js (Cloudflare) or
// any serverless function with the same contract.

import { createServer } from "node:http";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error("Set ANTHROPIC_API_KEY in the environment.");
  process.exit(1);
}
const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.COPILOT_MODEL ?? "claude-opus-4-8";

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  if (req.method !== "POST") return void res.writeHead(405).end();

  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { system, messages } = JSON.parse(body);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages }),
    });
    const data = await r.json();
    const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({ text: text || data?.error?.message || "(no text)" }),
    );
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e) }));
  }
}).listen(PORT, () => console.log(`Jarvis proxy → http://localhost:${PORT} (model ${MODEL})`));
