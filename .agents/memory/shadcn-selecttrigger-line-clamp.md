---
name: shadcn SelectTrigger line-clamp clips custom content
description: Why custom icon/pill content inside a shadcn SelectTrigger gets clipped or misaligned, and how to lay it out safely.
---

# shadcn SelectTrigger `[&>span]:line-clamp-1` clips/misaligns custom trigger content

shadcn's `SelectTrigger` (components/ui/select.tsx) ships with `[&>span]:line-clamp-1`
in its base className. `line-clamp-1` expands to `display:-webkit-box` +
`-webkit-line-clamp:1` + `overflow:hidden`. That rule targets **every direct
`<span>` child** of the trigger.

**The trap:** if you put custom trigger content (icon + colored dot + label) in a
single wrapping `<span className="flex items-center …">`, the parent's
`[&>span]:line-clamp-1` overrides your `display:flex` with `display:-webkit-box`,
which breaks the flex row — the leading icon gets pushed/squashed and clips at the
top-left edge of the trigger. SVG icons in the (now broken) box also shrink.

**Fix:**
- Wrap custom trigger content in a `<div>`, **not** a `<span>`, so the
  `[&>span]:` variant no longer targets it.
- Mark fixed-size leading elements (icon, status dot) `shrink-0` so they keep size.
- Put `truncate` (or `line-clamp` deliberately) on the text span only, and
  `overflow-hidden` on the wrapper div.
- Give the trigger a width with a little slack (the content + chevron must fit).

**Why:** plain `SelectValue` (the default trigger child) is a span and works fine
because it's just text; the bug only appears with multi-element custom triggers.

**How to apply:** any time you render custom JSX (icons/pills/badges) directly
inside a `SelectTrigger`. Same hazard exists for any shadcn component whose base
class carries a `[&>span]:line-clamp-1` / `display:-webkit-box` utility.
