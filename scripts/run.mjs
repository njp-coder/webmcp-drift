/**
 * One night's work: fetch the public directory, compare every site against the
 * snapshot committed in this repo, and write down what moved.
 *
 * The diff is sponsio's own `diffSnapshots` — the same engine that runs in CI
 * for a single site, pointed at every site on the public web at once.
 */

import { diffSnapshots } from "sponsio";
import { join } from "node:path";
import {
  DIRECTORY_URL,
  HISTORY,
  LATEST,
  REPORTS,
  SNAPSHOTS,
  hostFile,
  readJson,
  toSnapshot,
  todayUTC,
  writeJson,
} from "./lib.mjs";

const date = process.env.DRIFT_DATE || todayUTC();

async function fetchDirectory() {
  const res = await fetch(DIRECTORY_URL, {
    headers: { "user-agent": "webmcp-drift (+https://github.com/njp-coder/webmcp-drift)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`directory returned HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body.sites)) throw new Error("directory payload has no sites array");
  return body;
}

/**
 * A site that vanishes for one night is usually a crawl hiccup, not a
 * delisting, so absence is recorded but never deletes the committed baseline.
 * Losing history to someone else's timeout would be the one unrecoverable bug
 * in this repo.
 */
function classify(before, after) {
  if (!before) return { status: "new", findings: [], counts: { breaking: 0, warning: 0, safe: 0 } };
  const result = diffSnapshots(before, after);
  return {
    status: result.clean ? "unchanged" : "changed",
    findings: result.findings,
    counts: result.counts,
  };
}

const directory = await fetchDirectory();
const capturedAt = directory.generatedAt ?? new Date().toISOString();

const seen = new Set();
const changes = [];
const totals = { sites: 0, tools: 0, changed: 0, new: 0, breaking: 0, warning: 0, safe: 0 };

for (const site of directory.sites) {
  if (!site?.host || !site?.url) continue;
  seen.add(site.host);
  totals.sites += 1;
  totals.tools += site.tools?.length ?? 0;

  const path = join(SNAPSHOTS, hostFile(site.host));
  const before = await readJson(path);
  const after = toSnapshot(site, capturedAt);
  const { status, findings, counts } = classify(before, after);

  if (status === "new") totals.new += 1;
  if (status === "changed") {
    totals.changed += 1;
    totals.breaking += counts.breaking ?? 0;
    totals.warning += counts.warning ?? 0;
    totals.safe += counts.safe ?? 0;
    changes.push({
      host: site.host,
      url: site.url,
      category: site.category ?? null,
      counts,
      findings,
    });
  }

  // The snapshot is rewritten every night whether or not it moved; git stores a
  // new blob only when the bytes differ, so unchanged sites cost nothing.
  await writeJson(path, after);
}

// Sites in our baseline that the directory no longer lists.
const delisted = [];
const { readdir } = await import("node:fs/promises");
for (const file of await readdir(SNAPSHOTS).catch(() => [])) {
  if (!file.endsWith(".json")) continue;
  const snapshot = await readJson(join(SNAPSHOTS, file));
  // Snapshots written before `host` was stored fall back to the filename,
  // which is the sanitized host — never the URL, for the reason in lib.mjs.
  const host = snapshot?.host ?? file.replace(/\.json$/, "");
  if (host && !seen.has(host)) delisted.push(host);
}

changes.sort(
  (a, b) =>
    (b.counts.breaking ?? 0) - (a.counts.breaking ?? 0) ||
    (b.counts.warning ?? 0) - (a.counts.warning ?? 0) ||
    a.host.localeCompare(b.host),
);

const report = {
  date,
  generatedAt: capturedAt,
  directory: DIRECTORY_URL,
  totals: { ...totals, delisted: delisted.length },
  delisted,
  changes,
};

await writeJson(LATEST, report);
await writeJson(join(REPORTS, `${date}.json`), report);

const history = (await readJson(HISTORY, [])) ?? [];
const row = {
  date,
  sites: totals.sites,
  tools: totals.tools,
  changed: totals.changed,
  new: totals.new,
  delisted: delisted.length,
  breaking: totals.breaking,
  warning: totals.warning,
};
const existing = history.findIndex((h) => h.date === date);
if (existing >= 0) history[existing] = row;
else history.push(row);
history.sort((a, b) => a.date.localeCompare(b.date));
await writeJson(HISTORY, history);

console.log(
  `${date}  ${totals.sites} sites · ${totals.tools} tools · ` +
    `${totals.changed} changed · ${totals.new} new · ${delisted.length} delisted · ` +
    `${totals.breaking} breaking · ${totals.warning} warning`,
);

for (const change of changes.slice(0, 20)) {
  console.log(`\n${change.host}`);
  for (const f of change.findings.slice(0, 6)) {
    console.log(`  ${f.severity.toUpperCase().padEnd(8)} ${f.tool}  ${f.message}`);
  }
}
