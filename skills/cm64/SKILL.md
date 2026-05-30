---
name: cm64
description: Build, edit, and deploy websites/apps on CM64 Studio (JSON-driven pages, components, databases). Use to create or maintain a site.
---

# Skill: cm64 (your web builder)

`cm64` is a CLI for CM64 Studio — a JSON-driven web platform (pages, components,
databases, settings; instant deploy). Run it through the `shell` tool: `cm64 <cmd>`.
It's a **stateless, local-first** CLI: pull a project into a folder, edit files
locally, push.

## First moves (self-discovery — do this, don't guess)
```
cm64 --help            # full command list
cm64 learn             # ← prints CM64's own system prompt + skills index. READ THIS.
cm64 learn <skill>     # deep docs on a specific CM64 skill
cm64 projects --json   # list your projects (find the id/domain)
```
**Always run `cm64 learn` before building** — it's the authoritative, up-to-date
guide to the framework (the notes below can drift; `cm64 learn` cannot).

## The local-first loop
```
cm64 use <project_id|domain>   # set active project
cm64 pull                      # pull into ./<domain>/ folder
# ...edit files locally with fs/shell...
cm64 push --check              # PREVIEW what would change (dry run first!)
cm64 push                      # push changes to server
cm64 snapshot <name>           # snapshot, then:
cm64 deploy latest             # pin to production
```

## Project shape (JSON, classes are SINGULAR)
- `setting/layout.json` — shell with `"@@PageComponents@@"` placeholder
- `setting/theme.json`, `setting/fonts.json`
- `page/index.json` — page; reference components as `"./ComponentName"`
- `component/<Name>.jsx` — style/className go INSIDE `attributes`
- `database/<name>.json` — needs an `"id"` field matching the key

## Hard rules (don't get burned)
- File classes are **SINGULAR** (page, component, database, setting, css, function,
  asset). A plural class makes the file invisible → 404.
- Layout body placeholder is `"@@PageComponents@@"`, not `"@body"`.
- `cm64 push --check` BEFORE every real push. Never push stale — pull first.
- In CM64's function sandbox: no `String()` constructor — use concatenation.

## Done means
Pushed + deployed, and you VERIFIED the live URL renders (open it via `movicom` on
the phone, or `curl` via shell). Don't claim done until you've seen it load.
