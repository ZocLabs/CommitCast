export default async function handler(request, response) {
  try {
    const code = firstQuery(request.query.code);
    const error = firstQuery(request.query.error);
    const description = firstQuery(request.query.error_description);

    if (error) {
      html(response, 400, `<h1>LinkedIn denied access</h1><p>${escapeHtml(error)}: ${escapeHtml(description ?? "")}</p>`);
      return;
    }

    if (!code) {
      html(response, 400, "<h1>Missing authorization code</h1><p>Start from <a href=\"/api/linkedin/start\">/api/linkedin/start</a>.</p>");
      return;
    }

    const clientId = requireEnv("LINKEDIN_CLIENT_ID");
    const clientSecret = requireEnv("LINKEDIN_CLIENT_SECRET");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(request),
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = await tokenResponse.json();

    if (!tokenResponse.ok || !payload.access_token) {
      html(
        response,
        502,
        `<h1>Token exchange failed</h1><pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`,
      );
      return;
    }

    html(
      response,
      200,
      `<h1>CommitCast LinkedIn token</h1>
       <p>Paste this into local <code>.env</code> as <code>LINKEDIN_ACCESS_TOKEN</code>. Do not commit it.</p>
       <p>Organization URN: <code>${escapeHtml(process.env.LINKEDIN_ORGANIZATION_URN ?? "(not set)")}</code></p>
       <pre>${escapeHtml(payload.access_token)}</pre>
       <p>Expires in ${escapeHtml(String(payload.expires_in ?? "unknown"))} seconds.</p>`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    html(response, 500, `<h1>OAuth callback error</h1><p>${escapeHtml(message)}</p>`);
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function redirectUri(request) {
  const configured = process.env.LINKEDIN_REDIRECT_URI?.trim();
  if (configured) {
    return configured;
  }

  const proto = headerValue(request.headers["x-forwarded-proto"]) ?? "https";
  const host =
    headerValue(request.headers["x-forwarded-host"]) ??
    headerValue(request.headers.host) ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    "localhost:4173";

  const protocol = host.includes("localhost") ? "http" : proto;
  return `${protocol}://${host.replace(/^https?:\/\//, "")}/api/linkedin/callback`;
}

function headerValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
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
  response.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>CommitCast LinkedIn</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;background:#0b0f19;color:#eef3ff;padding:40px;max-width:720px;margin:auto}pre{white-space:pre-wrap;word-break:break-all;background:#151b28;padding:16px;border-radius:12px}a{color:#7c5cff}</style>
</head><body>${body}</body></html>`);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
