interface VercelRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelResponse {
  statusCode?: number;
  setHeader(name: string, value: string): void;
  redirect(statusOrUrl: number | string, url?: string): void;
  status(code: number): VercelResponse;
  send(body: string): void;
  end(body?: string): void;
}

export function linkedInRedirectUri(request: VercelRequest): string {
  const configured = process.env.LINKEDIN_REDIRECT_URI?.trim();
  if (configured) {
    return configured;
  }

  const protoHeader = headerValue(request.headers["x-forwarded-proto"]) ?? "https";
  const host =
    headerValue(request.headers["x-forwarded-host"]) ??
    headerValue(request.headers.host) ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    "localhost:4173";

  const protocol = host.includes("localhost") ? "http" : protoHeader;
  return `${protocol}://${host.replace(/^https?:\/\//, "")}/api/linkedin/callback`;
}

export function linkedInAuthorizeUrl(request: VercelRequest): string {
  const clientId = requireEnv("LINKEDIN_CLIENT_ID");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: linkedInRedirectUri(request),
    scope: "openid profile w_organization_social r_organization_social w_member_social",
    state: "commitcast",
  });

  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export type { VercelRequest, VercelResponse };
