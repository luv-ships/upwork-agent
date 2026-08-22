import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
  strict: true,
  verbose: true,
});
