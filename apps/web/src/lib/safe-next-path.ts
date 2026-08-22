const safeOrigin = "https://signal-found.invalid";
const fallbackPath = "/app/campaigns";

export function safeAppNextPath(candidate: string | null | undefined): string {
  if (
    candidate === null ||
    candidate === undefined ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return fallbackPath;
  }

  try {
    const parsed = new URL(candidate, safeOrigin);
    const isAppPath = parsed.pathname === "/app" || parsed.pathname.startsWith("/app/");
    if (parsed.origin !== safeOrigin || !isAppPath || parsed.username || parsed.password) {
      return fallbackPath;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallbackPath;
  }
}
