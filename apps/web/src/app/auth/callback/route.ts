import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/server/supabase/server";
import { safeAppNextPath } from "@/lib/safe-next-path";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextParameter = request.nextUrl.searchParams.get("next");
  const nextPath = safeAppNextPath(nextParameter);

  if (!code) {
    return NextResponse.redirect(new URL("/sign-in?error=missing_code", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/sign-in?error=oauth_callback", request.url));
  }

  // Workspace creation is completed lazily by the authenticated app layout.
  return NextResponse.redirect(new URL(nextPath, request.url));
}
