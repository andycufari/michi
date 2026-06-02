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

## If you know the URL, GO straight there (don't fumble the address bar)
Reaching the web by tapping Chrome's omnibox and typing is flaky. Use the `web`
verb — it loads the page deterministically via an intent:
```
movicom web search "world cup 2026 first match"   # → Google results (read the AI overview)
movicom web open https://en.wikipedia.org/wiki/2026_FIFA_World_Cup
movicom web go bbc.com/sport                        # bare domain → https:// added
```
**Build the URL yourself when you can** — a Google search URL, a Wikipedia article,
a known site path — instead of navigating through a UI. It's fewer steps, no missed
taps, and Google often returns an AI-overview answer you can read in one `ui see`.
Drive the glass (`ui tap`/`ui fill`) only for what a URL can't reach (logged-in
apps, in-app actions).

## Core loop — THE FRAME
```
movicom doctor                 # where am I? device + foreground app. START HERE.
movicom app fresh <name>       # open at a clean start point (force-stop + home + launch)
movicom ui frame               # read the screen as {app, read[], do[]} (numbered)
movicom ui do <n>              # act by NUMBER → returns the next frame
movicom ui do <n> "text"      # act with text (e.g. type into an input)
```
If you get lost: `movicom app fresh <name>` resets to that app's main screen.

## Reading the screen — `ui frame`
Returns `{app, read:[...content...], do:["1 type <text>","2 send","3 up",...], pick}`.
- `read` = the CONTENT on screen (messages, captions, list items). Read this.
- `do` = the ACTIONS, each NUMBERED. Pick one with `ui do <n>`.
- Every `ui do` returns the next frame, so you don't need a separate read.

**Numbers vs verbs:**
- `ui do 1` — a number is position-specific; great interactively (you just read the
  frame, so you know what 1 is). Always read the frame before picking.
- `ui do send` / `ui do type "x"` / `ui do back` — a VERB re-resolves against the
  live screen. **Use verbs in workflows/macros** so they self-heal across UI changes.
  Core verbs: `type` (+ `type2`, `type3` for multi-field forms), `send`, `up`, `down`,
  `back`, `home`, `more`.
- `ui do more` — page to the next batch of actions (inline, cheap).

Don't reason about pixels. Read `read`, pick a number/verb from `do`.

## Verbs
- System: `contacts list [q]` · `contacts find <q>` · `contacts add '{...}'` · `notif list` · `app list`
- Apps: `app fresh <name>` (clean start) · `app open <name>` · `app store <name>` (Play Store page) · `app intent '{...}'`
- Frame: `ui frame` · `ui do <n|verb> [text]` · `ui do more`
- Low-level (when you need a specific element by name): `ui see` · `ui tap "<l>"` · `ui fill '{...}'` · `ui key <BACK|ENTER|...>` · `ui scroll <dir>`
- Vision fallback: `ui shot` — low-res screenshot, ONLY for text-less screens. You
  are multimodal; use it when a screen has no readable text.

## Installing apps & macros
- `app store <name>` → the Play Store page (skips search + sponsored-ad trap), then
  `ui do <Install>`. Logging in is the human's job — drive accounts, never create them.
- Crystallize a done task into a macro (self-improving): `workflow add wa-send
  '["app fresh whatsapp","ui tap $1","ui do type \"$2\"","ui do send"]'` then
  `workflow run wa-send <chat> "<msg>"`. Use verb-mode `ui do` + `$`-params so it
  self-heals. The frame is app-agnostic; workflows are the app-specific layer.

## Self-discovery
Run `movicom` (no args) for the verb list, or read its AGENTS.md / HOWTO.md for the
full manual + phone setup. Structured data (a contact) → prefer the direct command
over typing. Output is always JSON.

## Gotchas
- `ui type` is async on-device; movicom settles between actions — but prefer
  providers/intents over typing for structured data.
- Phone numbers auto-format on display; the stored value is clean.
- Outbound (sms send, call dial) is GATED — never assume it fired; check.
