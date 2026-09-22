import { expiredSessionCookie } from "./_auth.js";

export default function handler(_request, response) {
  response.statusCode = 302;
  response.setHeader("Set-Cookie", expiredSessionCookie());
  response.setHeader("Location", "/login");
  response.end();
}
