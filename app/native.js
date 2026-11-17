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
  async function askForReminders() {
    if (!LocalNotifications || !remindersOn()) return;
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
    window.render = function () { const r = pageRender.apply(this, arguments); rescheduleSoon(); updateStatusBar(); return r; };
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
  addAiNotice();
  updateStatusBar();
  if (SplashScreen) SplashScreen.hide().catch(() => {});
  setTimeout(askForReminders, 1200);
})();
