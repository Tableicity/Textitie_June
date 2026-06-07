---
name: Deploy secret reload
description: Replit autoscale deployments do not pick up changed secrets until republished
---

Changing/saving a Replit **deployment** secret does NOT restart or reload a running autoscale deployment. The live prod process keeps the OLD env until the app is **republished** (Publish).

**Why:** Diagnosed during the Textitie new-Twilio go-live: the prod deployment kept sending from the OLD long-code even after the new-account `TWILIO_*` / `SAMA_FROM_NUMBER` secrets were saved, because prod was never republished. An outbound test inject proved it (message went out from the old number).

**How to apply:**
- After setting/rotating prod secrets, treat them as inert until a republish.
- Verify go-live by an observable side effect — e.g. the actual `from` number on a real outbound send (check the Twilio API / message record), or a behavior change like a previously-500 endpoint now 401/200 — NOT merely "the secret is set."
- A republish also ships current `main` workspace state, so it can simultaneously fix unrelated already-committed bugs.
