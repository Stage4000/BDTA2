import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

type CombinedHealthCheck = () => Promise<{
  status: "ok" | "degraded";
  checks: Record<string, "ok" | "error">;
}>;

type UnifiedPlatformServerOptions = {
  apiServer: Server;
  webServer: Server;
  healthCheck?: CombinedHealthCheck;
};

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

function getRequestHandler(server: Server, label: string): RequestHandler {
  const [handler] = server.listeners("request");
  if (typeof handler !== "function") {
    throw new Error(`Expected ${label} server to expose a request handler.`);
  }

  return handler as RequestHandler;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload).toString()
  });
  response.end(payload);
}

export function createUnifiedPlatformServer(options: UnifiedPlatformServerOptions): Server {
  const apiHandler = getRequestHandler(options.apiServer, "api");
  const webHandler = getRequestHandler(options.webServer, "web");

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if ((request.method ?? "GET") === "GET" && url.pathname === "/health") {
      if (options.healthCheck == null) {
        writeJson(response, 200, { status: "ok" });
        return;
      }

      const report = await options.healthCheck();
      writeJson(response, report.status === "ok" ? 200 : 503, report);
      return;
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      apiHandler(request, response);
      return;
    }

    webHandler(request, response);
  });
}
