import {
  purgeExpiredUpworkData,
  type Database,
  type PurgeExpiredUpworkDataResult,
} from "@upwork-agent/db";

export interface UpworkRetentionRepository {
  purgeExpiredData(input: {
    workspaceId: string;
    connectionId: string;
    scheduleVersion: number;
    runSequence: number;
  }): Promise<PurgeExpiredUpworkDataResult>;
}

export function createDatabaseUpworkRetentionRepository(
  database: Database,
): UpworkRetentionRepository {
  return {
    purgeExpiredData: (input) => purgeExpiredUpworkData(database, input),
  };
}
