import { isAuthenticated, passwordsMatch, safeNextPath, sessionCookie, signSession, sitePassword } from "./_auth.js";

export default async function handler(request, response) {
  try {
    if (request.method === "POST") {
      const body = await readForm(request);
      const next = safeNextPath(body.next);
      if (!sitePassword()) {
        html(response, 500, "<h1>Login is not configured</h1><p>Set <code>COMMITCAST_SITE_PASSWORD</code> on Vercel.</p>");
        return;
      }

      if (!passwordsMatch(body.password ?? "")) {
        response.statusCode = 302;
        response.setHeader("Location", `/login?error=1&next=${encodeURIComponent(next)}`);
        response.end();
        return;
      }

      response.statusCode = 302;
      response.setHeader("Set-Cookie", sessionCookie(signSession()));
      response.setHeader("Location", next);
      response.end();
      return;
    }

    if (isAuthenticated(request)) {
      response.statusCode = 302;
      response.setHeader("Location", safeNextPath(firstQuery(request.query?.next)));
      response.end();
      return;
    }

    const errored = firstQuery(request.query?.error) === "1";
    const next = safeNextPath(firstQuery(request.query?.next));
    html(
      response,
      200,
      `<h1>CommitCast</h1>
       <p>Enter the site password to connect LinkedIn for Ittisal.</p>
       ${errored ? "<p class=\"error\">Wrong password.</p>" : ""}
       <form method="post" action="/api/login">
         <input type="hidden" name="next" value="${escapeAttr(next)}" />
         <label>Password <input type="password" name="password" autocomplete="current-password" autofocus required /></label>
         <button type="submit">Log in</button>
       </form>`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    html(response, 500, `<h1>Login failed</h1><p>${escapeHtml(message)}</p>`);
  }
}

async function readForm(request) {
  const contentType = headerContentType(request);

  if (typeof request.formData === "function" && contentType.includes("form")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }

  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body) && typeof request.body.pipe !== "function") {
    return request.body;
  }

  if (typeof request.body === "string") {
    return Object.fromEntries(new URLSearchParams(request.body));
  }

  if (Buffer.isBuffer(request.body)) {
    return Object.fromEntries(new URLSearchParams(request.body.toString("utf8")));
  }

  if (typeof request.on === "function") {
    const chunks = [];
    await new Promise((resolve, reject) => {
      request.on("data", (chunk) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      request.on("end", resolve);
      request.on("error", reject);
    });
    if (chunks.length > 0) {
      return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
    }
  }

  return {};
}

function headerContentType(request) {
  const headers = request.headers;
  if (headers && typeof headers.get === "function") {
    return headers.get("content-type") ?? "";
  }
  const value = headers?.["content-type"] ?? headers?.["Content-Type"];
  return Array.isArray(value) ? (value[0] ?? "") : String(value ?? "");
}

function firstQuery(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function html(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CommitCast login</title>
<style>
body{margin:0;font-family:Segoe UI,system-ui,sans-serif;background:#070a12;color:#eef3ff}
main{max-width:440px;margin:0 auto;padding:64px 24px}
.card{background:rgba(16,22,36,.6);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:24px}
label,input,button{display:block;width:100%;box-sizing:border-box}
input{margin:8px 0 16px;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0f19;color:#eef3ff}
button{padding:12px;border:0;border-radius:10px;background:#7c5cff;color:#fff;font-weight:600;cursor:pointer}
.error{color:#ff8b8b}
</style></head>
<body><main><div class="card">${body}</div></main></body></html>`);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
