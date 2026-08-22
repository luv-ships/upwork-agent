import {
  Client,
  type FetchLike,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError
} from "@modelcontextprotocol/client";
import { z } from "zod";

import {
  UpworkFindJobsClientError,
  upworkFindJobsSearchParamsSchema,
  type UpworkFindJobsClient,
  type UpworkFindJobsSearchParams
} from "./upwork-mcp.js";

export const UPWORK_MCP_SERVER_URL = "https://mcp.upwork.com/mcp";
export const UPWORK_MCP_REQUEST_TIMEOUT_MS = 60_000;

const connectionAccessSchema = z.object({
  accessToken: z.string().trim().min(1).max(20_000),
  orgUid: z.string().trim().min(1).max(200)
});

const connectionIdSchema = z.uuid();

export type UpworkMcpConnectionAccess = z.infer<typeof connectionAccessSchema>;

/** Reads one workspace's decrypted OAuth access material from a server-only store. */
export interface UpworkMcpConnectionAccessResolver {
  resolve(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
  }): Promise<UpworkMcpConnectionAccess | undefined>;
}

/** One short-lived MCP client session with no generic tool-call capability. */
export interface UpworkMcpFindJobsSession {
  callFindJobs(input: {
    readonly orgUid: string;
    readonly params: UpworkFindJobsSearchParams;
  }): Promise<unknown>;
  close(): Promise<void>;
}

export interface UpworkMcpFindJobsSessionFactory {
  open(input: { readonly accessToken: string }): Promise<UpworkMcpFindJobsSession>;
}

function classifiedTransportError(
  error: unknown,
  retryAt?: string
): UpworkFindJobsClientError {
  if (error instanceof UpworkFindJobsClientError) return error;
  if (error instanceof UnauthorizedError) {
    return new UpworkFindJobsClientError({ kind: "reauthorization_required" });
  }
  if (error instanceof SdkHttpError) {
    if (error.status === 401 || error.status === 403) {
      return new UpworkFindJobsClientError({ kind: "reauthorization_required" });
    }
    if (error.status === 429) {
      return new UpworkFindJobsClientError({
        kind: "rate_limited",
        ...(retryAt === undefined ? {} : { retryAt })
      });
    }
  }
  return new UpworkFindJobsClientError({ kind: "temporarily_unavailable" });
}

/**
 * Fixed, read-only Streamable HTTP transport. It never lists arbitrary tools
 * and it does not retain an MCP session after a monitor poll completes.
 */
export function parseRetryAfter(value: string | null, now: Date): string | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 86_400) {
    return new Date(now.getTime() + Math.ceil(seconds) * 1_000).toISOString();
  }
  const date = new Date(value);
  if (
    Number.isNaN(date.getTime()) ||
    date.getTime() < now.getTime() ||
    date.getTime() > now.getTime() + 86_400_000
  ) {
    return undefined;
  }
  return date.toISOString();
}

export function createUpworkMcpFindJobsSessionFactory(options: {
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
} = {}): UpworkMcpFindJobsSessionFactory {
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  return {
    async open(inputValue) {
      const accessToken = z.string().trim().min(1).max(20_000).parse(inputValue.accessToken);
      const client = new Client({ name: "upwork-agent-worker", version: "0.1.0" });
      let retryAt: string | undefined;
      const monitoredFetch: FetchLike = async (input, init) => {
        const timeoutSignal = AbortSignal.timeout(UPWORK_MCP_REQUEST_TIMEOUT_MS);
        const signal = init?.signal == null
          ? timeoutSignal
          : AbortSignal.any([init.signal, timeoutSignal]);
        const response = await fetchFn(input, { ...init, signal });
        if (response.status === 429) {
          retryAt = parseRetryAfter(response.headers.get("retry-after"), now());
        }
        return response;
      };
      const transport = new StreamableHTTPClientTransport(new URL(UPWORK_MCP_SERVER_URL), {
        authProvider: { token: async () => accessToken },
        fetch: monitoredFetch
      });
      try {
        await client.connect(transport);
      } catch (error) {
        await client.close().catch(() => undefined);
        throw classifiedTransportError(error, retryAt);
      }
      return {
        callFindJobs: async ({ orgUid, params }) => {
          try {
            return await client.callTool({
              name: "upwork__find_jobs",
              arguments: {
                action: "search",
                org_uid: orgUid,
                params
              }
            });
          } catch (error) {
            throw classifiedTransportError(error, retryAt);
          }
        },
        close: () => client.close()
      };
    }
  };
}

/**
 * Resolves a single tenant connection and invokes only `upwork__find_jobs`.
 * OAuth refresh/reconnect is delegated to the credential lifecycle, never to
 * a browser session or a generic agent tool caller.
 */
export class UpworkMcpRemoteFindJobsClient implements UpworkFindJobsClient {
  readonly #accessResolver: UpworkMcpConnectionAccessResolver;
  readonly #sessionFactory: UpworkMcpFindJobsSessionFactory;

  public constructor(input: {
    readonly accessResolver: UpworkMcpConnectionAccessResolver;
    readonly sessionFactory?: UpworkMcpFindJobsSessionFactory;
  }) {
    this.#accessResolver = input.accessResolver;
    this.#sessionFactory = input.sessionFactory ?? createUpworkMcpFindJobsSessionFactory();
  }

  public async searchJobs(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly params: UpworkFindJobsSearchParams;
  }): Promise<unknown> {
    const workspaceId = connectionIdSchema.parse(input.workspaceId);
    const connectionId = connectionIdSchema.parse(input.connectionId);
    const params = upworkFindJobsSearchParamsSchema.parse(input.params);
    const storedAccess = await this.#accessResolver.resolve({ workspaceId, connectionId });
    if (storedAccess === undefined) {
      throw new UpworkFindJobsClientError({ kind: "reauthorization_required" });
    }
    const access = connectionAccessSchema.parse(storedAccess);

    let session: UpworkMcpFindJobsSession | undefined;
    try {
      session = await this.#sessionFactory.open({ accessToken: access.accessToken });
      return await session.callFindJobs({ orgUid: access.orgUid, params });
    } catch (error) {
      throw classifiedTransportError(error);
    } finally {
      if (session !== undefined) await session.close().catch(() => undefined);
    }
  }
}
