function scoreCase(c, got) {
  const T = s => (s || "").toLowerCase();
  const res = { name: c.name, miss: [], bad: [], extra: 0 };
  const used = new Set();
  for (const [d, kw] of c.expect) {
    const i = got.findIndex((a, j) => !used.has(j) && a.date === d && T(a.title + " " + a.desc).includes(kw));
    if (i < 0) res.miss.push(d + " " + kw); else used.add(i);
  }
  got.forEach((a, j) => {
    if (used.has(j)) return;
    if ((c.never || []).some(w => T(a.title).includes(w)) || (c.neverDates || []).includes(a.date)) res.bad.push(a.date + " " + a.title);
    else res.extra++;
  });
  if (c.twoClasses && new Set(got.map(a => a.class)).size < 2) res.bad.push("all items got one class: " + (got[0] || {}).class);
  if (c.classHas && got.length && !T(got[0].class).includes(c.classHas)) res.bad.push("class name: " + got[0].class);
  res.pass = !res.miss.length && !res.bad.length;
  return res;
}
async function runAll(url) {
  const out = [];
  for (const c of CASES) {
    let got = [], err = null;
    try { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ syllabusText: c.text }) });
      const j = await r.json(); if (j.error) err = j.error; got = j.assignments || []; } catch (e) { err = String(e); }
    const s = scoreCase(c, got); if (err) { s.pass = false; s.err = err; }
    s.got = got.map(a => a.date + " | " + a.class + " | " + a.title + " | " + a.time);
    out.push(s);
  }
  return out;
}
if (typeof module !== "undefined") module.exports = { scoreCase };
