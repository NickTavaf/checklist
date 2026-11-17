/* Native extras for the iPhone app. Loaded after the page's own script, only inside the app
   (scripts/build-www.mjs adds it to the app's copy of the page; the website never loads it).

   - Reminders: a notification the evening before and the morning of each assignment that
     isn't finished yet, and one for each calendar event (at its time, or in the morning).
   - A light tap of haptic feedback when you mark things complete / turned in.
   - The status bar text turns light or dark to stay readable on the header colour.
   - Syncs again as soon as you come back to the app.

   It only reads the page's own data (assignments, their state and calendar events),
   so nothing here is specific to one person's classes. */
(function () {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  const P = Cap.Plugins || {};
  const { LocalNotifications, Haptics, StatusBar, SplashScreen, App } = P;

  const MORNING_HOUR = 8;      // "due today" reminder
  const EVENING_HOUR = 19;     // "due tomorrow" reminder, the day before
  const MAX_PENDING = 60;      // iOS keeps at most 64 scheduled notifications per app
  const REMINDERS_KEY = "nativeRemindersOn";

  /* ---------- reminders ---------- */
  function remindersOn() { try { return localStorage.getItem(REMINDERS_KEY) !== "0"; } catch (e) { return true; } }

  function numId(s) {   // notification ids must be whole numbers
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    return (x >>> 1) || 1;
  }
  function at(dateStr, h, m) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d)) return null;
    d.setHours(h, m || 0, 0, 0);
    return d;
  }
  function dayBefore(d) { const x = new Date(d); x.setDate(x.getDate() - 1); return x; }

  function buildReminders() {
    const out = [], now = Date.now() + 60 * 1000;
    let list = [];
    try { list = typeof getAllAssignments === "function" ? getAllAssignments() : []; } catch (e) {}
    for (const a of list) {
      if (!a || !a.id || !a.date) continue;
      try { if (typeof isFinished === "function" && isFinished(a)) continue; } catch (e) {}
      const when = a.time ? " (" + a.time + ")" : "";
      const morning = at(a.date, MORNING_HOUR);
      if (!morning) continue;
      const evening = dayBefore(at(a.date, EVENING_HOUR));
      out.push({ id: numId("due-eve:" + a.id), at: evening, title: "Due tomorrow" + when,
        body: a.title + (a.class ? " · " + a.class : ""), extra: { page: "" } });
      out.push({ id: numId("due-am:" + a.id), at: morning, title: "Due today" + when,
        body: a.title + (a.class ? " · " + a.class : ""), extra: { page: "" } });
    }
    let events = [];
    try { events = Array.isArray(myEvents) ? myEvents : []; } catch (e) {}
    for (const ev of events) {
      if (!ev || !ev.id || !ev.date) continue;
      let t = null;
      if (ev.time && /^\d{1,2}:\d{2}/.test(ev.time)) { const [h, m] = ev.time.split(":").map(Number); t = at(ev.date, h, m); }
      else t = at(ev.date, MORNING_HOUR);
      if (!t) continue;
      out.push({ id: numId("ev:" + ev.id), at: t, title: ev.title || "Event",
        body: ev.time ? "Starting now" : "Today", extra: { page: "schedule" } });
    }
    return out.filter(n => n.at && n.at.getTime() > now)
      .sort((a, b) => a.at - b.at)
      .slice(0, MAX_PENDING)
      .map(n => ({ id: n.id, title: n.title, body: n.body, schedule: { at: n.at, allowWhileIdle: true }, extra: n.extra }));
  }

  let scheduling = Promise.resolve(), timer = null;
  function rescheduleSoon() { clearTimeout(timer); timer = setTimeout(() => { scheduling = scheduling.then(reschedule, reschedule); }, 1500); }
  async function reschedule() {
    if (!LocalNotifications) return;
    try {
      const pending = await LocalNotifications.getPending();
      if (pending.notifications && pending.notifications.length)
        await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
      if (!remindersOn()) return;
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") return;
      const notifications = buildReminders();
      if (notifications.length) await LocalNotifications.schedule({ notifications });
    } catch (e) { console.warn("reminders:", e); }
  }
  // Ask for notification permission only once there's something to remind about
  // (not on the very first launch of an empty checklist).
  let askedForReminders = false;
  async function askForReminders() {
    if (!LocalNotifications || !remindersOn() || askedForReminders) return;
    if (!buildReminders().length) return;
    askedForReminders = true;
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display === "prompt" || perm.display === "prompt-with-rationale") await LocalNotifications.requestPermissions();
    } catch (e) {}
    rescheduleSoon();
  }
  if (LocalNotifications) {
    LocalNotifications.addListener("localNotificationActionPerformed", (e) => {
      const page = e && e.notification && e.notification.extra ? e.notification.extra.page : "";
      location.hash = page ? "#" + page : "";
    });
  }

  // A switch for reminders in the ☰ settings panel
  function addReminderSwitch() {
    const panel = document.getElementById("customizePanel");
    if (!panel || document.getElementById("nativeReminders")) return;
    const row = document.createElement("label");
    row.className = "native-reminders";
    row.style.cssText = "display:flex;align-items:center;gap:10px;margin:6px 0 8px;font-size:15px;cursor:pointer";
    row.innerHTML = '<input type="checkbox" id="nativeReminders" style="width:18px;height:18px;margin:0;accent-color:var(--poster-ui-accent,#2459F6)"> Due-date reminders';
    const sync = document.getElementById("syncStatus");
    if (sync && sync.parentNode === panel) panel.insertBefore(row, sync); else panel.appendChild(row);
    const box = row.querySelector("input");
    box.checked = remindersOn();
    box.addEventListener("change", async () => {
      try { localStorage.setItem(REMINDERS_KEY, box.checked ? "1" : "0"); } catch (e) {}
      if (box.checked) {
        const perm = await LocalNotifications.requestPermissions().catch(() => null);
        if (perm && perm.display === "denied") {
          alert("Notifications are turned off for this app. Turn them on in the Settings app → Notifications.");
        }
      }
      rescheduleSoon();
    });
  }

  /* ---------- this phone's sync code (made up on first launch by the app's copy of the page) ---------- */
  const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  function currentCode() { try { return typeof APP_SYNC_CODE === "string" ? APP_SYNC_CODE : ""; } catch (e) { return ""; } }
  function addSyncCodeRow() {
    const panel = document.getElementById("customizePanel");
    const code = currentCode();
    if (!panel || !code || document.getElementById("nativeSyncCode")) return;
    const box = document.createElement("div");
    box.id = "nativeSyncCode";
    box.style.cssText = "margin:4px 0 10px;font-size:14px;line-height:1.4";
    box.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<span>Sync code</span>' +
        '<b style="font-family:var(--poster-mono,monospace);letter-spacing:.06em" id="nativeSyncCodeValue"></b>' +
        '<button type="button" id="nativeSyncCodeChange" style="margin-left:auto;font:inherit;font-size:13px;padding:4px 10px;border:2px solid currentColor;background:none;color:inherit;cursor:pointer">Change</button>' +
      '</div>' +
      '<div style="font-size:12px;opacity:.7;margin-top:2px">Enter this code on your other devices to share one checklist.</div>';
    box.querySelector("#nativeSyncCodeValue").textContent = code;
    const reminders = panel.querySelector(".native-reminders");
    if (reminders) reminders.after(box);
    else { const sync = document.getElementById("syncStatus"); if (sync && sync.parentNode === panel) panel.insertBefore(box, sync); else panel.appendChild(box); }
    box.querySelector("#nativeSyncCodeChange").addEventListener("click", (e) => {
      e.stopPropagation();
      const typed = prompt("Enter the sync code from your other device (like ABCD-1234):", "");
      if (typed === null) return;
      const next = typed.trim().toUpperCase().replace(/\s+/g, "");
      if (!CODE_RE.test(next)) { alert("That doesn't look like a sync code. It's 8 letters or numbers with a dash in the middle, like ABCD-1234."); return; }
      if (next === code) return;
      if (!confirm("Switch this phone to " + next + "? The checklist on this phone will be replaced by the one saved under that code.")) return;
      try {
        localStorage.clear();   // start clean, so nothing from this phone leaks into the other checklist
        localStorage.setItem("appSyncCode", next);
      } catch (err) {}
      if (LocalNotifications) LocalNotifications.getPending().then(p => p.notifications.length && LocalNotifications.cancel({ notifications: p.notifications.map(n => ({ id: n.id })) })).catch(() => {});
      location.reload();
    });
  }

  /* ---------- a brand-new, empty checklist ---------- */
  function hasBuiltin() { try { return !!APP_HAS_BUILTIN; } catch (e) { return true; } }
  function personalizeHeader() {
    if (hasBuiltin()) return;   // the website's own semester: keep its title as is
    const h1 = document.querySelector(".topbar h1"), sub = document.querySelector(".topbar .sub");
    let n = 0;
    try { n = getAllClasses().length; } catch (e) {}
    if (h1 && h1.textContent !== "My Assignments") h1.textContent = "My Assignments";
    if (sub) {
      const text = n ? n + (n === 1 ? " class" : " classes") + " · every due date in one place" : "every due date in one place";
      if (sub.textContent !== text) sub.textContent = text;
    }
    document.title = "Checklist";
  }
  function welcomeIfEmpty() {
    let count = 0;
    try { count = getAllAssignments().length; } catch (e) { return; }
    const list = document.querySelector(".empty-state");
    if (count || !list || list.dataset.welcome) return;
    list.dataset.welcome = "1";
    list.innerHTML =
      '<div class="empty-state-icon">📚</div>' +
      '<div class="empty-state-title">Add your first class</div>' +
      '<div class="empty-state-text">Tap <b>+ Add Syllabus</b> and upload a PDF or a photo of a syllabus, or paste its text. Every assignment and due date is added for you.</div>' +
      '<button type="button" class="modal-btn primary" style="margin-top:18px" id="welcomeAddSyllabus">+ Add Syllabus</button>';
    list.querySelector("#welcomeAddSyllabus").addEventListener("click", () => {
      const btn = [...document.querySelectorAll("button")].find(b => /add syllabus/i.test(b.textContent) && b.id !== "welcomeAddSyllabus");
      if (btn) btn.click();
    });
  }

  /* ---------- haptics ---------- */
  document.addEventListener("click", (e) => {
    if (!Haptics) return;
    const btn = e.target.closest && e.target.closest(".action-btn[data-action]");
    if (btn) Haptics.impact({ style: "LIGHT" }).catch(() => {});
  }, true);

  /* ---------- status bar ---------- */
  function luminance(css) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css || "");
    if (!m) return null;
    return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255;
  }
  function updateStatusBar() {
    if (!StatusBar) return;
    // The status bar sits over the coloured header: match its text colour.
    const header = document.querySelector(".topbar, .site-nav, header");
    const ink = header ? getComputedStyle(header).color : getComputedStyle(document.body).color;
    const l = luminance(ink);
    if (l === null) return;
    StatusBar.setStyle({ style: l > 0.5 ? "DARK" : "LIGHT" }).catch(() => {});   // DARK = light text
  }

  /* ---------- hook into the page ---------- */
  if (typeof window.render === "function") {
    const pageRender = window.render;
    window.render = function () { const r = pageRender.apply(this, arguments); personalizeHeader(); welcomeIfEmpty(); rescheduleSoon(); updateStatusBar(); if (!askedForReminders) setTimeout(askForReminders, 800); return r; };
  }
  // calendar events are saved through saveEvents(); keep reminders in step
  if (typeof window.saveEvents === "function") {
    const pageSaveEvents = window.saveEvents;
    window.saveEvents = function () { const r = pageSaveEvents.apply(this, arguments); rescheduleSoon(); return r; };
  }
  window.addEventListener("hashchange", () => setTimeout(updateStatusBar, 50));
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => setTimeout(updateStatusBar, 50));
  new MutationObserver(() => updateStatusBar()).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme", "data-palette"] });

  if (App) {
    App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      try { if (typeof syncNow === "function") syncNow(); } catch (e) {}
      rescheduleSoon();
    });
  }

  /* ---------- say where a syllabus goes before it's sent (App Store rule 5.1.2) ---------- */
  function addAiNotice() {
    const parse = document.getElementById("parseUploadBtn");
    if (!parse || document.getElementById("aiNotice")) return;
    const note = document.createElement("p");
    note.id = "aiNotice";
    note.style.cssText = "margin:10px 0 0;font-size:12.5px;line-height:1.4;opacity:.75";
    note.textContent = "When you tap Parse Syllabus, the files or text you added are sent to our server and read by an AI model (Cloudflare Workers AI) to find the due dates. They aren't kept afterwards.";
    parse.closest(".modal-actions").after(note);
  }

  /* ---------- keep scrolled content from showing through the status bar ---------- */
  const strip = document.createElement("style");
  strip.textContent = "body::before{content:'';position:fixed;top:0;left:0;right:0;height:env(safe-area-inset-top);background:var(--poster-bg,#fff);z-index:2000;pointer-events:none}";
  document.head.appendChild(strip);

  console.log("native.js ready · speech recognition " + (window.SpeechRecognition || window.webkitSpeechRecognition ? "available" : "missing"));
  addReminderSwitch();
  addSyncCodeRow();
  addAiNotice();
  personalizeHeader();
  welcomeIfEmpty();
  updateStatusBar();
  if (SplashScreen) SplashScreen.hide().catch(() => {});
  setTimeout(askForReminders, 1200);
})();
