// Coursely Worker
//   /parse  → reads a syllabus (pasted text, text pulled from a PDF, and/or photos of the
//             pages) with AI and returns the assignments
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
const CF_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct"; // reads photos / scanned pages
const MAX_IMAGES = 10;
const MAX_IMAGE_CHARS = 4000000; // one base64 photo (the site shrinks them to ~1600px first)
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
  return { state: {}, customAssignments: [], classColorOverrides: {}, palette: null, prefsT: 0, removedClasses: {}, docs: {} };
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
    // notebooks, notebook pages, sticky notes, trash and calendar events: one record each,
    // the newest version of every record wins (deleted ones stay as small tombstones)
    docs: { ...(base.docs || {}) },
  };
  for (const [k, r] of Object.entries(incoming.docs || {})) {
    if (!r || typeof r.t !== "number" || k.length > 300) continue;
    const cur = out.docs[k];
    if (!cur || r.t > cur.t) out.docs[k] = r.del ? { t: r.t, del: 1 } : { t: r.t, d: r.d };
  }
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

// Photos come in as data URLs ("data:image/jpeg;base64,...").
function cleanImages(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(s => typeof s === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(s) && s.length <= MAX_IMAGE_CHARS).slice(0, MAX_IMAGES);
}

// Cloudflare's vision model copies out the text of one page photo. The first time,
// Meta's license has to be accepted for the account, which is done here automatically.
async function transcribePage(env, image) {
  const input = {
    messages: [
      { role: "system", content: "You copy text from photos of documents exactly. Output only the text, no commentary." },
      { role: "user", content: "Write out all the text on this syllabus page, keeping dates, times, and table rows on the same line." },
    ],
    image,
    max_tokens: 2048,
    temperature: 0,
  };
  try {
    return (await env.AI.run(CF_VISION_MODEL, input)).response || "";
  } catch (e) {
    if (!/agree|licen[cs]e/i.test(String(e && e.message || e))) throw e;
    await env.AI.run(CF_VISION_MODEL, { prompt: "agree" });
    return (await env.AI.run(CF_VISION_MODEL, input)).response || "";
  }
}

async function handleParse(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.AI && !env.ANTHROPIC_API_KEY) {
    return json({ error: "The Worker has no AI connected. In Cloudflare, open the Worker → Settings → Bindings → Add → Workers AI, and name it AI." }, 500);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  let text = String(body.syllabusText || "").trim();
  const images = cleanImages(body.images);
  if (text.length < 30 && !images.length) return json({ error: "Upload a PDF or photos, or paste in more of the syllabus first." }, 400);

  const today = new Date().toISOString().slice(0, 10);

  // Photos: with Cloudflare's AI, copy out each page's text first, then read it like pasted text.
  if (images.length && env.AI) {
    const pages = [];
    for (let i = 0; i < images.length; i++) {
      try { pages.push(`--- Page ${i + 1} ---\n` + await transcribePage(env, images[i])); }
      catch (e) {
        const m = String(e && e.message || e);
        if (/limit|quota|neuron|429/i.test(m)) return json({ error: "Today's free AI allowance is used up. Try again tomorrow." }, 429);
        return json({ error: "The AI couldn't read those photos. Try clearer photos, or paste the text." }, 502);
      }
    }
    text = [text, ...pages].filter(Boolean).join("\n\n");
    if (text.replace(/\s+/g, "").length < 30) return json({ error: "Couldn't find any text in those photos. Try clearer photos." }, 422);
  }
  if (text.length > MAX_SYLLABUS_CHARS) {
    return json({ error: "That syllabus is very long. Paste or upload just the schedule / assignments part." }, 413);
  }

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
        messages: [{ role: "user", content: [
          ...images.map(src => { const [, type, data] = /^data:(image\/\w+);base64,(.*)$/.exec(src); return { type: "image", source: { type: "base64", media_type: type, data } }; }),
          { type: "text", text: `TODAY: ${today}\n\nSYLLABUS:\n${text || "(see the photos of the syllabus pages above)"}` },
        ] }],
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

/* ---------- accounts: email + password, and Sign in with Apple ----------
   An account just remembers which private sync code holds that person's checklist, so
   signing in on a new device loads the same list. Signing in is optional.

   Settings (Cloudflare → Worker → Settings → Variables), all optional:
     APPLE_AUDIENCES   comma-separated: the app's bundle ID and the website's Services ID
                       (default: com.nicktavaf.checklist)
     APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (secret, the .p8 file's text)
                       let "Delete account" also revoke Sign in with Apple, as Apple asks. */

const enc = new TextEncoder();
const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const fromB64url = s => fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
const b64url = buf => toB64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function randomCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(8));
  const s = Array.from(r, x => A[x % A.length]).join("");
  return s.slice(0, 4) + "-" + s.slice(4);
}
async function hashPassword(password, saltB64) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64(saltB64), iterations: 100000 }, key, 256);
  return toB64(bits);
}
function sameString(a, b) {   // compare without leaking timing
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function startSession(env, acctKey, acct) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.SYNC.put("session:" + token, acctKey);
  return { token, code: acct.code, email: acct.email || "", kind: acct.kind };
}

async function verifyAppleToken(idToken, env) {
  const [h, p, sig] = String(idToken || "").split(".");
  if (!sig) throw new Error("bad token");
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  const { keys } = await (await fetch("https://appleid.apple.com/auth/keys")).json();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(sig), enc.encode(h + "." + p));
  const audiences = (env.APPLE_AUDIENCES || "com.nicktavaf.checklist").split(",").map(s => s.trim());
  if (!ok || payload.iss !== "https://appleid.apple.com" || !audiences.includes(payload.aud) || payload.exp * 1000 < Date.now()) throw new Error("token rejected");
  return payload;
}
async function appleClientSecret(env, clientId) {
  const pem = String(env.APPLE_PRIVATE_KEY).replace(/-----[^-]+-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", fromB64(pem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: "ES256", kid: env.APPLE_KEY_ID })));
  const body = b64url(enc.encode(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: clientId })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return head + "." + body + "." + b64url(sig);
}
const appleRevokeReady = env => env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY;
async function appleForm(path, form) {
  return fetch("https://appleid.apple.com/auth/" + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
}

async function handleAuth(request, env, action) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad JSON." }, 400); }
  const startCode = CODE_RE.test(String(b.code || "").toUpperCase()) ? String(b.code).toUpperCase() : randomCode();

  if (action === "signup" || action === "login") {
    const email = String(b.email || "").trim().toLowerCase(), password = String(b.password || "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (password.length < 8) return json({ error: "Passwords need at least 8 characters." }, 400);
    const acctKey = "acct:email:" + email;
    const acct = await env.SYNC.get(acctKey, "json");
    if (action === "signup") {
      if (acct) return json({ error: "There's already an account with that email. Sign in instead." }, 409);
      const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
      const made = { kind: "email", email, salt, hash: await hashPassword(password, salt), code: startCode, created: Date.now() };
      await env.SYNC.put(acctKey, JSON.stringify(made));
      return json(await startSession(env, acctKey, made));
    }
    if (!acct || !sameString(await hashPassword(password, acct.salt), acct.hash)) return json({ error: "Wrong email or password." }, 401);
    return json(await startSession(env, acctKey, acct));
  }

  if (action === "apple") {
    let claims; try { claims = await verifyAppleToken(b.idToken, env); } catch (e) { return json({ error: "Apple sign-in couldn't be verified. Try again." }, 401); }
    const acctKey = "acct:apple:" + claims.sub;
    let acct = await env.SYNC.get(acctKey, "json");
    if (!acct) acct = { kind: "apple", email: claims.email || "", code: startCode, clientId: claims.aud, created: Date.now() };
    if (b.authorizationCode && appleRevokeReady(env)) {   // keep a refresh token so the account can be revoked on delete
      try {
        const r = await appleForm("token", { client_id: claims.aud, client_secret: await appleClientSecret(env, claims.aud), code: b.authorizationCode, grant_type: "authorization_code" });
        const t = await r.json();
        if (t.refresh_token) { acct.refreshToken = t.refresh_token; acct.clientId = claims.aud; }
      } catch (e) {}
    }
    await env.SYNC.put(acctKey, JSON.stringify(acct));
    return json(await startSession(env, acctKey, acct));
  }

  if (action === "delete") {
    const acctKey = await env.SYNC.get("session:" + String(b.token || ""));
    if (!acctKey) return json({ error: "Please sign in again first." }, 401);
    const acct = await env.SYNC.get(acctKey, "json");
    if (acct) {
      if (acct.kind === "apple" && acct.refreshToken && appleRevokeReady(env)) {
        try { await appleForm("revoke", { client_id: acct.clientId, client_secret: await appleClientSecret(env, acct.clientId), token: acct.refreshToken, token_type_hint: "refresh_token" }); } catch (e) {}
      }
      await env.SYNC.delete("sync:" + acct.code);
      await env.SYNC.delete(acctKey);
    }
    await env.SYNC.delete("session:" + b.token);
    return json({ deleted: true });
  }

  if (action === "logout") { if (b.token) await env.SYNC.delete("session:" + b.token); return json({ ok: true }); }
  return json({ error: "Not found." }, 404);
}

/* ---------- entry point ---------- */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (path === "/parse") return handleParse(request, env);
    if (path.startsWith("/auth/")) return handleAuth(request, env, path.slice(6));

    const code = (new URL(request.url).searchParams.get("code") || "").toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return json({ error: "Invalid sync code." }, 400);

    const key = "sync:" + code;
    const existing = (await env.SYNC.get(key, "json")) || emptyBundle();

    if (request.method === "GET") return json(existing);

    if (request.method === "POST") {
      const raw = await request.text();
      if (raw.length > 5000000) return json({ error: "Too much data." }, 413);
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