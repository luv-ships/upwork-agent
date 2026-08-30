import { randomUUID } from "node:crypto";

import {
  createInputHash,
  emptyCampaignFilterV1,
  evaluateCampaignFilter,
  FakeAIProvider,
  normalizeDevelopmentJob,
  scoreJobPreference,
} from "@upwork-agent/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  aiScores,
  analyticsEvents,
  campaignJobMatches,
  claimWorkflowTask,
  closeDatabase,
  commitJobMatches,
  commitJobNormalization,
  commitMatchAnalysis,
  commitUpworkMonitorPoll,
  completeWorkflowTask,
  createCampaign,
  createDatabase,
  DevelopmentJobPayloadConflictError,
  disconnectUpworkOAuthConnection,
  enableConnectedUpworkMonitor,
  enableFakeUpworkMonitor,
  enqueueWorkflowTask,
  ensureWorkspaceForUser,
  getCampaign,
  getCampaignDetailView,
  getCampaignMonitorView,
  ingestDevelopmentJob,
  jobs,
  listCampaignMatchViews,
  loadJobForNormalization,
  loadJobMatchContext,
  loadMatchAnalysisContext,
  loadUpworkMonitorPollContext,
  pauseUpworkMonitor,
  purgeExpiredUpworkData,
  recoverExpiredWorkflowTasks,
  upworkConnections,
  upworkOAuthAuthorizations,
  upworkOAuthCredentials,
  workflowTasks,
  type Database,
} from "../src/index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe =
  testDatabaseUrl === undefined ? describe.skip : describe;

integrationDescribe("Phase 1 database integration", () => {
  let database: Database;
  const firstUserId = randomUUID();
  const secondUserId = randomUUID();
  const liveUserId = randomUUID();
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    if (testDatabaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required for database integration tests");
    }
    database = createDatabase(testDatabaseUrl, {
      applicationName: "upwork-agent-db-integration-test",
      maxConnections: 1,
    });
    await database.execute(sql`
      insert into auth.users (
        id,
        aud,
        role,
        email,
        encrypted_password,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      ) values
        (
          ${firstUserId},
          'authenticated',
          'authenticated',
          ${`${firstUserId}@example.test`},
          '',
          '{}'::jsonb,
          '{}'::jsonb,
          now(),
          now()
        ),
        (
          ${secondUserId},
          'authenticated',
          'authenticated',
          ${`${secondUserId}@example.test`},
          '',
          '{}'::jsonb,
          '{}'::jsonb,
          now(),
          now()
        ),
        (
          ${liveUserId},
          'authenticated',
          'authenticated',
          ${`${liveUserId}@example.test`},
          '',
          '{}'::jsonb,
          '{}'::jsonb,
          now(),
          now()
        )
    `);
  });

  afterAll(async () => {
    if (database !== undefined) {
      if (createdJobIds.length > 0) {
        await database.delete(jobs).where(inArray(jobs.id, createdJobIds));
      }
      await database.execute(sql`
        delete from auth.users where id in (${firstUserId}, ${secondUserId}, ${liveUserId})
      `);
      await closeDatabase(database);
    }
  });

  it("enforces owner scoping in campaign repositories", async () => {
    const workspace = await ensureWorkspaceForUser(database, {
      ownerUserId: firstUserId,
      name: "First workspace",
    });
    const secondWorkspace = await ensureWorkspaceForUser(database, {
      ownerUserId: secondUserId,
      name: "Second workspace",
    });
    const campaign = await createCampaign(database, {
      ownerUserId: firstUserId,
      workspaceId: workspace.id,
      name: "AI automation",
      filters: emptyCampaignFilterV1,
      aiInstructions: "Prefer bounded automation projects.",
      status: "active",
    });
    expect(campaign).not.toBeNull();
    if (campaign === null) {
      throw new Error("Campaign was not created");
    }

    await expect(
      createCampaign(database, {
        ownerUserId: firstUserId,
        workspaceId: secondWorkspace.id,
        name: "Cross-workspace campaign",
        filters: emptyCampaignFilterV1,
        aiInstructions: "",
        status: "active",
      }),
    ).resolves.toBeNull();

    await expect(
      getCampaign(database, {
        ownerUserId: secondUserId,
        campaignId: campaign.id,
      }),
    ).resolves.toBeNull();
  });

  it("deduplicates, leases, recovers, and completes durable tasks", async () => {
    const workspace = await ensureWorkspaceForUser(database, {
      ownerUserId: firstUserId,
      name: "First workspace",
    });
    const jobId = randomUUID();
    const input = {
      workspaceId: workspace.id,
      kind: "normalize-job" as const,
      payload: { jobId, sourcePayloadHash: "a".repeat(64) },
      dedupeKey: `integration:${randomUUID()}`,
      priority: 32_767,
    };
    const first = await enqueueWorkflowTask(database, input);
    const duplicate = await enqueueWorkflowTask(database, input);
    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.task.id).toBe(first.task.id);

    const claimedAt = new Date("2030-01-01T00:00:00.000Z");
    const firstClaim = await claimWorkflowTask(database, {
      workerId: "integration-worker-1",
      leaseDurationMs: 1_000,
      now: claimedAt,
    });
    expect(firstClaim?.id).toBe(first.task.id);
    expect(firstClaim?.attemptCount).toBe(1);

    await expect(
      recoverExpiredWorkflowTasks(database, {
        now: new Date("2030-01-01T00:00:02.000Z"),
      }),
    ).resolves.toBe(1);

    const secondClaim = await claimWorkflowTask(database, {
      workerId: "integration-worker-2",
      leaseDurationMs: 60_000,
      now: new Date("2030-01-01T00:00:04.000Z"),
    });
    expect(secondClaim?.id).toBe(first.task.id);
    expect(secondClaim?.attemptCount).toBe(2);
    await expect(
      completeWorkflowTask(database, {
        taskId: first.task.id,
        workerId: "integration-worker-2",
        now: new Date("2030-01-01T00:00:05.000Z"),
      }),
    ).resolves.toBe(true);
  });

  it("keeps the original job when a source ID is reused with changed content", async () => {
    const workspace = await ensureWorkspaceForUser(database, {
      ownerUserId: secondUserId,
      name: "Second workspace",
    });
    const campaign = await createCampaign(database, {
      ownerUserId: secondUserId,
      workspaceId: workspace.id,
      name: `Conflict test ${randomUUID()}`,
      filters: emptyCampaignFilterV1,
      aiInstructions: "",
      status: "active",
    });
    if (campaign === null) {
      throw new Error("Conflict-test campaign was not created");
    }
    const originalJob = {
      sourceJobId: randomUUID(),
      title: "Original automation job",
      description: "The original immutable development payload.",
      skills: ["Make.com"],
      categoryIds: ["automation"],
      jobType: "fixed" as const,
      fixedBudget: { currency: "USD" as const, min: 500, max: 750 },
    };
    const originalHash = createInputHash(originalJob);
    const originalIngest = await ingestDevelopmentJob(database, {
      ownerUserId: secondUserId,
      workspaceId: workspace.id,
      input: originalJob,
      sourcePayloadHash: originalHash,
    });
    if (originalIngest === null) {
      throw new Error("Original conflict-test job was not ingested");
    }
    createdJobIds.push(originalIngest.jobId);

    const initialDetail = await getCampaignDetailView(database, {
      ownerUserId: secondUserId,
      campaignId: campaign.id,
    });
    expect(initialDetail).toMatchObject({
      matches: [],
      upstreamWork: {
        hasActiveTasks: true,
        hasLatestFailure: false,
        latestTaskStatus: "queued",
      },
    });

    const changedJob = {
      ...originalJob,
      description: "Changed content must not replace the original payload.",
    };
    await expect(
      ingestDevelopmentJob(database, {
        ownerUserId: secondUserId,
        workspaceId: workspace.id,
        input: changedJob,
        sourcePayloadHash: createInputHash(changedJob),
      }),
    ).rejects.toBeInstanceOf(DevelopmentJobPayloadConflictError);

    const persistedRows = await database
      .select({
        id: jobs.id,
        rawPayload: jobs.rawPayload,
        sourcePayloadHash: jobs.sourcePayloadHash,
      })
      .from(jobs)
      .where(eq(jobs.id, originalIngest.jobId));
    expect(persistedRows).toEqual([
      {
        id: originalIngest.jobId,
        rawPayload: originalJob,
        sourcePayloadHash: originalHash,
      },
    ]);
  });

  it("persists the score loop idempotently", async () => {
    const workspace = await ensureWorkspaceForUser(database, {
      ownerUserId: firstUserId,
      name: "First workspace",
    });
    const campaign = await createCampaign(database, {
      ownerUserId: firstUserId,
      workspaceId: workspace.id,
      name: `Score loop ${randomUUID()}`,
      filters: emptyCampaignFilterV1,
      aiInstructions: "Prefer a clear fixed-price scope.",
      status: "active",
    });
    if (campaign === null) {
      throw new Error("Campaign was not created");
    }
    const developmentJob = {
      sourceJobId: randomUUID(),
      title: "Build a Make.com and OpenAI workflow",
      description: "Create a bounded automation and document the handoff.",
      skills: ["Make.com", "OpenAI"],
      categoryIds: ["automation"],
      jobType: "fixed" as const,
      fixedBudget: { currency: "USD" as const, min: 1_000, max: 2_000 },
      paymentVerified: true,
    };
    const sourcePayloadHash = createInputHash(developmentJob);
    const firstIngest = await ingestDevelopmentJob(database, {
      ownerUserId: firstUserId,
      workspaceId: workspace.id,
      input: developmentJob,
      sourcePayloadHash,
    });
    const duplicateIngest = await ingestDevelopmentJob(database, {
      ownerUserId: firstUserId,
      workspaceId: workspace.id,
      input: developmentJob,
      sourcePayloadHash,
    });
    expect(firstIngest).not.toBeNull();
    expect(duplicateIngest).toMatchObject({
      duplicate: true,
      jobId: firstIngest?.jobId,
      taskId: firstIngest?.taskId,
    });
    if (firstIngest === null) {
      throw new Error("Development job was not ingested");
    }
    createdJobIds.push(firstIngest.jobId);

    const normalizeContext = await loadJobForNormalization(database, {
      workspaceId: workspace.id,
      jobId: firstIngest.jobId,
      sourcePayloadHash,
    });
    if (normalizeContext.status !== "ready") {
      throw new Error("Job normalization context was not ready");
    }
    const normalizedJob = normalizeDevelopmentJob(normalizeContext.rawPayload);
    const normalizedHash = createInputHash(normalizedJob);
    const normalized = await commitJobNormalization(database, {
      workspaceId: workspace.id,
      jobId: firstIngest.jobId,
      sourcePayloadHash,
      normalizedJob,
      normalizedHash,
    });
    if (normalized.status !== "committed") {
      throw new Error("Job normalization was not committed");
    }
    await expect(
      loadJobForNormalization(database, {
        workspaceId: workspace.id,
        jobId: firstIngest.jobId,
        sourcePayloadHash,
      }),
    ).resolves.toEqual({ status: "skip" });

    const matchContext = await loadJobMatchContext(database, {
      workspaceId: workspace.id,
      jobId: firstIngest.jobId,
      normalizedRevision: normalized.normalizedRevision,
    });
    if (matchContext.status !== "ready") {
      throw new Error("Job match context was not ready");
    }
    const campaignContext = matchContext.campaigns.find(
      (candidate) => candidate.id === campaign.id,
    );
    if (campaignContext === undefined) {
      throw new Error("Active campaign was not loaded for matching");
    }
    const decision = evaluateCampaignFilter(campaignContext.filters, normalizedJob);
    expect(decision.matched).toBe(true);
    const preferenceScore = scoreJobPreference(
      campaignContext.filters,
      normalizedJob,
      decision.evidence,
    );
    const analysisInputHash = createInputHash({
      campaignId: campaign.id,
      campaignConfigVersion: campaign.configVersion,
      job: normalizedJob,
      jobRevision: normalized.normalizedRevision,
      deterministicEvidence: decision.evidence,
      preferenceScore,
      promptVersion: "suitability-v1",
      suitabilityContractVersion: "structured-suitability-v1",
    });
    const matchInput = {
      workspaceId: workspace.id,
      jobId: firstIngest.jobId,
      normalizedRevision: normalized.normalizedRevision,
      matches: [
        {
          campaignId: campaign.id,
          campaignConfigVersion: campaign.configVersion,
          filterSnapshot: campaign.filters,
          deterministicEvidence: decision.evidence,
          preferenceScore,
          analysisInputHash,
        },
      ],
    };
    await expect(commitJobMatches(database, matchInput)).resolves.toEqual({
      status: "committed",
      matchCount: 1,
      taskCount: 1,
    });
    await expect(commitJobMatches(database, matchInput)).resolves.toEqual({
      status: "committed",
      matchCount: 0,
      taskCount: 0,
    });

    const views = await listCampaignMatchViews(database, {
      ownerUserId: firstUserId,
      campaignId: campaign.id,
    });
    expect(views).toHaveLength(1);
    const matchId = views[0]?.match.id;
    if (matchId === undefined) {
      throw new Error("Persisted match was not visible");
    }
    const analysisContext = await loadMatchAnalysisContext(database, {
      workspaceId: workspace.id,
      matchId,
      inputHash: analysisInputHash,
    });
    if (analysisContext.status !== "ready") {
      throw new Error("Analysis context was not ready");
    }
    const result = await new FakeAIProvider().assessSuitability(
      analysisContext.input,
    );
    const scoreInput = {
      workspaceId: workspace.id,
      matchId,
      inputHash: analysisInputHash,
      result,
      provider: "fake",
      model: "fake-suitability-v1",
      promptVersion: "suitability-v1",
    };
    const firstScore = await commitMatchAnalysis(database, scoreInput);
    const duplicateScore = await commitMatchAnalysis(database, scoreInput);
    expect(firstScore).toMatchObject({
      status: "committed",
      pipelineStatus: "proposal_queued",
    });
    expect(duplicateScore).toEqual(firstScore);
    const proposalTasks = await database
      .select({ id: workflowTasks.id })
      .from(workflowTasks)
      .where(
        and(
          eq(workflowTasks.workspaceId, workspace.id),
          eq(workflowTasks.kind, "generate-proposal"),
        ),
      );
    expect(proposalTasks).toHaveLength(1);

    const completedViews = await listCampaignMatchViews(database, {
      ownerUserId: firstUserId,
      campaignId: campaign.id,
    });
    expect(completedViews).toHaveLength(1);
    expect(completedViews[0]?.score?.score).toBe(result.score);
  });

  it("persists one durable successor for each idempotent monitor run", async () => {
    const workspace = await ensureWorkspaceForUser(database, {
      ownerUserId: firstUserId,
      name: "First workspace",
    });
    const campaign = await createCampaign(database, {
      ownerUserId: firstUserId,
      workspaceId: workspace.id,
      name: `Monitor ${randomUUID()}`,
      filters: emptyCampaignFilterV1,
      aiInstructions: "Prefer automation work.",
      status: "active",
    });
    if (campaign === null) {
      throw new Error("Monitor campaign was not created");
    }
    const unmonitoredCampaign = await createCampaign(database, {
      ownerUserId: firstUserId,
      workspaceId: workspace.id,
      name: `Unmonitored ${randomUUID()}`,
      filters: emptyCampaignFilterV1,
      aiInstructions: "This active campaign must not receive MCP jobs while unmonitored.",
      status: "active",
    });
    if (unmonitoredCampaign === null) {
      throw new Error("Unmonitored campaign was not created");
    }
    const secondMonitoredCampaign = await createCampaign(database, {
      ownerUserId: firstUserId,
      workspaceId: workspace.id,
      name: `Second monitored ${randomUUID()}`,
      filters: emptyCampaignFilterV1,
      aiInstructions: "A second monitor should only see jobs it discovered.",
      status: "active",
    });
    if (secondMonitoredCampaign === null) {
      throw new Error("Second monitored campaign was not created");
    }
    const startedAt = new Date("2040-01-01T00:00:00.000Z");
    const monitor = await enableFakeUpworkMonitor(database, {
      ownerUserId: firstUserId,
      campaignId: campaign.id,
      pollIntervalSeconds: 300,
      minimumPollIntervalSeconds: 300,
      approvalReference: "integration-fake",
      now: startedAt,
    });
    expect(monitor).toMatchObject({
      status: "active",
      scheduleVersion: 1,
      nextRunSequence: 1,
      connectionStatus: "fake",
    });
    if (monitor === null) {
      throw new Error("Monitor was not enabled");
    }
    const secondMonitor = await enableFakeUpworkMonitor(database, {
      ownerUserId: firstUserId,
      campaignId: secondMonitoredCampaign.id,
      pollIntervalSeconds: 300,
      minimumPollIntervalSeconds: 300,
      approvalReference: "integration-fake",
      now: startedAt,
    });
    expect(secondMonitor).toMatchObject({ status: "active", connectionStatus: "fake" });
    if (secondMonitor === null) {
      throw new Error("Second monitor was not enabled");
    }
    await expect(
      getCampaignMonitorView(database, {
        ownerUserId: secondUserId,
        campaignId: campaign.id,
      }),
    ).resolves.toBeNull();

    const context = await loadUpworkMonitorPollContext(database, {
      workspaceId: workspace.id,
      monitorId: monitor.id,
      scheduleVersion: 1,
      runSequence: 1,
      minimumPollIntervalSeconds: 300,
    });
    expect(context.status).toBe("ready");

    const externalJobId = randomUUID();
    const outcome = {
      kind: "page" as const,
      jobs: [
        {
          externalJobId,
          title: "Build an OpenAI automation",
          description: "Connect a workflow and document the result.",
          skills: ["OpenAI", "Make.com"],
          categoryIds: ["automation"],
          jobType: "fixed" as const,
          fixedBudget: { currency: "USD" as const, min: 1_000, max: 2_000 },
          proposalCount: 2,
          paymentVerified: true,
        },
      ],
    };
    const committedAt = new Date("2040-01-01T00:00:01.000Z");
    await expect(
      commitUpworkMonitorPoll(database, {
        workspaceId: workspace.id,
        monitorId: monitor.id,
        scheduleVersion: 1,
        runSequence: 1,
        outcome,
        now: committedAt,
      }),
    ).resolves.toMatchObject({
      status: "committed",
      jobsSeen: 1,
      jobsQueued: 1,
      nextRunAt: new Date("2040-01-01T00:05:01.000Z"),
    });
    await expect(
      commitUpworkMonitorPoll(database, {
        workspaceId: workspace.id,
        monitorId: monitor.id,
        scheduleVersion: 1,
        runSequence: 1,
        outcome,
        now: committedAt,
      }),
    ).resolves.toEqual({
      status: "skip",
      jobsSeen: 0,
      jobsQueued: 0,
      nextRunAt: null,
    });

    const persistedJobs = await database
      .select({ id: jobs.id, sourcePayloadHash: jobs.sourcePayloadHash })
      .from(jobs)
      .where(
        eq(jobs.sourceJobId, `${workspace.id}:${externalJobId}`),
      );
    expect(persistedJobs).toHaveLength(1);
    const persistedJobId = persistedJobs[0]?.id;
    const persistedSourcePayloadHash = persistedJobs[0]?.sourcePayloadHash;
    if (persistedJobId !== undefined) createdJobIds.push(persistedJobId);

    const monitorTasks = await database
      .select({ kind: workflowTasks.kind, payload: workflowTasks.payload })
      .from(workflowTasks)
      .where(eq(workflowTasks.workspaceId, workspace.id));
    expect(
      monitorTasks.filter(
        (candidate) =>
          candidate.kind === "poll-upwork-monitor" &&
          candidate.payload.monitorId === monitor.id,
      ),
    ).toHaveLength(2);
    expect(
      monitorTasks.filter(
        (candidate) =>
          candidate.kind === "normalize-job" &&
          candidate.payload.jobId === persistedJobId,
      ),
    ).toHaveLength(1);

    if (persistedJobId === undefined || persistedSourcePayloadHash === undefined) {
      throw new Error("Persisted Upwork job was not available for tenant matching checks");
    }
    const normalizationContext = await loadJobForNormalization(database, {
      workspaceId: workspace.id,
      jobId: persistedJobId,
      sourcePayloadHash: persistedSourcePayloadHash,
    });
    if (normalizationContext.status !== "ready") {
      throw new Error("Persisted Upwork job was not ready for normalization");
    }
    const normalizedJob = normalizeDevelopmentJob(normalizationContext.rawPayload);
    const normalizedJobHash = createInputHash(normalizedJob);
    const normalizationResult = await commitJobNormalization(database, {
      workspaceId: workspace.id,
      jobId: persistedJobId,
      sourcePayloadHash: normalizationContext.sourcePayloadHash,
      normalizedJob,
      normalizedHash: normalizedJobHash,
    });
    if (normalizationResult.status !== "committed") {
      throw new Error("Persisted Upwork job normalization did not commit");
    }
    const activeMatchContext = await loadJobMatchContext(database, {
      workspaceId: workspace.id,
      jobId: persistedJobId,
      normalizedRevision: normalizationResult.normalizedRevision,
    });
    if (activeMatchContext.status !== "ready") {
      throw new Error("Persisted Upwork job did not reach matching");
    }
    expect(activeMatchContext.campaigns.map((candidate) => candidate.id)).toContain(
      campaign.id,
    );
    expect(activeMatchContext.campaigns.map((candidate) => candidate.id)).not.toContain(
      unmonitoredCampaign.id,
    );
    expect(activeMatchContext.campaigns.map((candidate) => candidate.id)).not.toContain(
      secondMonitoredCampaign.id,
    );

    const secondContext = await loadUpworkMonitorPollContext(database, {
      workspaceId: workspace.id,
      monitorId: secondMonitor.id,
      scheduleVersion: secondMonitor.scheduleVersion,
      runSequence: secondMonitor.nextRunSequence,
      minimumPollIntervalSeconds: 300,
      now: new Date("2040-01-01T00:00:01.500Z"),
    });
    expect(secondContext.status).toBe("ready");
    if (secondContext.status !== "ready") {
      throw new Error("Second monitor was not ready to poll");
    }
    await expect(
      commitUpworkMonitorPoll(database, {
        workspaceId: workspace.id,
        monitorId: secondMonitor.id,
        scheduleVersion: secondContext.scheduleVersion,
        runSequence: secondContext.runSequence,
        outcome,
        now: new Date("2040-01-01T00:00:01.500Z"),
      }),
    ).resolves.toMatchObject({ status: "committed", jobsSeen: 1 });
    const bothMatchContext = await loadJobMatchContext(database, {
      workspaceId: workspace.id,
      jobId: persistedJobId,
      normalizedRevision: normalizationResult.normalizedRevision,
    });
    if (bothMatchContext.status !== "ready") {
      throw new Error("Observed Upwork job did not retain both monitor campaigns");
    }
    expect(bothMatchContext.campaigns.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining([campaign.id, secondMonitoredCampaign.id]),
    );

    const paused = await pauseUpworkMonitor(database, {
      ownerUserId: firstUserId,
      campaignId: campaign.id,
      now: new Date("2040-01-01T00:00:02.000Z"),
    });
    expect(paused).toMatchObject({ status: "paused", nextRunAt: null });
    const secondPaused = await pauseUpworkMonitor(database, {
      ownerUserId: firstUserId,
      campaignId: secondMonitoredCampaign.id,
      now: new Date("2040-01-01T00:00:02.000Z"),
    });
    expect(secondPaused).toMatchObject({ status: "paused", nextRunAt: null });
    const pausedMatchContext = await loadJobMatchContext(database, {
      workspaceId: workspace.id,
      jobId: persistedJobId,
      normalizedRevision: normalizationResult.normalizedRevision,
    });
    expect(pausedMatchContext).toMatchObject({ status: "ready", campaigns: [] });
    await expect(
      loadUpworkMonitorPollContext(database, {
        workspaceId: workspace.id,
        monitorId: monitor.id,
        scheduleVersion: 1,
        runSequence: 2,
        minimumPollIntervalSeconds: 300,
      }),
    ).resolves.toEqual({ status: "skip" });
  });

  it("serializes live MCP polls per connection and erases OAuth material on disconnect", async () => {
    const workspace = await ensureWorkspaceForUser(database, {
      ownerUserId: liveUserId,
      name: "Live MCP workspace"
    });
    const startedAt = new Date("2045-01-01T00:00:00.000Z");
    const connectionRows = await database
      .insert(upworkConnections)
      .values({
        workspaceId: workspace.id,
        status: "connected",
        accountId: "1936403733578252377",
        credentialRef: "database-encrypted-v1",
        approvalReference: "integration-live-approval",
        nextRequestAt: startedAt,
        nextPurgeAt: startedAt
      })
      .returning({ id: upworkConnections.id });
    const connectionId = connectionRows[0]?.id;
    if (connectionId === undefined) throw new Error("Live connection was not inserted");
    await database.insert(upworkOAuthCredentials).values({
      workspaceId: workspace.id,
      connectionId,
      encryptedPayload: "ciphertext-credential-placeholder"
    });
    await database.insert(upworkOAuthAuthorizations).values({
      workspaceId: workspace.id,
      connectionId,
      encryptedPayload: "ciphertext-authorization-placeholder"
    });

    const firstCampaign = await createCampaign(database, {
      ownerUserId: liveUserId,
      workspaceId: workspace.id,
      name: `Live monitor A ${randomUUID()}`,
      filters: emptyCampaignFilterV1,
      aiInstructions: "Score live read-only jobs.",
      status: "active"
    });
    const secondCampaign = await createCampaign(database, {
      ownerUserId: liveUserId,
      workspaceId: workspace.id,
      name: `Live monitor B ${randomUUID()}`,
      filters: emptyCampaignFilterV1,
      aiInstructions: "Score live read-only jobs.",
      status: "active"
    });
    if (firstCampaign === null || secondCampaign === null) {
      throw new Error("Live campaigns were not created");
    }
    const firstMonitor = await enableConnectedUpworkMonitor(database, {
      ownerUserId: liveUserId,
      campaignId: firstCampaign.id,
      pollIntervalSeconds: 300,
      minimumPollIntervalSeconds: 300,
      approvalReference: "integration-live-approval",
      now: startedAt
    });
    const secondMonitor = await enableConnectedUpworkMonitor(database, {
      ownerUserId: liveUserId,
      campaignId: secondCampaign.id,
      pollIntervalSeconds: 300,
      minimumPollIntervalSeconds: 300,
      approvalReference: "integration-live-approval",
      now: startedAt
    });
    if (firstMonitor === null || secondMonitor === null) {
      throw new Error("Live monitors were not enabled");
    }

    await expect(
      loadUpworkMonitorPollContext(database, {
        workspaceId: workspace.id,
        monitorId: firstMonitor.id,
        scheduleVersion: 1,
        runSequence: 1,
        minimumPollIntervalSeconds: 300,
        now: startedAt
      })
    ).resolves.toMatchObject({ status: "ready", connectionStatus: "connected" });
    await expect(
      loadUpworkMonitorPollContext(database, {
        workspaceId: workspace.id,
        monitorId: secondMonitor.id,
        scheduleVersion: 1,
        runSequence: 1,
        minimumPollIntervalSeconds: 300,
        now: startedAt
      })
    ).resolves.toEqual({ status: "skip" });
    await expect(
      getCampaignMonitorView(database, {
        ownerUserId: liveUserId,
        campaignId: secondCampaign.id
      })
    ).resolves.toMatchObject({
      nextRunSequence: 2,
      nextRunAt: new Date("2045-01-01T00:05:00.000Z")
    });

    await expect(
      disconnectUpworkOAuthConnection(database, { ownerUserId: liveUserId })
    ).resolves.toBe(true);
    await expect(
      database
        .select({ connectionId: upworkOAuthCredentials.connectionId })
        .from(upworkOAuthCredentials)
        .where(eq(upworkOAuthCredentials.connectionId, connectionId))
    ).resolves.toEqual([]);
    await expect(
      database
        .select({ connectionId: upworkOAuthAuthorizations.connectionId })
        .from(upworkOAuthAuthorizations)
        .where(eq(upworkOAuthAuthorizations.connectionId, connectionId))
    ).resolves.toEqual([]);
    const disconnectedRows = await database
      .select({
        status: upworkConnections.status,
        accountId: upworkConnections.accountId,
        credentialRef: upworkConnections.credentialRef
      })
      .from(upworkConnections)
      .where(eq(upworkConnections.id, connectionId));
    expect(disconnectedRows[0]).toEqual({
      status: "disabled",
      accountId: null,
      credentialRef: null
    });
  });

  it("purges 30-day MCP data tenant-safely while its monitor is paused", async () => {
    const workspace = await ensureWorkspaceForUser(database, {
      ownerUserId: secondUserId,
      name: "Second workspace",
    });
    const otherWorkspace = await ensureWorkspaceForUser(database, {
      ownerUserId: firstUserId,
      name: "First workspace",
    });
    const campaign = await createCampaign(database, {
      ownerUserId: secondUserId,
      workspaceId: workspace.id,
      name: `Retention ${randomUUID()}`,
      filters: emptyCampaignFilterV1,
      aiInstructions: "Retain MCP-derived data for no more than 30 days.",
      status: "active",
    });
    if (campaign === null) {
      throw new Error("Retention campaign was not created");
    }

    const scheduleStartedAt = new Date("2050-01-01T00:00:00.000Z");
    const monitor = await enableFakeUpworkMonitor(database, {
      ownerUserId: secondUserId,
      campaignId: campaign.id,
      pollIntervalSeconds: 300,
      minimumPollIntervalSeconds: 300,
      approvalReference: "integration-retention",
      now: scheduleStartedAt,
    });
    if (monitor === null) {
      throw new Error("Retention monitor was not created");
    }
    await pauseUpworkMonitor(database, {
      ownerUserId: secondUserId,
      campaignId: campaign.id,
      now: new Date("2050-01-01T00:00:01.000Z"),
    });

    const connectionRows = await database
      .select()
      .from(upworkConnections)
      .where(eq(upworkConnections.workspaceId, workspace.id))
      .limit(1);
    const connection = connectionRows[0];
    if (connection === undefined) {
      throw new Error("Retention connection was not available");
    }

    const purgeAt = new Date("2050-02-01T00:00:00.000Z");
    const cutoffAt = new Date(purgeAt.getTime() - 30 * 24 * 60 * 60 * 1_000);
    const freshLastSeenAt = new Date(cutoffAt.getTime() + 60 * 60 * 1_000);
    const sourceInput = {
      sourceJobId: randomUUID(),
      title: "Build a retained automation",
      description: "This bounded MCP job exercises tenant-safe retention cleanup.",
      skills: ["OpenAI", "Make.com"],
      categoryIds: ["automation"],
      jobType: "fixed" as const,
      fixedBudget: { currency: "USD" as const, min: 1_000, max: 2_000 },
      proposalCount: 2,
      paymentVerified: true,
    };
    const normalizedJob = normalizeDevelopmentJob(sourceInput);
    const normalizedHash = createInputHash(normalizedJob);

    const insertedJobs = await database
      .insert(jobs)
      .values([
        {
          workspaceId: workspace.id,
          source: "upwork_mcp",
          sourceJobId: `${workspace.id}:${sourceInput.sourceJobId}`,
          rawPayload: sourceInput,
          sourcePayloadHash: createInputHash(sourceInput),
          normalizedHash,
          revision: 1,
          lastMatchedRevision: 1,
          status: "ready",
          title: normalizedJob.title,
          description: normalizedJob.description,
          skills: normalizedJob.skills,
          categoryIds: normalizedJob.categoryIds,
          jobType: normalizedJob.jobType,
          fixedBudgetMin: String(normalizedJob.fixedBudget?.min),
          fixedBudgetMax: String(normalizedJob.fixedBudget?.max),
          proposalCount: normalizedJob.proposalCount,
          paymentVerified: normalizedJob.paymentVerified,
          lastSeenAt: cutoffAt,
        },
        {
          workspaceId: workspace.id,
          source: "upwork_mcp",
          sourceJobId: `${workspace.id}:${randomUUID()}`,
          rawPayload: { ...sourceInput, sourceJobId: randomUUID() },
          sourcePayloadHash: "c".repeat(64),
          status: "received",
          lastSeenAt: freshLastSeenAt,
        },
        {
          workspaceId: workspace.id,
          source: "development",
          sourceJobId: `${workspace.id}:${randomUUID()}`,
          rawPayload: { ...sourceInput, sourceJobId: randomUUID() },
          sourcePayloadHash: "d".repeat(64),
          status: "received",
          lastSeenAt: cutoffAt,
        },
        {
          workspaceId: otherWorkspace.id,
          source: "upwork_mcp",
          sourceJobId: `${otherWorkspace.id}:${randomUUID()}`,
          rawPayload: { ...sourceInput, sourceJobId: randomUUID() },
          sourcePayloadHash: "e".repeat(64),
          status: "received",
          lastSeenAt: cutoffAt,
        },
      ])
      .returning({ id: jobs.id, workspaceId: jobs.workspaceId, source: jobs.source });
    const expiredJob = insertedJobs[0];
    const freshJob = insertedJobs[1];
    const developmentJob = insertedJobs[2];
    const otherTenantJob = insertedJobs[3];
    if (
      expiredJob === undefined ||
      freshJob === undefined ||
      developmentJob === undefined ||
      otherTenantJob === undefined
    ) {
      throw new Error("Retention fixtures were not inserted");
    }
    createdJobIds.push(
      expiredJob.id,
      freshJob.id,
      developmentJob.id,
      otherTenantJob.id,
    );

    const decision = evaluateCampaignFilter(emptyCampaignFilterV1, normalizedJob);
    if (!decision.matched) {
      throw new Error("Retention fixture unexpectedly failed the empty filter");
    }
    const preferenceScore = scoreJobPreference(
      emptyCampaignFilterV1,
      normalizedJob,
      decision.evidence,
    );
    const analysisInputHash = "b".repeat(64);
    const matchValues = {
      workspaceId: workspace.id,
      campaignId: campaign.id,
      campaignConfigVersion: campaign.configVersion,
      jobRevision: 1,
      filterSnapshot: emptyCampaignFilterV1,
      aiInstructionsSnapshot: campaign.aiInstructions,
      scoreThresholdSnapshot: campaign.scoreThreshold,
      deterministicEvidence: decision.evidence,
      preferenceScore: preferenceScore.score,
      preferenceScoreVersion: preferenceScore.version,
      preferenceScoreEvidence: preferenceScore,
      analysisInputHash,
      pipelineStatus: "qualified" as const,
    };

    await expect(
      database.insert(campaignJobMatches).values({
        ...matchValues,
        jobId: otherTenantJob.id,
      }),
    ).rejects.toThrow();

    const matchRows = await database
      .insert(campaignJobMatches)
      .values({ ...matchValues, jobId: expiredJob.id })
      .returning({ id: campaignJobMatches.id });
    const matchId = matchRows[0]?.id;
    if (matchId === undefined) {
      throw new Error("Retention match was not inserted");
    }
    const scoreRows = await database
      .insert(aiScores)
      .values({
        workspaceId: workspace.id,
        matchId,
        inputHash: analysisInputHash,
        provider: "fake",
        model: "fake-retention-v1",
        promptVersion: "retention-test-v1",
        providerRequestKey: `fake:${matchId}:${analysisInputHash}`,
        score: 80,
        recommendation: "review",
        reasons: ["Bounded retention fixture"],
        risks: [],
        estimatedWinProbability: "0.5000",
        pricingDirection: "market",
      })
      .returning({ id: aiScores.id });
    const scoreId = scoreRows[0]?.id;
    if (scoreId === undefined) {
      throw new Error("Retention score was not inserted");
    }
    const eventRows = await database
      .insert(analyticsEvents)
      .values({
        workspaceId: workspace.id,
        eventName: "ai_score.completed",
        subjectType: "campaign_job_match",
        subjectId: matchId,
        properties: { score: 80 },
        dedupeKey: `retention:${matchId}`,
      })
      .returning({ id: analyticsEvents.id });
    const eventId = eventRows[0]?.id;
    if (eventId === undefined) {
      throw new Error("Retention event was not inserted");
    }

    const relatedTasks = await Promise.all([
      enqueueWorkflowTask(database, {
        workspaceId: workspace.id,
        kind: "normalize-job",
        payload: { jobId: expiredJob.id, sourcePayloadHash: createInputHash(sourceInput) },
        dedupeKey: `retention-normalize:${expiredJob.id}`,
      }),
      enqueueWorkflowTask(database, {
        workspaceId: workspace.id,
        kind: "match-job",
        payload: { jobId: expiredJob.id, normalizedRevision: 1 },
        dedupeKey: `retention-match:${expiredJob.id}`,
      }),
      enqueueWorkflowTask(database, {
        workspaceId: workspace.id,
        kind: "analyze-match",
        payload: { matchId, inputHash: analysisInputHash },
        dedupeKey: `retention-analyze:${matchId}`,
      }),
    ]);
    const relatedTaskIds = relatedTasks.map((result) => result.task.id);

    const purgeInput = {
      workspaceId: workspace.id,
      connectionId: connection.id,
      scheduleVersion: connection.purgeScheduleVersion,
      runSequence: connection.nextPurgeSequence,
      now: purgeAt,
    };
    await expect(purgeExpiredUpworkData(database, purgeInput)).resolves.toEqual({
      status: "committed",
      deletedJobs: 1,
      deletedMatches: 1,
      deletedAiScores: 1,
      deletedWorkflowTasks: 3,
      deletedAnalyticsEvents: 1,
      nextRunAt: new Date(freshLastSeenAt.getTime() + 30 * 24 * 60 * 60 * 1_000),
    });
    await expect(purgeExpiredUpworkData(database, purgeInput)).resolves.toEqual({
      status: "skip",
      deletedJobs: 0,
      deletedMatches: 0,
      deletedAiScores: 0,
      deletedWorkflowTasks: 0,
      deletedAnalyticsEvents: 0,
      nextRunAt: null,
    });

    await expect(
      database.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, expiredJob.id)),
    ).resolves.toEqual([]);
    const retainedJobRows = await database
      .select({ id: jobs.id })
      .from(jobs)
      .where(inArray(jobs.id, [freshJob.id, developmentJob.id, otherTenantJob.id]));
    expect(retainedJobRows).toHaveLength(3);
    await expect(
      database
        .select({ id: campaignJobMatches.id })
        .from(campaignJobMatches)
        .where(eq(campaignJobMatches.id, matchId)),
    ).resolves.toEqual([]);
    await expect(
      database.select({ id: aiScores.id }).from(aiScores).where(eq(aiScores.id, scoreId)),
    ).resolves.toEqual([]);
    await expect(
      database
        .select({ id: analyticsEvents.id })
        .from(analyticsEvents)
        .where(eq(analyticsEvents.id, eventId)),
    ).resolves.toEqual([]);
    await expect(
      database
        .select({ id: workflowTasks.id })
        .from(workflowTasks)
        .where(inArray(workflowTasks.id, relatedTaskIds)),
    ).resolves.toEqual([]);

    const purgeTaskRows = await database
      .select({ payload: workflowTasks.payload })
      .from(workflowTasks)
      .where(
        and(
          eq(workflowTasks.workspaceId, workspace.id),
          eq(workflowTasks.kind, "purge-upwork-data"),
        ),
      );
    expect(
      purgeTaskRows.some(
        (row) =>
          row.payload.connectionId === connection.id &&
          row.payload.runSequence === connection.nextPurgeSequence,
      ),
    ).toBe(true);
    expect(
      purgeTaskRows.some(
        (row) =>
          row.payload.connectionId === connection.id &&
          row.payload.runSequence === connection.nextPurgeSequence + 1,
      ),
    ).toBe(true);
  });
});
