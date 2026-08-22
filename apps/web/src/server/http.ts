import { timingSafeEqual } from "node:crypto";

export function apiError(status: number, code: string) {
  return Response.json({ error: code }, { status });
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function constantTimeEqual(left: string | null, right: string | undefined): boolean {
  if (left === null || right === undefined) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
