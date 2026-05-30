---
name: movicom
description: Drive a real Android phone — open apps, read the screen as text, tap/type, read notifications, contacts. Use for anything in the physical/app world.
---

# Skill: movicom (your phone body)

`movicom` is a CLI that drives a real Android phone over adb. It is your hands and
eyes in the world. You already have a dedicated `movicom` tool — call it with
`{command: "<args>"}` (no leading "movicom" word). You can also run it via `shell`.

## The one rule
**Talk to the OS, not the glass, whenever you can.** System things (contacts, sms,
notifications, settings) have direct commands — use them instead of tapping through
a UI. Only drive the screen for third-party apps with no back door.

## Core loop
```
movicom doctor                 # where am I? device + foreground app. START HERE.
movicom app open <name>        # go somewhere (deterministic, by package)
movicom ui see                 # read the screen as cheap structured JSON
movicom ui tap "<label>"       # act BY NAME, never by pixel coordinates
movicom ui see                 # verify it changed
```
If you get lost: `movicom app open home` resets you.

## Reading the screen — `ui see`
Returns `{app, tap:[...], type:[...], read:[...], scroll}`.
- `tap` = labels you can tap → `movicom ui tap "Wi-Fi"`
- `type` = editable fields (values also in `read`)
- `scroll:true` = `movicom ui scroll down` then `ui see` again
Think in **names**; movicom holds the coordinates. A label missing? It may be
off-screen — scroll and look again.

## Verbs
- System: `contacts list [q]` · `contacts find <q>` · `contacts add '{first,last,phone}'` · `notif list` · `app list`
- UI: `ui see [--raw|--coords]` · `ui tap "<l>"` · `ui type "<t>"` · `ui key <BACK|HOME|ENTER|TAB>` · `ui scroll <dir>` · `ui back` · `ui home`
- Vision fallback: `ui shot` — low-res screenshot, ONLY for text-less screens
  (captchas, image buttons). You are multimodal; use it when `ui see` has no text.

## Self-discovery
Run `movicom` (no args) or read its AGENTS.md for the full manual. Structured data
(a contact, an sms) → prefer the direct command over typing. Output is always JSON.

## Gotchas
- `ui type` is async on-device; movicom settles between actions — but prefer
  providers/intents over typing for structured data.
- Phone numbers auto-format on display; the stored value is clean.
- Outbound (sms send, call dial) is GATED — never assume it fired; check.
