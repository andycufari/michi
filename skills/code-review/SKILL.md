---
name: code-review
description: Review code or a built artifact for correctness, simplicity, and obvious bugs before shipping.
---

# Code review

A quick, honest self-review before you call work done.

## Check
- **Correctness** — does it actually do what the brief asked? Trace one real path.
- **Simplicity** — is anything more complex than it needs to be? Cut it.
- **Obvious bugs** — off-by-one, unhandled error, wrong class/field name, typo in a
  key the framework queries by.
- **Matches the codebase** — naming, structure, idiom consistent with what's there.
- **Verified, not assumed** — did you actually run/open it, or just believe it works?

## Output
A short verdict: ✅ ship / ⚠️ ship with caveats / ❌ fix first — plus the specific
issues found (file + line/field), each with a one-line fix. No vague praise.
