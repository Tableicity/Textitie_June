---
name: SSRF guard via net.BlockList + pinned lookup
description: Non-obvious behaviors when building an SSRF URL-fetch guard with Node's net.BlockList and a custom DNS lookup; how to close DNS rebinding.
---

# SSRF guard gotchas (server-side URL fetch)

Context: a Conductor/admin pastes a URL and the server fetches it (knowledge ingestion).
The guard must reject loopback/private/link-local/metadata targets without breaking
real public fetches.

## Rule 1 — never add `::ffff:0:0/96` to a net.BlockList
`net.BlockList.check(ip, "ipv6")` **already** maps IPv4-mapped IPv6 addresses
(`::ffff:127.0.0.1`, and the hex/compressed forms `::ffff:7f00:1`, `::ffff:0a00:0001`)
onto the IPv4 rules. So your normal IPv4 subnets (127/8, 10/8, …) already cover the
mapped private forms.
**If you also add `::ffff:0:0/96` as an ipv6 subnet, every public IPv4 address gets
blocked** — because checking an IPv4 like `8.8.8.8` cross-checks the mapped range and
matches the /96. This silently breaks ALL public fetches.
**Why:** BlockList normalizes mapped addresses internally; the /96 is redundant for
private coverage and catastrophic for public traffic.

## Rule 2 — close DNS rebinding by binding validation to the socket
Validating with `dns.lookup()` and then calling `fetch()` is a TOCTOU bypass: fetch
re-resolves and an attacker can rebind the hostname to `127.0.0.1`/metadata between the
two resolutions. **Fix:** drop `fetch` for this path and use `node:http`/`node:https`
`request()` with a custom `lookup` option that resolves, filters out blocked IPs, and
hands the socket **only validated public IPs**. The connection can then only reach a
checked address. Re-validate + re-resolve on every redirect hop (use `redirect:manual`
equivalent: handle 3xx yourself).
- Literal-IP hosts do **not** invoke `lookup` — validate those separately up front.
- The WHATWG `URL` parser normalizes integer/hex/octal IPv4 hosts
  (`http://2130706433`, `http://0x7f000001`) to dotted-decimal, so the literal-IP
  check catches those encodings for free.

## How to apply
When adding any server feature that fetches a user/admin-supplied URL, reuse this
pattern (`assertPublicHttpUrl` + `safeLookup` + http/https `request` with body cap +
per-hop timeout) rather than a bare `fetch`. Verify with: public host 200, `localhost`
blocked, integer-encoded loopback blocked, `ftp://` rejected.
