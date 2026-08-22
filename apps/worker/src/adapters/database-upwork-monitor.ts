import type { UpworkJobSearchOutcome } from "@upwork-agent/core";
import {
  commitUpworkMonitorPoll,
  loadUpworkMonitorPollContext,
  type CommitUpworkMonitorPollResult,
  type Database,
  type LoadUpworkMonitorPollContextResult
} from "@upwork-agent/db";

export interface UpworkMonitorRepository {
  loadPollContext(input: {
    workspaceId: string;
    monitorId: string;
    scheduleVersion: number;
    runSequence: number;
    minimumPollIntervalSeconds: number;
  }): Promise<LoadUpworkMonitorPollContextResult>;
  commitPoll(input: {
    workspaceId: string;
    monitorId: string;
    scheduleVersion: number;
    runSequence: number;
    outcome: UpworkJobSearchOutcome;
  }): Promise<CommitUpworkMonitorPollResult>;
}

export function createDatabaseUpworkMonitorRepository(
  database: Database
): UpworkMonitorRepository {
  return {
    loadPollContext: (input) => loadUpworkMonitorPollContext(database, input),
    commitPoll: (input) => commitUpworkMonitorPoll(database, input)
  };
}
