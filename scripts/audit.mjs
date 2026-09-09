/**
 * Layer 2 — a point-in-time audit of what sites declare, from a real browser.
 *
 * Layer 1 diffs the public directory against itself and needs two nights before
 * it can say anything. This says something on the first run, because it asks a
 * different question: not "did the contract change" but "is the contract safe to
 * hand an agent as written".
 *
 * Two hard rules, both deliberate:
 *
 * 1. READ ONLY. This loads a page and reads the tools it registers. It never
 *    invokes one. sponsio can call tools — `smokeTest`, `probeConformance`,
 *    `probeRateLimits`, `auditResponses` all do — and every one of them is
 *    excluded here. Calling `proceed_to_checkout` or `update_cart` across other
 *    people's production storefronts would create real carts and real orders.
 *    Those probes are for a site's own CI, against its own staging.
 *
 * 2. First-party capture, not the directory. The directory drops `annotations`
 *    entirely — 0 of 3,648 tools carry them — so `readOnly` and `consequential`
 *    are invisible in Layer 1 data. Auditing safety from it would flag every
 *    tool on the web for a declaration the crawler threw away. A real browser
 *    sees what the site actually declares.
 */

import { capture, auditSafety, auditReversibility, auditSurface } from "sponsio";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { REPORTS, ROOT, hostFile, readJson, todayUTC, writeJson } from "./lib.mjs";

const AUDITS = join(ROOT, "audits");
const PER_NIGHT = Number(process.env.AUDIT_PER_NIGHT ?? 40);
const SETTLE_MS = Number(process.env.AUDIT_SETTLE_MS ?? 700);
const TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS ?? 15000);
const PAUSE_MS = Number(process.env.AUDIT_PAUSE_MS ?? 400);
const date = process.env.DRIFT_DATE || todayUTC();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Deterministic rotation: the slice is chosen by day number, so every site is
 * visited on a fixed cadence and the schedule is reproducible from the date
 * alone. With 553 sites at 40 a night the whole directory is covered in 14 days.
 */
function sliceForToday(sites, perNight, isoDate) {
  const day = Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86400000);
  const slices = Math.max(1, Math.ceil(sites.length / perNight));
  const index = ((day % slices) + slices) % slices;
  return { slice: sites.slice(index * perNight, index * perNight + perNight), index, slices };
}

// The site list comes from the committed baselines, so Layer 2 audits exactly
// what Layer 1 is tracking rather than re-fetching a possibly-different crawl.
const { readdir } = await import("node:fs/promises");
const files = (await readdir(join(ROOT, "snapshots")).catch(() => [])).filter((f) =>
  f.endsWith(".json"),
);
const sites = [];
for (const file of files.sort()) {
  const snap = await readJson(join(ROOT, "snapshots", file));
  if (snap?.url) sites.push({ host: snap.host ?? file.replace(/\.json$/, ""), url: snap.url });
}

if (!sites.length) {
  console.error("no committed snapshots — run `npm run run` first");
  process.exit(1);
}

// 0 means every committed site — the weekly default. A positive number takes a
// deterministic rotating slice instead, which is what local runs use.
const { slice, index, slices } =
  PER_NIGHT > 0
    ? sliceForToday(sites, PER_NIGHT, date)
    : { slice: sites, index: 0, slices: 1 };

console.log(
  slices === 1
    ? `${date}  full sweep — auditing all ${sites.length} sites`
    : `${date}  slice ${index + 1}/${slices} — auditing ${slice.length} of ${sites.length} sites`,
);

await mkdir(AUDITS, { recursive: true });

const results = [];
const totals = { audited: 0, failed: 0, breaking: 0, warning: 0, safe: 0, withAnnotations: 0, tools: 0 };

for (const site of slice) {
  let snapshot;
  try {
    snapshot = await capture({
      url: site.url,
      settleMs: SETTLE_MS,
      timeoutMs: TIMEOUT_MS,
      headless: true,
    });
  } catch (err) {
    totals.failed += 1;
    results.push({ host: site.host, url: site.url, error: String(err?.message ?? err) });
    console.log(`  ✗ ${site.host}: ${String(err?.message ?? err).slice(0, 90)}`);
    await sleep(PAUSE_MS);
    continue;
  }

  const findings = [
    ...auditSafety(snapshot).findings,
    ...auditReversibility(snapshot).findings,
    ...auditSurface(snapshot).findings,
  ];

  const counts = { breaking: 0, warning: 0, safe: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

  const annotated = snapshot.tools.filter((t) => t.annotations && Object.keys(t.annotations).length);

  totals.audited += 1;
  totals.tools += snapshot.tools.length;
  totals.breaking += counts.breaking;
  totals.warning += counts.warning;
  totals.safe += counts.safe;
  if (annotated.length) totals.withAnnotations += 1;

  const record = {
    host: site.host,
    url: site.url,
    auditedAt: new Date().toISOString(),
    apiAvailable: snapshot.apiAvailable ?? null,
    toolCount: snapshot.tools.length,
    annotatedToolCount: annotated.length,
    counts,
    findings,
  };
  results.push(record);
  await writeJson(join(AUDITS, hostFile(site.host)), record);

  console.log(
    `  ${counts.breaking ? "!" : "·"} ${site.host}  ${snapshot.tools.length} tools  ` +
      `${counts.breaking}B ${counts.warning}W`,
  );
  await sleep(PAUSE_MS);
}

results.sort((a, b) => (b.counts?.breaking ?? 0) - (a.counts?.breaking ?? 0));

const report = { date, slice: index + 1, slices, totals, results };
await writeJson(join(REPORTS, `audit-${date}.json`), report);
await writeJson(join(REPORTS, "audit-latest.json"), report);

/**
 * The only thing that leaves this machine.
 *
 * Per-site results name third parties and carry heuristic findings with a known
 * error rate, so they are gitignored. What is publishable is the shape of the
 * ecosystem with every hostname removed: counts, rates, and how often a finding
 * code occurs. Nobody is identifiable in this file and nothing in it accuses
 * anyone.
 */
const codes = {};
for (const r of results) {
  for (const f of r.findings ?? []) {
    codes[f.code] ??= { severity: f.severity, sites: 0, occurrences: 0 };
    codes[f.code].occurrences += 1;
  }
  for (const code of new Set((r.findings ?? []).map((f) => f.code))) codes[code].sites += 1;
}

const annotatedTools = results.reduce((n, r) => n + (r.annotatedToolCount ?? 0), 0);

await writeJson(join(REPORTS, "aggregate.json"), {
  date,
  method: "first-party capture in Chrome, read-only — no tool was invoked",
  sitesAudited: totals.audited,
  sitesUnreachable: totals.failed,
  toolsSeen: totals.tools,
  toolsDeclaringAnnotations: annotatedTools,
  sitesDeclaringAnyAnnotation: totals.withAnnotations,
  findingCodes: codes,
  caveat:
    "Findings are heuristic and counted, not verified one by one. Percentages describe " +
    "the sample audited on this date, not the whole directory.",
});

console.log(
  `\n${totals.audited} audited · ${totals.failed} unreachable · ` +
    `${totals.breaking} breaking · ${totals.warning} warning · ` +
    `${totals.withAnnotations}/${totals.audited} sites declare any annotation`,
);
