# Color Picker / Brand Personalization — Scoping Notes

**Status:** Idea / not started. Captured from a conversation on 2026-06-28.
**Where:** `artifacts/user-app` (the tenant-facing app). The admin app
(`eng-architect`) is the orange one and is out of scope here.

---

## The idea

We changed the Inbox setup banner from Textline-blue to our own blue
(`#3e6996`), which created a deliberate visual delineation from Textline. That
raised two questions:

1. How deep would it go to change **all** of the Inbox message bubbles (the
   agent/Student reply bubbles) to our new blue?
2. If we went that far, could we expose a **color picker** so each tenant can
   personalize their platform's brand color?

Short answer: the bubble itself is a one-line change, but doing it *properly*
is a tokenization refactor — and that refactor is exactly what makes a color
picker nearly free.

---

## What's under the hood today (findings)

- **The reply bubbles are literally one class.** Outbound messages
  (agent/Student replies) render as `bg-blue-600 text-white`; inbound
  (customer) bubbles are neutral gray. Recoloring just the reply bubbles is a
  one-line change in `Inbox.tsx`.
- **Blue is hardcoded everywhere.** ~**145** `blue-*` usages across **23
  files** (Inbox, Settings, Campaigns, Landing, the app shell, onboarding,
  etc.) — all literal Tailwind classes: `blue-600` for solids, `blue-700` for
  hovers, `blue-50` for tints, `blue-500` for accents.
- **A theming system already exists but is unused by our own code.**
  `artifacts/user-app/src/index.css` defines the full shadcn token set,
  including `--primary: 221 83% 53%` (which is essentially blue-600), plus
  `--ring`, `--secondary`, `--muted`, `--accent`, `--destructive`, sidebar
  tokens, and a dark-mode variant is scaffolded (`@custom-variant dark`).
  **The catch:** only the low-level shadcn UI primitives (`ui/*`) consume
  `bg-primary`/`text-primary`. Our own pages bypass the token and hardcode
  `blue-*`. So the "personalization engine" is sitting there, just not wired up.

---

## How deep — three tiers

### Tier 1 — Just the reply bubbles
- **Effort:** minutes.
- **Result:** looks broken on its own. The bubbles become new-blue while the
  selected-conversation highlight, avatars, links, badges, buttons, and the
  "jump to latest" pill stay old-blue. A two-blue Inbox.
- **Verdict:** do **not** ship this alone.

### Tier 2 — Tokenize the app (the real investment)
- Replace hardcoded blues with the existing `--primary` token:
  - `bg-blue-600 → bg-primary`
  - `hover:bg-blue-700 → hover:bg-primary/90`
  - `text-blue-700 → text-primary`
  - `bg-blue-50 → bg-primary/10`
  - `border-blue-200 → border-primary/30`, etc.
- Mechanical but careful pass across ~23 files. **No behavior change**, fully
  typecheck-able.
- **Payoff:** changing the entire platform's brand color becomes a **one-line
  edit** (`--primary` in `index.css`). This is the prerequisite for a picker.

### Tier 3 — The color picker
Once Tier 2 is done, the plumbing is small:
1. Pick a color in a Settings control.
2. Store it — **per-tenant in the DB** (we're already multi-tenant; this lives
   naturally on the tenant record and is set via the Conductor/tenant API).
   A lighter MVP could start in `localStorage` per user.
3. On app load, override the CSS variable:
   `document.documentElement.style.setProperty('--primary', '<h s% l%>')`
   (also set `--ring`, and a computed `--primary-foreground`).

The plumbing is easy. The **design correctness** is the actual work (see
gotchas).

---

## Two gotchas to resolve before committing

### 1. Semantic blue vs. brand blue (most important)
Some blues *mean something* and must **NOT** be themed. The biggest one is the
**engagement-mode color language**:
- 🔵 **Manual = Blue**
- 🟡 **Co-Pilot = Yellow**
- 🟢 **Auto-Pilot = Green**

The "Manual" indicator uses blue intentionally (e.g. a `bg-blue-50
text-blue-700` chip). A blind find-and-replace would recolor it and break the
status language. The tokenization pass must explicitly **separate brand-blue
from status-blue** and leave the mode colors hardcoded. Other "informational"
blues (selected conversation `bg-blue-50 border-l-blue-500`, the AI "drafted"
chip) are judgment calls: theming them usually *helps* cohesion, but the
engagement-mode trio is off-limits.

### 2. Contrast / accessibility
A freeform color wheel lets someone pick, say, yellow — and then white bubble
text becomes unreadable. Mitigations:
- **Auto contrast:** compute luminance of the chosen color and flip
  `--primary-foreground` between black/white accordingly.
- **Derived ramp:** one hue isn't a full Tailwind 50→900 ramp. Use CSS
  `color-mix()` (or generate tints/shades) so tints/hovers stay coherent.
- **Safest MVP:** offer a **curated palette of ~6–8 on-brand colors** instead
  of a raw wheel. Sidesteps both the contrast and ramp problems while still
  feeling personal. A freeform wheel can come later with the guards above.

---

## Recommendation

- **Skip Tier 1.** Mismatched blues look like a bug.
- **Do Tier 2 (tokenize).** Contained, low-risk, reviewable, and it's the
  unlock for everything else.
- **Ship Tier 3 as a curated-palette picker**, stored per-tenant, with the
  engagement-mode colors explicitly carved out and a contrast guard on the
  foreground.

### Rough effort
| Tier | Scope | Effort |
|------|-------|--------|
| 1 | Reply bubbles only | Trivial (not recommended) |
| 2 | Tokenize ~20 files to `--primary` | One focused pass + review |
| 3 | Per-tenant picker (store + apply-on-load + contrast guard + Settings UI) | Small but real feature |

### Suggested next step
When we move on this, do it in **Plan mode** so we can scope the tokenization
sweep precisely, enumerate the semantic-color carve-outs, and decide
DB-per-tenant vs. localStorage-MVP before touching code.

---

## Open questions to settle later
- Per-tenant brand color, or per-user preference? (Leaning per-tenant.)
- Curated palette vs. freeform wheel for v1? (Leaning curated.)
- Do we also theme the marketing/Landing page, or just the authed app?
- Dark mode: the variant is scaffolded but not fully themed — in or out of
  scope for v1?
- Should the admin app (`eng-architect`, currently orange) ever read the same
  per-tenant color, or stay operator-branded?
