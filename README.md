# webmcp-drift

**A daily record of every WebMCP tool contract on the public web, and what changed overnight.**

When a website's UI breaks, users complain. When the tools it exposes to AI agents break,
nothing happens — no error page, no support ticket, no analytics dip. The thing that broke
was an agent, and agents don't file tickets.

This repo snapshots every site in the public [WebMCP directory](https://webmcp.com) once a
night, commits the result, and diffs it against the previous night with
[sponsio](https://github.com/njp-coder/sponsio) — the same engine a single site runs in CI
against itself, pointed at the whole public web at once.

**Live page: https://njp-coder.github.io/webmcp-drift/**

## Why the history is the point

Any tool can tell you what a site exposes today. Almost none of that is interesting: on a
normal night, nothing changes. The value is entirely in having watched every previous night,
so that when something *does* move — a required field appears, an enum value disappears, a
description is rewritten — there is a baseline to prove it moved, and a date to prove when.

That record cannot be reconstructed later. It only exists if someone was running this the
night before.

## What it tracks

| | |
|---|---|
| Sites | 553 (as of the first run, 2026-09-09) |
| Tools | 3,648 |
| Source | `https://webmcp.com/api/directory.json`, regenerated daily around 05:40 UTC |
| Diff engine | `sponsio@^0.5.3` — `diffSnapshots()` |
| Schedule | 06:10 UTC nightly, plus manual `workflow_dispatch` |

Each site is stored as its own file under `snapshots/`, in sponsio's snapshot format.
That is deliberate: git stores a new blob only for the sites that actually changed, so a
year of nightly commits costs roughly what the drift costs rather than 3.6 MB a day.

## Layout

```
snapshots/<host>.json   one sponsio snapshot per site — the committed baseline
reports/<date>.json     what changed that night
reports/latest.json     the most recent report, used to render the page
history.json            one row per night: sites, tools, changed, new, breaking, warning
docs/index.html         the public page, regenerated each run
scripts/run.mjs         fetch, normalize, diff, write
scripts/render.mjs      render the page from latest.json + history.json
```

## Running it locally

```bash
npm install
npm run nightly
```

`DRIFT_DATE=2026-09-09 npm run run` overrides the date if you need to backfill a row.

## Known limitations

These are stated plainly because the page should not imply coverage it doesn't have.

- **No safety annotations.** 0 of 3,648 tools in the directory carry `annotations` of any
  kind, so `readOnly`, `consequential` and `untrustedContent` are invisible here. Losing one
  of those is a breaking change in sponsio's severity model — it changes an action's blast
  radius without changing its schema — but that check cannot fire on this data. It needs a
  first-party browser capture.
- **Someone else's crawl.** Layer 1 trusts the directory's crawler for both coverage and
  accuracy. A site the directory misses is a site this repo cannot see.
- **Absence is not delisting.** A site missing for one night is usually a crawl hiccup. It is
  recorded as delisted in that night's report, but its committed baseline is never deleted —
  losing history to someone else's timeout would be the one unrecoverable bug here.
- **Directory `host` is the identity key**, not the URL's netloc. The directory strips `www.`
  from `host` while keeping it in `url`, which is true of 114 of the 553 sites. Deriving
  identity from the URL silently loses those.

## Layer 2

The planned addition is a first-party capture: sponsio driving real Chrome across a rotating
slice of the directory, which adds what the JSON cannot carry — annotations, response
contracts, rate-limit behaviour, reversibility, and schema conformance probing.

## Licence

MIT. The snapshots are derived from a public directory of public websites.
