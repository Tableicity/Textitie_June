import { Router } from "express";
import { db, surveySendsTable, surveysTable, surveyResponsesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<style>
  *,*::before,*::after { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: linear-gradient(135deg,#0f172a,#1e293b); min-height:100vh; display:flex;
         align-items:center; justify-content:center; padding:20px; color:#0f172a; }
  .card { background:#fff; border-radius:16px; padding:32px 28px; max-width:420px; width:100%;
          box-shadow:0 20px 50px rgba(0,0,0,.3); }
  h1 { font-size:20px; margin:0 0 8px; font-weight:700; }
  p { color:#475569; margin:0 0 20px; line-height:1.5; }
  .ratings { display:flex; gap:8px; justify-content:space-between; margin:24px 0; }
  .star { flex:1; aspect-ratio:1; display:flex; align-items:center; justify-content:center;
          background:#f1f5f9; border:2px solid transparent; border-radius:12px; cursor:pointer;
          font-size:22px; font-weight:600; color:#475569; transition:all .15s; user-select:none; }
  .star:hover { background:#dbeafe; border-color:#3b82f6; color:#1d4ed8; }
  .star.active { background:#3b82f6; color:#fff; border-color:#3b82f6; }
  textarea { width:100%; min-height:80px; border:1px solid #cbd5e1; border-radius:8px;
             padding:10px 12px; font:inherit; resize:vertical; margin:0 0 16px; }
  button { width:100%; padding:14px; background:#0f172a; color:#fff; border:none; border-radius:10px;
           font-size:15px; font-weight:600; cursor:pointer; transition:opacity .15s; }
  button:hover:not(:disabled) { opacity:.9; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .muted { color:#94a3b8; font-size:12px; text-align:center; margin-top:16px; }
  .scale-labels { display:flex; justify-content:space-between; font-size:11px; color:#94a3b8;
                  margin-top:-16px; margin-bottom:16px; }
</style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`;
}

function thankYouPage(message: string): string {
  return pageShell(
    "Thank you",
    `<h1>✓ Thank you</h1><p>${escapeHtml(message)}</p>`,
  );
}

function errorPage(title: string, message: string): string {
  return pageShell(
    title,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`,
  );
}

router.get("/s/:token", async (req, res) => {
  const token = String(req.params.token).slice(0, 64);
  try {
    const rows = await db
      .select({
        id: surveySendsTable.id,
        status: surveySendsTable.status,
        expiresAt: surveySendsTable.expiresAt,
        surveyId: surveySendsTable.surveyId,
        prompt: surveysTable.prompt,
      })
      .from(surveySendsTable)
      .innerJoin(surveysTable, eq(surveySendsTable.surveyId, surveysTable.id))
      .where(eq(surveySendsTable.token, token))
      .limit(1);

    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store");

    if (rows.length === 0) {
      res.status(404).send(errorPage("Survey not found", "This link is invalid or has been removed."));
      return;
    }
    const row = rows[0];
    if (row.status === "responded") {
      res.send(thankYouPage("You've already submitted feedback for this conversation."));
      return;
    }
    if (row.expiresAt.getTime() < Date.now() || row.status === "expired") {
      res.status(410).send(errorPage("Survey expired", "This survey link has expired."));
      return;
    }

    const stars = [1, 2, 3, 4, 5]
      .map(
        (n) =>
          `<div class="star" data-score="${n}" role="button" tabindex="0" aria-label="${n} out of 5">${n}</div>`,
      )
      .join("");

    const body = `
      <h1>Quick feedback</h1>
      <p>${escapeHtml(row.prompt)}</p>
      <form id="f" method="POST" action="/api/s/${encodeURIComponent(token)}">
        <div class="ratings" role="radiogroup" aria-label="Rating">${stars}</div>
        <div class="scale-labels"><span>Poor</span><span>Excellent</span></div>
        <input type="hidden" name="score" id="score" value="" />
        <textarea name="comment" id="comment" placeholder="Tell us more (optional)" maxlength="1000"></textarea>
        <button type="submit" id="sub" disabled>Submit</button>
      </form>
      <p class="muted">Your response is private and helps us improve.</p>
      <script>
        (function() {
          var stars = document.querySelectorAll('.star');
          var scoreInput = document.getElementById('score');
          var btn = document.getElementById('sub');
          stars.forEach(function(s) {
            function pick() {
              stars.forEach(function(x) { x.classList.remove('active'); });
              s.classList.add('active');
              scoreInput.value = s.getAttribute('data-score');
              btn.disabled = false;
            }
            s.addEventListener('click', pick);
            s.addEventListener('keydown', function(e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
            });
          });
          document.getElementById('f').addEventListener('submit', function(e) {
            if (!scoreInput.value) { e.preventDefault(); return; }
            btn.disabled = true; btn.textContent = 'Submitting…';
          });
        })();
      </script>
    `;
    res.send(pageShell("Quick feedback", body));
  } catch (err) {
    logger.error({ err }, "Survey GET error");
    res.status(500).set("Content-Type", "text/html").send(errorPage("Error", "Something went wrong."));
  }
});

router.post("/s/:token", async (req, res) => {
  const token = String(req.params.token).slice(0, 64);
  const scoreRaw = req.body?.score;
  const commentRaw = req.body?.comment;
  const score = Number(scoreRaw);
  if (!Number.isFinite(score) || score < 1 || score > 5) {
    res.status(400).set("Content-Type", "text/html").send(errorPage("Invalid score", "Score must be between 1 and 5."));
    return;
  }
  try {
    const rows = await db
      .select({
        id: surveySendsTable.id,
        tenantId: surveySendsTable.tenantId,
        status: surveySendsTable.status,
        expiresAt: surveySendsTable.expiresAt,
        thankYou: surveysTable.thankYou,
      })
      .from(surveySendsTable)
      .innerJoin(surveysTable, eq(surveySendsTable.surveyId, surveysTable.id))
      .where(eq(surveySendsTable.token, token))
      .limit(1);

    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store");

    if (rows.length === 0) {
      res.status(404).send(errorPage("Survey not found", "This link is invalid."));
      return;
    }
    const row = rows[0];
    if (row.status === "responded") {
      res.send(thankYouPage("You've already submitted feedback. Thanks!"));
      return;
    }
    if (row.expiresAt.getTime() < Date.now() || row.status === "expired") {
      res.status(410).send(errorPage("Survey expired", "This link has expired."));
      return;
    }

    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const ua = (req.headers["user-agent"] as string | undefined) ?? null;
    const comment = typeof commentRaw === "string" ? commentRaw.slice(0, 1000) : null;

    try {
      await db.insert(surveyResponsesTable).values({
        tenantId: row.tenantId,
        sendId: row.id,
        score: Math.round(score),
        comment,
        ip,
        userAgent: ua,
      });
    } catch (insertErr) {
      // PG unique violation = 23505 (duplicate response — race). Anything
      // else is a real failure: surface as 500 rather than silently
      // pretending success.
      const pgCode = (insertErr as { code?: string } | null)?.code;
      if (pgCode === "23505") {
        logger.info({ sendId: row.id }, "Duplicate survey response (race)");
        res.send(thankYouPage("You've already submitted feedback. Thanks!"));
        return;
      }
      logger.error({ err: insertErr, sendId: row.id }, "Survey response insert failed");
      res.status(500).set("Content-Type", "text/html").send(errorPage("Error", "Could not record your feedback. Please try again."));
      return;
    }

    await db
      .update(surveySendsTable)
      .set({ status: "responded" })
      .where(eq(surveySendsTable.id, row.id));

    res.send(thankYouPage(row.thankYou || "Thanks for your feedback!"));
  } catch (err) {
    logger.error({ err }, "Survey POST error");
    res.status(500).set("Content-Type", "text/html").send(errorPage("Error", "Something went wrong."));
  }
});

export default router;
