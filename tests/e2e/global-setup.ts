function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when RUN_E2E=true.`);
  return value;
}

function localSupabaseUrl(): URL {
  const url = new URL(required("SUPABASE_URL"));
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Playwright user setup is restricted to a local Supabase URL.");
  }
  return url;
}

async function checkedFetch(input: URL, init: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Local Supabase test-user setup failed with HTTP ${response.status}.`);
  }
  return response;
}

export default async function globalSetup(): Promise<void> {
  if (process.env.RUN_E2E !== "true") return;

  const supabaseUrl = localSupabaseUrl();
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const email = required("E2E_AUTH_EMAIL");
  const password = required("E2E_USER_PASSWORD");
  if (password.length < 12) throw new Error("E2E_USER_PASSWORD must contain at least 12 characters.");

  const headers = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json"
  };
  const listUrl = new URL("/auth/v1/admin/users?page=1&per_page=1000", supabaseUrl);
  const listResponse = await checkedFetch(listUrl, { headers });
  const listed: unknown = await listResponse.json();
  const users =
    typeof listed === "object" && listed !== null && "users" in listed && Array.isArray(listed.users)
      ? listed.users
      : [];
  const existing = users.find(
    (user): user is { id: string; email?: string } =>
      typeof user === "object" &&
      user !== null &&
      "id" in user &&
      typeof user.id === "string" &&
      "email" in user &&
      user.email === email
  );

  if (existing) {
    await checkedFetch(new URL(`/auth/v1/admin/users/${existing.id}`, supabaseUrl), {
      method: "PUT",
      headers,
      body: JSON.stringify({ password, email_confirm: true, user_metadata: { full_name: "E2E User" } })
    });
    return;
  }

  await checkedFetch(new URL("/auth/v1/admin/users", supabaseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "E2E User" } })
  });
}
