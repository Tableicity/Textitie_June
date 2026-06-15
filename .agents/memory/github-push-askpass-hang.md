---
name: GitHub push hangs via replit-git-askpass
description: Why Replit GUI/shell git pushes to GitHub hang for this repo, how to bypass, and the real fix.
---

# Symptom
Replit Git pane "Push" — and shell `git push origin main`, even read-only `git ls-remote origin` — HANGS indefinitely. The commit lands locally, nothing reaches GitHub, and no error is surfaced ("happy news, walk away, still broken").

# Root cause (proven, not guessed)
- Credentials route through `GIT_ASKPASS=replit-git-askpass` (a real binary in replit-runtime-path). Invoking it directly the way git does returns **exit 124 = it blocks forever** (waiting on Replit's connection service / a token it cannot mint). This is the hang.
- The Replit GitHub connection is stuck bound to a **stale account**: `$GIT_CONFIG_GLOBAL` (`/run/replit/user/<id>/.config/git/config`) shows the wrong `user.name`/`user.email`, and a GUI disconnect+reconnect did NOT re-bind it.
- No git `credential.helper` exists in any scope; auth comes only via the hanging askpass.

**Why:** GUI and shell both depend on the same hanging askpass, so they stall identically. An inline-PAT URL bypasses askpass entirely — that is why only that path works.

# Reliable bypass (keeps work safe; NOT the root fix)
Push with the PAT in the URL (secret `GITHUB_TEXTITIE`, user `TransferAgent`) and `GIT_TERMINAL_PROMPT=0` so it can't fall back to a prompt/hang:
`git push "https://TransferAgent:${GITHUB_TEXTITIE}@github.com/TransferAgent/textitie.git" main`
Always redact the token from output: `sed "s#${GITHUB_TEXTITIE}#***#g"`. Pushes have been clean fast-forwards (GitHub stayed an ancestor of local main — nothing overwritten).

# Real fix (Replit connection side; agent CANNOT do it from shell — git-config writes are blocked for main agent)
1. Fully **disconnect** the GitHub connection in Replit (removes the hanging askpass + stale global identity).
2. In the browser: sign out of all GitHub accounts → sign in as the account with write access to the repo → **revoke** the old Replit OAuth authorization (GitHub → Settings → Applications → Authorized OAuth Apps → Replit). If the repo is org-owned, approve the Replit OAuth app for the org (Org → Settings → Third-party Access).
3. **Reconnect** in Replit; confirm the Commit-author identity changed away from the stale account.
4. If it STILL hangs / still shows the stale account after a clean disconnect+revoke+reconnect → it's a Replit integration bug (server-side askpass hang) → contact Replit support with the evidence (`replit-git-askpass` exits 124).

# Verify (never trust "happy news")
After any push, read the live tip and compare to local:
`git ls-remote --heads <inline-token-url>` vs `git rev-parse main`.

# Decision (2026-06-15): move the GitHub home to the Tableicity account — DONE
Owner has TWO GitHub accounts: **Tableicity** (info@tableicty.com — the account Replit's connection is bound to) and **TransferAgent** (owns the old repo `TransferAgent/textitie`). Replit-as-Tableicity cannot push to a TransferAgent-owned repo (clean 403 + hanging askpass) — that was the whole hang/fail story. Fix applied: created a fresh repo UNDER Tableicity so connection-account == repo-owner.

**STATUS: COMPLETE (2026-06-15).** Primary repo is now `https://github.com/Tableicity/Textitie_June.git`, pushed full history via secret `GITHUB_TABLEICITY` (Tableicity PAT); verified live tip matched local. Old `TransferAgent/textitie` kept as backup through tip `b95b9d6`. NOTE: `origin` still pointed at the old TransferAgent repo at completion — the GUI "Push" won't target the new repo until someone runs `git remote set-url origin https://github.com/Tableicity/Textitie_June.git` (git-config write; main agent is blocked from it, user must run).

## Shell push plan (owner runs in their own shell; main agent can't do git-config writes, the user can)
Auth note: the existing `GITHUB_TEXTITIE` PAT is **TransferAgent's** and will NOT have write on a Tableicity repo. A **Tableicity** PAT is required for shell pushes — classic PAT, scope `repo`, stored as secret `GITHUB_TABLEICITY`.
1. `git push "https://<TABLEICITY_OWNER>:${GITHUB_TABLEICITY}@github.com/<TABLEICITY_OWNER>/<REPO>.git" main`  (sends full local history; current tip was b95b9d6)
2. optional, make it the default remote: `git remote set-url origin "https://github.com/<TABLEICITY_OWNER>/<REPO>.git"`
3. verify: `git ls-remote --heads "https://<TABLEICITY_OWNER>:${GITHUB_TABLEICITY}@github.com/<TABLEICITY_OWNER>/<REPO>.git"` vs `git rev-parse main`
Always redact token: `sed "s#${GITHUB_TABLEICITY}#***#g"`; use `GIT_TERMINAL_PROMPT=0`. After this the GUI Push may finally work too (connection-account now owns the repo) — verify via live tip, don't trust "happy news".
