import { createServer, type Server } from "node:http";

export interface WorkerHealthServer {
  readonly port: number;
  close(): Promise<void>;
}

export function workerHealthPayload(workerId: string): { readonly status: "ok"; readonly workerId: string } {
  return { status: "ok", workerId };
}

function writeJson(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

export function startWorkerHealthServer(input: {
  readonly port: number;
  readonly workerId: string;
  readonly disabled?: boolean;
}): Promise<WorkerHealthServer> {
  if (input.disabled === true || (input.disabled === undefined && input.port === 0)) {
    return Promise.resolve({ port: 0, close: async () => undefined });
  }

  const server: Server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/health") {
      writeJson(response, 404, { status: "not_found" });
      return;
    }
    writeJson(response, 200, workerHealthPayload(input.workerId));
  });

  return new Promise<WorkerHealthServer>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string" || typeof address.port !== "number") {
        reject(new Error("Worker health server did not expose a TCP address"));
        return;
      }
      resolve({
        port: address.port,
        close: () => new Promise<void>((closeResolve) => {
          server.close(() => closeResolve());
        }),
      });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(input.port, "0.0.0.0");
  });
}
