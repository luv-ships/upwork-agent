import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { getServerEnvironment } from "@/server/env";
import { completeUpworkMcpOAuthAuthorization, getUpworkMcpOAuthSettings } from "@/server/upwork-oauth";

function campaignsUrl(request: NextRequest, result: string): URL {
  const url = new URL("/app/campaigns", request.url);
  url.searchParams.set("upwork", result);
  return url;
}

/** Completes a previously stored PKCE flow; callback error text is never reflected. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (user === null) return NextResponse.redirect(campaignsUrl(request, "sign_in_required"));

  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (state === null || code === null || request.nextUrl.searchParams.has("error")) {
    return NextResponse.redirect(campaignsUrl(request, "authorization_cancelled"));
  }

  try {
    const environment = getServerEnvironment();
    const settings = getUpworkMcpOAuthSettings({
      appUrl: environment.APP_URL,
      encryptionKey: environment.UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY,
      redirectUrl: environment.UPWORK_MCP_OAUTH_REDIRECT_URL
    });
    const issuer = request.nextUrl.searchParams.get("iss");
    await completeUpworkMcpOAuthAuthorization({
      database: getDatabase(),
      ownerUserId: user.id,
      state,
      code,
      ...(issuer === null ? {} : { issuer }),
      ...settings
    });
    return NextResponse.redirect(campaignsUrl(request, "connected"));
  } catch {
    return NextResponse.redirect(campaignsUrl(request, "authorization_failed"));
  }
}
