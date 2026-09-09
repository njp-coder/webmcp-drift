/**
 * Render the public page from the latest report plus the running history.
 *
 * No build step and no dependencies: the Action commits the HTML and Pages
 * serves it. Anything that needs a toolchain is a thing that can break at 3am
 * with nobody watching.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DOCS, HISTORY, LATEST, ROOT, esc, readJson } from "./lib.mjs";

const report = await readJson(LATEST);
if (!report) {
  console.error("no reports/latest.json — run `npm run run` first");
  process.exit(1);
}
const history = (await readJson(HISTORY, [])) ?? [];
// Only ever the aggregate. The per-site audit results are gitignored: they name
// third parties and carry heuristic findings, so they are product evidence
// rather than something to publish.
const audit = await readJson(join(ROOT, "reports", "aggregate.json"));

/**
 * The aggregate is published only once it actually describes the directory.
 *
 * A partial sweep is not a small version of the finding, it is a different
 * claim: "4 of 553 sites" invites the reader to generalise from a sample that
 * cannot carry it. Until a sweep has covered nearly everything tracked, the
 * section is absent rather than qualified — the same reason the drift counts
 * read "none yet" instead of a confident zero.
 */
const auditCoverage =
  audit && report.totals.sites
    ? (audit.sitesAudited + (audit.sitesUnreachable ?? 0)) / report.totals.sites
    : 0;
const auditIsRepresentative = auditCoverage >= 0.9;

const sev = (s) => `<span class="sev ${s}">${s}</span>`;

/**
 * On the first night every site is `new`, so it has no baseline to be compared
 * against and produces no findings by construction. Reporting that as "0
 * breaking" would read as "checked and found healthy" when nothing was checked
 * at all. Drift is only measurable from the second run.
 */
const firstNight = report.totals.new === report.totals.sites && report.totals.sites > 0;

// One or two points is not a trend. Sparklines stay hidden until they mean something.
const showSparks = history.length >= 3;

/**
 * The headline numbers are the ones that grow.
 *
 * "0 breaking today" is the expected result on almost every night, and a page
 * whose top row is permanently zero teaches a visitor that nothing is
 * happening here. What is actually accruing is the length of the record and
 * the total it has caught, so those lead instead. Today's counts are still on
 * the page — in the section that lists them, where a zero means something.
 */
const nights = history.length;
const totalChanges = history.reduce((n, h) => n + (h.changed ?? 0), 0);
const lastChangeRow = [...history].reverse().find((h) => (h.changed ?? 0) > 0);
const lastChange = lastChangeRow?.date ?? null;

const sparkline = (rows, key, label) => {
  if (!showSparks) return "";
  const values = rows.map((r) => r[key] ?? 0);
  const max = Math.max(...values, 1);
  const bars = rows
    .map((r) => {
      const v = r[key] ?? 0;
      const h = Math.max(2, Math.round((v / max) * 34));
      return `<div class="bar" style="height:${h}px" title="${esc(r.date)} · ${v} ${esc(label)}"></div>`;
    })
    .join("");
  return `<div class="spark">${bars}</div>`;
};

const changeRows = report.changes
  .slice(0, 60)
  .map((c) => {
    const findings = c.findings
      .slice(0, 8)
      .map(
        (f) =>
          `<li>${sev(f.severity)} <code>${esc(f.tool)}</code>${
            f.path ? ` <span class="path">${esc(f.path)}</span>` : ""
          } ${esc(f.message)}</li>`,
      )
      .join("");
    const more =
      c.findings.length > 8 ? `<li class="more">+${c.findings.length - 8} more</li>` : "";
    return `<details class="site"${(c.counts.breaking ?? 0) > 0 ? " open" : ""}>
  <summary>
    <a href="${esc(c.url)}" rel="noopener nofollow">${esc(c.host)}</a>
    <span class="counts">
      ${(c.counts.breaking ?? 0) > 0 ? `<b class="breaking">${c.counts.breaking} breaking</b>` : ""}
      ${(c.counts.warning ?? 0) > 0 ? `<b class="warning">${c.counts.warning} warning</b>` : ""}
      ${(c.counts.safe ?? 0) > 0 ? `<b class="safe">${c.counts.safe} safe</b>` : ""}
    </span>
  </summary>
  <ul>${findings}${more}</ul>
</details>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WebMCP Drift — what changed in the agent contracts of the public web</title>
<meta name="description" content="A daily record of every WebMCP tool contract on the public web, and what changed overnight.">
<style>
  :root {
    --bg: #f7f8fa; --panel: #ffffff; --ink: #16202e; --muted: #5c6b7f;
    --line: #dfe4ea; --brand: #1b3557;
    --breaking: #b3261e; --warning: #9a6700; --safe: #1a7f52;
  }
  :root:not([data-theme="light"]) { }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0f141b; --panel: #161d27; --ink: #e6ecf3; --muted: #93a1b3;
      --line: #26303d; --brand: #8fb4e8;
      --breaking: #ff8a80; --warning: #e5b567; --safe: #6cd39a;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0f141b; --panel: #161d27; --ink: #e6ecf3; --muted: #93a1b3;
    --line: #26303d; --brand: #8fb4e8;
    --breaking: #ff8a80; --warning: #e5b567; --safe: #6cd39a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 940px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .lede { color: var(--muted); margin: 0 0 28px; max-width: 62ch; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .card .n { font-size: 25px; font-weight: 650; letter-spacing: -0.02em; }
  .card .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; margin-top: 2px; }
  .spark { display: flex; align-items: flex-end; gap: 2px; height: 36px; margin-top: 10px; }
  .bar { flex: 1; min-width: 2px; background: var(--brand); opacity: .75; border-radius: 1px; }
  h2 { font-size: 17px; margin: 32px 0 12px; }
  .site { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; }
  .site summary { cursor: pointer; display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; justify-content: space-between; }
  .site summary a { color: var(--ink); text-decoration: none; font-weight: 600; }
  .site summary a:hover { text-decoration: underline; }
  .counts b { font-weight: 600; font-size: 12px; margin-left: 8px; }
  .counts .breaking { color: var(--breaking); }
  .counts .warning { color: var(--warning); }
  .counts .safe { color: var(--safe); }
  .site ul { margin: 10px 0 4px; padding-left: 18px; }
  .site li { margin: 5px 0; color: var(--muted); }
  .site code { color: var(--ink); font-size: 13px; }
  .path { color: var(--brand); font-family: ui-monospace, monospace; font-size: 12px; }
  .sev { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
  .sev.breaking { color: var(--breaking); }
  .sev.warning { color: var(--warning); }
  .sev.safe { color: var(--safe); }
  .more { font-style: italic; }
  .quiet { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 22px; color: var(--muted); }
  footer { margin-top: 42px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
  a { color: var(--brand); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .scroll { overflow-x: auto; }
  th, td { text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--muted); font-weight: 600; }
</style>
</head>
<body>
<div class="wrap">
  <h1>WebMCP Drift</h1>
  <p class="lede">
    Every site in the public WebMCP directory, snapshotted nightly and diffed against
    yesterday. When a tool contract changes there is no error page and no support
    ticket, because the thing that broke was an agent. This is the record of it changing.
  </p>

  <div class="grid">
    <div class="card"><div class="n">${report.totals.sites}</div><div class="k">sites tracked</div>${sparkline(history, "sites", "sites")}</div>
    <div class="card"><div class="n">${report.totals.tools}</div><div class="k">tools</div>${sparkline(history, "tools", "tools")}</div>
    <div class="card"><div class="n">${nights}</div><div class="k">${nights === 1 ? "night watched" : "nights watched"}</div>${sparkline(history, "sites", "sites")}</div>
    <div class="card"><div class="n">${totalChanges}</div><div class="k">changes recorded</div>${sparkline(history, "changed", "changed")}</div>
    <div class="card"><div class="n" style="font-size:${lastChange ? "25px" : "17px"}">${lastChange ?? "none yet"}</div><div class="k">last change seen</div></div>
  </div>

  <h2>${firstNight ? `Baseline recorded ${esc(report.date)}` : `What changed on ${esc(report.date)}`}</h2>
  ${
    firstNight
      ? `<div class="quiet"><strong>This is the first night.</strong> ${report.totals.sites} sites and
         ${report.totals.tools} tools were recorded as the starting baseline. Nothing was compared,
         because there is nothing yet to compare against — a site with no prior snapshot produces no
         findings by construction. Drift becomes measurable from the next run, and every number on
         this page after that is one this record had to be running the night before to produce.</div>`
      : report.changes.length
        ? `<div>${changeRows}</div>`
        : `<div class="quiet">No contract changes across ${report.totals.sites} sites. That is the normal result, and it is why the interesting number is the one you only get by having watched every previous night.</div>`
  }

  ${
    report.delisted.length
      ? `<h2>No longer listed</h2><div class="quiet">${report.delisted.map(esc).join(", ")}</div>`
      : ""
  }

  ${
    auditIsRepresentative
      ? `<h2>What sites declare</h2>
  <div class="quiet">
    <p style="margin-top:0">A weekly read-only pass in a real browser over the sites this repo tracks —
    loading each page and recording the tools it registers, never calling one. Aggregate only:
    no site is named here, and none of these counts is an accusation about anyone.</p>
    <p><strong>${audit.sitesAudited}</strong> of ${report.totals.sites} sites read ·
       <strong>${audit.toolsSeen}</strong> tools ·
       <strong>${audit.toolsDeclaringAnnotations}</strong> tools declare a safety annotation
       (<strong>${audit.sitesDeclaringAnyAnnotation}</strong> sites) — the public directory records
       <strong>none</strong> of them.</p>
    <p style="margin-bottom:0"><em>${esc(audit.caveat)}</em></p>
  </div>`
      : ""
  }

  <h2>History</h2>
  <div class="scroll"><table>
    <thead><tr><th>Date</th><th>Sites</th><th>Tools</th><th>Changed</th><th>New</th><th>Breaking</th><th>Warning</th></tr></thead>
    <tbody>
      ${history
        .slice(-30)
        .reverse()
        .map(
          (h) =>
            `<tr><td>${esc(h.date)}</td><td>${h.sites}</td><td>${h.tools}</td><td>${h.changed}</td><td>${h.new}</td><td>${h.breaking}</td><td>${h.warning}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table></div>

  <footer>
    Snapshots come from the public <a href="${esc(report.directory)}" rel="noopener">WebMCP directory</a>,
    diffed with <a href="https://github.com/njp-coder/sponsio">sponsio</a>&nbsp;— the same engine sites run in CI
    against themselves. Directory generated ${esc(report.generatedAt)}.
    <a href="https://github.com/njp-coder/webmcp-drift">Source and raw snapshots</a>.
  </footer>
</div>
</body>
</html>
`;

await mkdir(DOCS, { recursive: true });
await writeFile(join(DOCS, "index.html"), html);
await writeFile(join(DOCS, ".nojekyll"), "");
console.log(`wrote docs/index.html — ${report.changes.length} changed, ${report.totals.sites} sites`);
