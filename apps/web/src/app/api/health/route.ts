import { NextResponse } from "next/server";

import { knowledgeChunks, proposals, upworkConnections, workflowTasks, workspaces } from "@upwork-agent/db";

import { getDatabase } from "@/server/database";
import { isSchemaReady } from "@/server/health";

export const dynamic = "force-dynamic";

/** A readiness probe for the web process and its Postgres dependency. */
export async function GET() {
  try {
    const database = getDatabase();
    await Promise.all([
      database.select({ id: workspaces.id }).from(workspaces).limit(1),
      database.select({ id: workflowTasks.id }).from(workflowTasks).limit(1),
      database.select({ id: upworkConnections.id }).from(upworkConnections).limit(1),
      database.select({ id: knowledgeChunks.id, embedding: knowledgeChunks.embedding }).from(knowledgeChunks).limit(1),
      database.select({ id: proposals.id }).from(proposals).limit(1),
    ]);
    if (!isSchemaReady({
      embeddings: true,
      knowledgeChunks: true,
      proposals: true,
      upworkConnections: true,
      workflowTasks: true,
      workspaces: true,
    })) {
      return NextResponse.json(
        { status: "unavailable", database: "ok", schema: "unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ status: "ok", database: "ok", schema: "ok" });
  } catch {
    return NextResponse.json({ status: "unavailable", database: "unavailable" }, { status: 503 });
  }
}
