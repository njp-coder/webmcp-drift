/**
 * Shared helpers for the nightly run and the page renderer.
 *
 * The one design decision worth stating: a site's snapshot lives in its own
 * file under `snapshots/`. Git then stores a new blob only for the sites that
 * actually changed, so a year of nightly commits costs roughly what the drift
 * costs — not 3.6 MB a day.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SNAPSHOTS = join(ROOT, "snapshots");
export const REPORTS = join(ROOT, "reports");
export const DOCS = join(ROOT, "docs");
export const HISTORY = join(ROOT, "history.json");
export const LATEST = join(REPORTS, "latest.json");

export const DIRECTORY_URL = "https://webmcp.com/api/directory.json";

/** Filesystem-safe name for a host. Hosts are already restricted, but be defensive. */
export function hostFile(host) {
  return `${host.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
}

export async function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * The directory and the WebMCP JS API disagree on annotation names, the same
 * way CDP and page script do. Normalize to sponsio's `ToolAnnotations` so the
 * diff engine sees one vocabulary.
 */
function normalizeAnnotations(tool) {
  const a = tool.annotations ?? {};
  const out = {};
  const readOnly = a.readOnly ?? a.readOnlyHint;
  const consequential = a.consequential ?? a.consequentialHint;
  const untrusted = a.untrustedContent ?? a.untrustedContentHint;
  const autosubmit = a.autosubmit ?? a.autosubmitHint;
  if (typeof readOnly === "boolean") out.readOnly = readOnly;
  if (typeof consequential === "boolean") out.consequential = consequential;
  if (typeof untrusted === "boolean") out.untrustedContent = untrusted;
  if (typeof autosubmit === "boolean") out.autosubmit = autosubmit;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Convert one directory entry into a sponsio Snapshot.
 *
 * `impl` is what sponsio calls `kind` (imperative vs declarative). The
 * directory's own `kind` field is a semantic label ("answer", "action") and is
 * deliberately not carried over — it is not part of the contract an agent
 * depends on.
 */
export function toSnapshot(site, capturedAt) {
  const tools = (site.tools ?? []).map((t) => {
    const record = {
      name: t.name,
      description: t.description ?? "",
      kind: t.impl === "declarative" ? "declarative" : "imperative",
    };
    if (t.inputSchema) record.inputSchema = t.inputSchema;
    const annotations = normalizeAnnotations(t);
    if (annotations) record.annotations = annotations;
    return record;
  });

  tools.sort((a, b) => a.name.localeCompare(b.name));

  return {
    sponsio: 1,
    url: site.url,
    capturedAt,
    tools,
    // The directory's own `host` is the identity key and is stored verbatim.
    // It is NOT always the URL's netloc — the directory strips `www.` from
    // `host` but keeps it in `url`, which is true of ~114 of the 553 sites.
    // Re-deriving the host from the URL silently loses those.
    host: site.host,
    // Provenance: this snapshot came from the public directory's crawl, not
    // from our own browser. Layer 2 will add first-party captures alongside.
    source: "webmcp.com/api/directory.json",
  };
}

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
