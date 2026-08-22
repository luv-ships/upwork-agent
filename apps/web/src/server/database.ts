import { createDatabase } from "@upwork-agent/db";

import { getServerEnvironment } from "@/server/env";

type Database = ReturnType<typeof createDatabase>;

const globalDatabase = globalThis as typeof globalThis & {
  signalFoundDatabase?: Database;
};

export function getDatabase(): Database {
  if (!globalDatabase.signalFoundDatabase) {
    globalDatabase.signalFoundDatabase = createDatabase(getServerEnvironment().DATABASE_URL);
  }

  return globalDatabase.signalFoundDatabase;
}
