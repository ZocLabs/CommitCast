import { linkedInAuthorizeUrl, type VercelRequest, type VercelResponse } from "./_shared.js";

export default function handler(request: VercelRequest, response: VercelResponse): void {
  try {
    response.redirect(302, linkedInAuthorizeUrl(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.statusCode = 500;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(`CommitCast LinkedIn OAuth failed: ${message}`);
  }
}
