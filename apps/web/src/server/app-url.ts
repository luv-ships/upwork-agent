import { getPublicEnvironment } from "./env";

export function applicationUrl(path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Application redirects must use an internal absolute path.");
  }

  return new URL(path, getPublicEnvironment().APP_URL);
}
