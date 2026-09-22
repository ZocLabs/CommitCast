import { requireAuth } from "./_auth.js";

export default function handler(request, response) {
  try {
    if (!requireAuth(request, response)) {
      return;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CommitCast · ZocLabs / Ittisal</title>
    <style>
      body { margin: 0; font-family: Segoe UI, system-ui, sans-serif; background: #070a12; color: #eef3ff; }
      main { max-width: 640px; margin: 0 auto; padding: 64px 24px; }
      a { color: #7c5cff; }
      .card { background: rgba(16,22,36,.6); border: 1px solid rgba(255,255,255,.1); border-radius: 20px; padding: 24px; }
      ol { padding-left: 1.2rem; }
      .top { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <div class="top">
          <h1>CommitCast</h1>
          <a href="/logout">Log out</a>
        </div>
        <p>ZocLabs CLI that turns git commits into Ittisal LinkedIn posts, X threads, and architecture diagrams.</p>
        <p>
          Related:
          <a href="https://github.com/ZocLabs/ittisal">ittisal</a> ·
          <a href="https://github.com/ZocLabs/Ittisal_Website">Ittisal_Website</a>
        </p>
        <p>Before connecting, add these on the LinkedIn app <strong>Products</strong> tab (Auth stays empty until you do):</p>
        <ol>
          <li>Sign In with LinkedIn using OpenID Connect</li>
          <li>Share on LinkedIn</li>
          <li>Community Management API (review required for company-page posts)</li>
        </ol>
        <p>
          <a href="/api/linkedin/start">Connect LinkedIn (member)</a><br />
          <a href="/api/linkedin/start?org=1">Connect LinkedIn (organization)</a>
        </p>
      </div>
    </main>
  </body>
</html>`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.statusCode = 500;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(`CommitCast failed: ${message}`);
  }
}
