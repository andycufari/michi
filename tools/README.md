# /tools — Michi's capabilities

Each tool here is something Michi can **do**. Michi doesn't execute these files —
it *calls a tool by name* and MichiOS runs it. This folder documents what each tool
is and how to call it, so both Michi (via boot) and a human can understand the
agent's reach.

A tool is registered in `lib/tools.js` (its schema, shown to the model) and
executed there (shelled out or run in-process). **To give Michi a new capability:
add a CLI to PATH + one entry in `lib/tools.js`.** The agent loop never changes.

## Current tools

### `movicom` — the body
Drives a real Android phone over adb. Michi's hands and eyes in the world.
Call shape: `{ "command": "<movicom args without the leading 'movicom'>" }`

| What | Command |
|---|---|
| Orient | `doctor` |
| Apps | `app list` · `app open <name>` |
| See screen | `ui see` (`--raw` for source XML, `--coords` for tap points) |
| Touch | `ui tap "<label>"` · `ui type "<text>"` · `ui key <BACK\|HOME\|ENTER\|…>` |
| Move | `ui scroll <down\|up\|left\|right>` · `ui back` · `ui home` |
| Contacts | `contacts list [q]` · `contacts find <q>` · `contacts add '{json}'` |
| Notifications | `notif list` |

Rule: talk to the OS (system commands) before the glass (UI taps). Output is
always one JSON value.

### `fs` — the home
Read/write Michi's own `home/` folder. Its persistent memory and workspace.
Call shape: `{ "op": "read|write|list|delete", "path": "rel/to/home", "content": "…" }`
Paths are sandboxed to `home/` — Michi can't escape its own workspace.

### `shell` — the terminal
Run a command line inside MichiOS (cwd = OS root). For everything beyond the body
and home/: read/search files, run CLIs.
Call shape: `{ "command": "ls boot/" }`

**Policy-gated.** Every command is checked against `policy.json` BEFORE running:
- precedence: **deny wins → allow → otherwise BLOCK** (default-deny)
- compound commands (`a && b`) only run if *every* sub-command passes (no smuggling)
- on refusal, the tool returns `{blocked:true, reason, offending, allowed:[…]}` so
  Michi learns its sandbox and adapts
- runs jailed to the MichiOS dir

To widen/narrow what Michi can run, edit `policy.json` (hand-edited, versioned;
Michi never writes it). To trust fully later, set `allow: ["*"]` and rely on the
denylist (best paired with Docker isolation — see roadmap).

## Gated (not yet live)
Outbound actions (sending a message, placing a call) must pass an approval brake
before they fire. Until that brake is wired, treat any "send"/"call" as
*compose-only* — never assume it went out.
