const DEFAULT_SCOPES = "openid profile email w_member_social";
const ORGANIZATION_SCOPES =
  "openid profile email w_member_social w_organization_social r_organization_social";

export default function handler(request, response) {
  try {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    if (!clientId) {
      throw new Error("Missing required environment variable: LINKEDIN_CLIENT_ID");
    }

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri(request),
      scope: resolveScopes(request),
      state: "commitcast",
    });

    response.redirect(302, `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.statusCode = 500;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(`CommitCast LinkedIn OAuth failed: ${message}`);
  }
}

function resolveScopes(request) {
  const configured = process.env.LINKEDIN_OAUTH_SCOPES?.trim();
  if (configured) {
    return configured;
  }

  const org = firstQuery(request.query?.org);
  if (org === "1" || org === "true") {
    return ORGANIZATION_SCOPES;
  }

  return DEFAULT_SCOPES;
}

function firstQuery(value) {
  if (Array.isArray(value)) {
    return value[0];
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
