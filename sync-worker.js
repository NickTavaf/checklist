// Coursely sync Worker
// Stores each sync code's progress in Cloudflare KV and merges updates from
// every device, so nothing gets overwritten when two devices change things.
//
// Setup (Cloudflare dashboard):
//   1. Workers & Pages → KV → Create namespace, name it "coursely-sync"
//   2. Workers & Pages → Create Worker → paste this file → Deploy
//   3. Worker → Settings → Bindings → Add → KV namespace
//        Variable name: SYNC     Namespace: coursely-sync
//   4. Copy the Worker URL into SYNC_URL in index.html

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  
  function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
    });
  }
  
  function emptyBundle() {
    return { state: {}, customAssignments: [], classColorOverrides: {}, palette: null, prefsT: 0 };
  }
  
  // Same rules as the app: newest change per assignment wins, custom
  // assignments are combined, and the newest colour settings win.
  function merge(base, incoming) {
    const out = {
      state: { ...(base.state || {}) },
      customAssignments: [...(base.customAssignments || [])],
      classColorOverrides: base.classColorOverrides || {},
      palette: base.palette || null,
      prefsT: base.prefsT || 0,
    };
    for (const [id, entry] of Object.entries(incoming.state || {})) {
      const current = out.state[id];
      if (!current || (entry.t || 0) > (current.t || 0)) out.state[id] = entry;
    }
    const ids = new Set(out.customAssignments.map(a => a.id));
    for (const a of incoming.customAssignments || []) {
      if (a && a.id && !ids.has(a.id)) { out.customAssignments.push(a); ids.add(a.id); }
    }
    if ((incoming.prefsT || 0) > out.prefsT) {
      out.classColorOverrides = incoming.classColorOverrides || {};
      out.palette = incoming.palette || out.palette;
      out.prefsT = incoming.prefsT;
    }
    return out;
  }
  
  export default {
    async fetch(request, env) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  
      const code = (new URL(request.url).searchParams.get("code") || "").toUpperCase();
      if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return json({ error: "Invalid sync code." }, 400);
  
      const key = "sync:" + code;
      const existing = (await env.SYNC.get(key, "json")) || emptyBundle();
  
      if (request.method === "GET") return json(existing);
  
      if (request.method === "POST") {
        const raw = await request.text();
        if (raw.length > 500000) return json({ error: "Too much data." }, 413);
        let incoming;
        try { incoming = JSON.parse(raw); } catch (e) { return json({ error: "Bad JSON." }, 400); }
        const merged = merge(existing, incoming);
        await env.SYNC.put(key, JSON.stringify(merged));
        return json(merged);
      }
  
      return json({ error: "Method not allowed." }, 405);
    },
  };