---
name: ship-cm64-site
description: Build and deploy a website/app on CM64 (JSON-driven pages, components, databases) and return the live URL.
---

# Ship a CM64 site

The mechanics for taking a brief to a live CM64 URL.

## Steps
1. **Scope** — one-line restatement + deliverable list. Pick a project slug.
2. **Structure** — a CM64 project is JSON files by SINGULAR class:
   - `setting/layout.json` — shell with `"@@PageComponents@@"` placeholder
   - `setting/theme.json`, `setting/fonts.json`
   - `page/index.json` — the page, referencing components as `"./ComponentName"`
   - `component/<Name>.jsx` — custom components (style/className go inside `attributes`)
   - `database/<name>.json` — data, with an `"id"` field matching the key
3. **Build** via the cm64 tooling (run through the `shell` tool). Pull before edits;
   never push stale.
4. **Deploy** — CM64 deploys on save; the URL is `https://<slug>.cm64.site`.
5. **Verify** — open the URL (via `movicom` on the phone, or `curl` via shell) and
   confirm it renders. Don't claim done until you've seen it load.

## Gotchas (hard-won)
- File classes are SINGULAR — `class:'settings'` makes a file invisible (404).
- Layout body placeholder is `"@@PageComponents@@"`, not `"@body"`.
- In CM64 function sandbox: no `String()` constructor — use concatenation.
- `innerHTML` escapes HTML; top-level `:slug` routes need `routes.json`.

## Done means
A live URL that renders, the deliverable list checked off, and a one-line report
of what shipped + what's deferred.
