---
name: FTS retrieval AND-semantics trap
description: websearch_to_tsquery ANDs every lexeme, so conversational queries silently return zero matches; loosen with an OR fallback and don't let the prompt hard-refuse on empty RAG.
---

Postgres `websearch_to_tsquery('english', q)` joins every lexeme with `&` (AND), so a chunk must contain *all* terms to match. Passing a raw conversational message ("tell me in 250 words why ...") injects filler lexemes ("250", "words", "general") that aren't in any source, dropping the match count to zero even when the meaningful terms are present. The RAG layer then hands the model empty context.

**Why:** A user testing the Professor (Grok) got "No library context available" while the Library actually had matching chunks — the full sentence scored 0 FTS matches, the trimmed question scored 5. Confirmed against live data (same noisy query: 0 with AND, 57 with OR).

**How to apply:**
- For FTS grounding over free-text user input, run precise `websearch_to_tsquery` first; if it returns zero rows, fall back to the same normalized lexemes OR-ed together: `replace(websearch_to_tsquery('english', q)::text, '&', '|')::tsquery`, re-ranked by `ts_rank`. Precision when possible, never a zero on filler. The `::text`→replace→`::tsquery` cast stays parameter-safe (the user string remains a bound param).
- Keep RAG retrieval paths consistent: the Student's Classroom retrieval already had a graceful fallback while the Professor's Library retrieval did not — that asymmetry was the bug surface.
- A system prompt that says "if context is empty, refuse and ask for a source" converts a retrieval miss into a hard refusal. Instead let the model answer from its own expertise on empty/thin context and label provenance (Library-grounded vs. general knowledge). If you tell the model to "cite the Library," the retrieval must actually carry source title/URL into the context, or the citation instruction is hollow.
