import { createHash, timingSafeEqual } from "node:crypto";

export function validInternalBearer(request: Request, expectedToken: string | undefined) {
  const authorization = request.headers.get("authorization");
  if (!expectedToken || !authorization?.startsWith("Bearer ")) return false;
  const providedToken = authorization.slice("Bearer ".length);
  const expectedDigest = createHash("sha256").update(expectedToken).digest();
  const providedDigest = createHash("sha256").update(providedToken).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}
