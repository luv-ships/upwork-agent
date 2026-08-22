import { z } from "zod";

import { getServerEnvironment } from "@/server/env";
import { apiError, constantTimeEqual } from "@/server/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const runtime = "nodejs";

const requestSchema = z.object({
  email: z.email(),
  password: z.string().min(12).max(200)
});

export async function POST(request: Request) {
  let environment: ReturnType<typeof getServerEnvironment>;
  try {
    environment = getServerEnvironment();
  } catch {
    return apiError(404, "not_found");
  }

  if (!environment.E2E_AUTH_ENABLED || environment.NODE_ENV === "production") {
    return apiError(404, "not_found");
  }
  if (!constantTimeEqual(request.headers.get("x-e2e-auth-token"), environment.E2E_AUTH_TOKEN)) {
    return apiError(401, "invalid_test_token");
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.email !== environment.E2E_AUTH_EMAIL) {
    return apiError(400, "invalid_test_identity");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return apiError(401, "test_sign_in_failed");
  return Response.json({ authenticated: true });
}
