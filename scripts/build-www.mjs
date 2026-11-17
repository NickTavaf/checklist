// Builds the app's copy of the website into www/ (what the iPhone app loads).
// The website itself (index.html at the repo root) is left untouched; this script
// only makes an offline-ready copy for the app:
//   - Google Fonts are swapped for copies bundled in app/fonts
//   - pdf.js is loaded from the app instead of a CDN
//   - app/native.js is added (reminders, haptics, status bar), and the
//     website's service worker is skipped (the app already works offline)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "www");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let html = readFileSync(join(root, "index.html"), "utf8");
const swaps = [];
function swap(label, from, to) {
  if (!html.includes(from)) throw new Error(`build-www: couldn't find ${label} in index.html — has it changed?`);
  html = html.split(from).join(to);
  swaps.push(label);
}

// 1. Fonts: inline the bundled @font-face rules in place of the Google Fonts @import
const fontsCss = readFileSync(join(root, "app/fonts/fonts.css"), "utf8");
const fontImport = html.match(/@import url\("https:\/\/fonts\.googleapis\.com\/css2[^"]*"\);/);
if (!fontImport) throw new Error("build-www: Google Fonts @import not found");
swap("Google Fonts", fontImport[0], fontsCss);
html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.g[^>]*>\n?/g, "");
cpSync(join(root, "app/fonts"), join(out, "fonts"), { recursive: true, filter: (p) => !p.endsWith(".css") });

// 2. pdf.js from the app bundle
const pdfDir = join(root, "node_modules/pdfjs-dist/build");
mkdirSync(join(out, "vendor"), { recursive: true });
cpSync(join(pdfDir, "pdf.min.js"), join(out, "vendor/pdf.min.js"));
cpSync(join(pdfDir, "pdf.worker.min.js"), join(out, "vendor/pdf.worker.min.js"));
swap("pdf.js", "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "vendor/pdf.min.js");
swap("pdf.js worker", "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js", "vendor/pdf.worker.min.js");

// 3. No service worker / web manifest inside the app
swap("service worker", 'navigator.serviceWorker.register("./service-worker.js")', "Promise.resolve()");
html = html.replace(/<link rel="manifest"[^>]*>\n?/, "");

// 4. Let the page draw under the notch (it already pads with safe-area insets)
swap("viewport", '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">');

// 5. Each install gets its own private sync code, so a new download starts with an empty
//    checklist instead of the website's shared one. The website's built-in assignments only
//    show when the phone is switched to the website's own sync code (☰ menu → Sync code).
const keyMatch = html.match(/const SYNC_KEY = "([A-Z0-9]{4}-[A-Z0-9]{4})";/);
if (!keyMatch) throw new Error("build-www: SYNC_KEY not found in index.html");
swap("per-install sync code", "const assignments = [", `// --- app only: this phone's own sync code (made up on first launch) ---
const BUILTIN_SYNC_CODE = ${JSON.stringify(keyMatch[1])};
const APP_SYNC_CODE = (() => {
  const ok = c => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c || "");
  const make = () => {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = new Uint32Array(8);
    crypto.getRandomValues(r);
    const s = Array.from(r, x => A[x % A.length]).join("");
    return s.slice(0, 4) + "-" + s.slice(4);
  };
  try {
    let c = localStorage.getItem("appSyncCode");
    if (!ok(c)) { c = make(); localStorage.setItem("appSyncCode", c); }
    return c;
  } catch (e) { return make(); }
})();
const APP_HAS_BUILTIN = APP_SYNC_CODE === BUILTIN_SYNC_CODE;
const assignments = [`);
swap("built-in assignments", "const defaultAssignments = assignments;", "const defaultAssignments = APP_HAS_BUILTIN ? assignments : [];");
swap("sync key", keyMatch[0], "const SYNC_KEY = APP_SYNC_CODE;");

// 6. Native extras, after the page's own script
swap("native.js", "</body>", '<script src="native.js"></script>\n</body>');
cpSync(join(root, "app/native.js"), join(out, "native.js"));

writeFileSync(join(out, "index.html"), html);
for (const dir of ["textures"]) if (existsSync(join(root, dir))) cpSync(join(root, dir), join(out, dir), { recursive: true });

console.log("www/ built:", swaps.join(", "));
