import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/server/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/sign-in", request.url), { status: 303 });
}
