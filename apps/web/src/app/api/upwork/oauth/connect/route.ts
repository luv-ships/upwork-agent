import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { getServerEnvironment } from "@/server/env";
import { getUpworkMcpOAuthSettings, startUpworkMcpOAuthAuthorization } from "@/server/upwork-oauth";
import { applicationUrl } from "@/server/app-url";

function campaignsUrl(result: string): URL {
  const url = applicationUrl("/app/campaigns");
  url.searchParams.set("upwork", result);
  return url;
}

const connectCommandSchema = z.object({
  orgUid: z.string().trim().min(1).max(200)
});

/** Starts only the user-directed OAuth consent flow; it never searches jobs. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (user === null) return NextResponse.redirect(campaignsUrl("sign_in_required"));

  try {
    const environment = getServerEnvironment();
    if (request.headers.get("origin") !== new URL(environment.APP_URL).origin) {
      return NextResponse.redirect(campaignsUrl("invalid_origin"));
    }
    const command = connectCommandSchema.parse({
      orgUid: (await request.formData()).get("orgUid")
    });
    const settings = getUpworkMcpOAuthSettings({
      appUrl: environment.APP_URL,
      encryptionKey: environment.UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY,
      redirectUrl: environment.UPWORK_MCP_OAUTH_REDIRECT_URL
    });
    const authorizationUrl = await startUpworkMcpOAuthAuthorization({
      database: getDatabase(),
      ownerUserId: user.id,
      orgUid: command.orgUid,
      approvalReference: environment.UPWORK_MCP_APPROVAL_REFERENCE,
      ...settings
    });
    return NextResponse.redirect(authorizationUrl);
  } catch {
    return NextResponse.redirect(campaignsUrl("configuration_error"));
  }
}
