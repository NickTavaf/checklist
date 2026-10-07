// Coursely Worker
//   /parse  → reads pasted syllabus text with Claude and returns the assignments
//   anything else → sync: stores progress in Cloudflare KV and merges updates
//                   from every device, so nothing gets overwritten.
//
// Setup (Cloudflare dashboard):
//   1. KV binding  — Settings → Bindings → Add → KV namespace
//        Variable name: SYNC     Namespace: coursely-sync
//   2. AI binding  — Settings → Bindings → Add → Workers AI
//        Variable name: AI
//      (Cloudflare's built-in AI: no API key, free daily allowance.)
//
//   Optional: instead of Cloudflare's AI you can use Claude by adding a secret
//   named ANTHROPIC_API_KEY. If both are set, Cloudflare's AI is used.

const CF_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const MAX_SYLLABUS_CHARS = 60000;

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
  return { state: {}, customAssignments: [], classColorOverrides: {}, palette: null, prefsT: 0, removedClasses: {} };
}

// When a custom assignment was added (its id is "custom-<timestamp>-n")
function createdAt(a) { const m = /^custom-(\d+)/.exec((a && a.id) || ""); return m ? Number(m[1]) : 0; }

// Same rules as the app: newest change per assignment wins, custom
// assignments are combined, the newest colour settings win, and deleted
// classes stay deleted.
function merge(base, incoming) {
  const out = {
    state: { ...(base.state || {}) },
    customAssignments: [...(base.customAssignments || [])],
    classColorOverrides: base.classColorOverrides || {},
    palette: base.palette || null,
    prefsT: base.prefsT || 0,
    removedClasses: { ...(base.removedClasses || {}) },
  };
  for (const [cls, t] of Object.entries(incoming.removedClasses || {})) {
    if (typeof t === "number" && t > (out.removedClasses[cls] || 0)) out.removedClasses[cls] = t;
  }
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
  // Drop assignments that belong to a deleted class (added before it was deleted)
  out.customAssignments = out.customAssignments.filter(a => {
    const t = out.removedClasses[a.class];
    return !t || createdAt(a) >= t;
  });
  return out;
}

/* ---------- syllabus parsing ---------- */

const PARSE_INSTRUCTIONS = `You extract every graded or due item from a college course syllabus.

Return ONLY a JSON object, no other text, in exactly this shape:
{"assignments":[{"class":"...","title":"...","date":"YYYY-MM-DD","time":"...","desc":"..."}]}

Rules:
- "class": a short course name (e.g. "Aesthetics", "Thesis 1"), the same for every item from this syllabus.
- "title": short and specific (e.g. "Response Paper #3: Plato's Cave").
- "date": the due date as YYYY-MM-DD. Use the term/year stated in the syllabus; if no year is given, use the year from TODAY below, rolling into next year only for months clearly after the term starts.
- "time": the due time as written ("11:59pm", "10am", "in class", "before class"). Use "" if none is given.
- "desc": one or two sentences on what to do, from the syllabus. If two sources in the syllabus disagree about a date, mention that.
- Include readings or classes only if something is actually due or graded. Skip items with no date at all.
- Sort by date.`;

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON");
  return JSON.parse(text.slice(start, end + 1));
}

function cleanAssignment(a) {
  if (!a || typeof a !== "object") return null;
  const date = String(a.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const title = String(a.title || "").trim();
  if (!title) return null;
  return {
    class: String(a.class || "Class").trim().slice(0, 80),
    title: title.slice(0, 200),
    date,
    time: String(a.time || "").trim().slice(0, 60),
    desc: String(a.desc || "").trim().slice(0, 1000),
  };
}

// Cloudflare's built-in AI. Returns the model's text answer.
async function askCloudflareAI(env, today, text) {
  const out = await env.AI.run(CF_MODEL, {
    messages: [
      { role: "system", content: PARSE_INSTRUCTIONS },
      { role: "user", content: `TODAY: ${today}\n\nSYLLABUS:\n${text}` },
    ],
    max_tokens: 4096,
    temperature: 0,
  });
  const r = out && out.response;
  return typeof r === "string" ? r : JSON.stringify(r || {});
}

async function handleParse(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.AI && !env.ANTHROPIC_API_KEY) {
    return json({ error: "The Worker has no AI connected. In Cloudflare, open the Worker → Settings → Bindings → Add → Workers AI, and name it AI." }, 500);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  const text = String(body.syllabusText || "").trim();
  if (text.length < 30) return json({ error: "Paste in more of the syllabus first." }, 400);
  if (text.length > MAX_SYLLABUS_CHARS) {
    return json({ error: "That syllabus is very long. Paste just the schedule / assignments part." }, 413);
  }

  const today = new Date().toISOString().slice(0, 10);

  if (env.AI) {
    let outText;
    try { outText = await askCloudflareAI(env, today, text); }
    catch (e) {
      const m = String(e && e.message || e);
      if (/limit|quota|neuron|429/i.test(m)) return json({ error: "Today's free AI allowance is used up. Try again tomorrow." }, 429);
      return json({ error: "The AI couldn't read that one. Try again, or paste just the schedule part." }, 502);
    }
    let parsed;
    try { parsed = extractJson(outText); } catch (e) {
      return json({ error: "The AI's answer couldn't be read. Try pasting just the schedule part." }, 502);
    }
    return json({ assignments: (parsed.assignments || []).map(cleanAssignment).filter(Boolean) });
  }

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        system: PARSE_INSTRUCTIONS,
        messages: [{ role: "user", content: `TODAY: ${today}\n\nSYLLABUS:\n${text}` }],
      }),
    });
  } catch (e) {
    return json({ error: "Couldn't reach the AI service. Try again in a moment." }, 502);
  }

  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data) {
    const msg = data && data.error && data.error.message ? data.error.message : `status ${resp.status}`;
    return json({ error: "The AI service returned an error: " + msg }, 502);
  }

  const outText = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  let parsed;
  try { parsed = extractJson(outText); } catch (e) {
    return json({ error: "The AI's answer couldn't be read. Try pasting the syllabus again." }, 502);
  }
  const assignments = (parsed.assignments || []).map(cleanAssignment).filter(Boolean);
  return json({ assignments });
}

/* ---------- entry point ---------- */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (new URL(request.url).pathname.replace(/\/+$/, "") === "/parse") return handleParse(request, env);

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
      const out = JSON.stringify(merged);
      // Only write when something changed — keeps well inside KV's free write limit
      if (out !== JSON.stringify(existing)) await env.SYNC.put(key, out);
      return json(merged);
    }

    return json({ error: "Method not allowed." }, 405);
  },
};