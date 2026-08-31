import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { safeAppNextPath } from "@/lib/safe-next-path";
import { applicationUrl } from "@/server/app-url";

export async function GET(request: NextRequest) {
  try {
    const environment = getServerEnvironment();
    const supabase = await createSupabaseServerClient();
    const nextParameter = request.nextUrl.searchParams.get("next");
    const nextPath = safeAppNextPath(nextParameter);

    const callback = new URL("/auth/callback", environment.APP_URL);
    callback.searchParams.set("next", nextPath);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        scopes: "openid email profile",
        skipBrowserRedirect: true
      }
    });

    if (error || !data.url) {
      return NextResponse.redirect(new URL("/sign-in?error=oauth_start", environment.APP_URL));
    }

    return NextResponse.redirect(data.url);
  } catch {
    return NextResponse.redirect(applicationUrl("/sign-in?error=configuration"));
  }
}
