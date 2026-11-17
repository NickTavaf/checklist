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

// 5. Native extras, after the page's own script
swap("native.js", "</body>", '<script src="native.js"></script>\n</body>');
cpSync(join(root, "app/native.js"), join(out, "native.js"));

writeFileSync(join(out, "index.html"), html);
for (const dir of ["textures"]) if (existsSync(join(root, dir))) cpSync(join(root, dir), join(out, dir), { recursive: true });

console.log("www/ built:", swaps.join(", "));
