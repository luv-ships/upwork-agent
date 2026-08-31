import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/server/supabase/server";
import { applicationUrl } from "@/server/app-url";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(applicationUrl("/sign-in"), { status: 303 });
}
