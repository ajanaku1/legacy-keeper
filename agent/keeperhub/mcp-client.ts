/**
 * KeeperHub MCP client.
 *
 * Streamable-HTTP JSON-RPC against https://app.keeperhub.com/mcp.
 *
 * The handshake is strict and undocumented in the order it requires: the
 * server rejects tools/list with -32003 "Session not initialized" unless
 * `initialize` and `notifications/initialized` have been sent sequentially
 * first, and the session id comes back in the Mcp-Session-Id *header*, not
 * the body. Getting this wrong is the first wall a new builder hits.
 */

const PROTOCOL_VERSION = "2024-11-05";

export interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

type JsonObject = Record<string, unknown>;

export class McpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "McpError";
  }
}

export interface McpClientOptions {
  url: string;
  apiKey: string;
  /** Attempts per call, including the first. */
  maxAttempts?: number;
  /** Base delay for exponential backoff, in ms. */
  baseDelayMs?: number;
  timeoutMs?: number;
}

export class McpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private readonly opts: Required<McpClientOptions>;

  constructor(options: McpClientOptions) {
    if (!options.url) throw new Error("McpClient: url is required");
    if (!options.apiKey) throw new Error("McpClient: apiKey is required");
    this.opts = {
      maxAttempts: 4,
      baseDelayMs: 500,
      timeoutMs: 30_000,
      ...options,
    };
  }

  get connected(): boolean {
    return this.sessionId !== null;
  }

  /** initialize → notifications/initialized. Must complete before any call. */
  async connect(): Promise<{ name: string; version: string }> {
    const { response, body } = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "legacy-keeper", version: "0.1.0" },
      },
    });

    const sid = response.headers.get("mcp-session-id");
    if (!sid) {
      throw new McpError("handshake returned no Mcp-Session-Id header");
    }
    this.sessionId = sid;

    // Notification: no id, no response body expected.
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });

    const result = objectField(asObject(body), "result");
    const info = objectField(result, "serverInfo");
    return {
      name: stringField(info, "name") ?? "unknown",
      version: stringField(info, "version") ?? "unknown",
    };
  }

  async listTools(): Promise<string[]> {
    return (await this.listToolDefinitions()).map((tool) => tool.name);
  }

  async listToolDefinitions(): Promise<McpToolDefinition[]> {
    const result = asObject(await this.rpc("tools/list", {}));
    const tools = Array.isArray(result.tools) ? result.tools : [];
    return tools.flatMap((value) => {
      const tool = asObject(value);
      const name = stringField(tool, "name");
      if (!name) return [];
      const description = stringField(tool, "description");
      const inputSchema = objectField(tool, "inputSchema");
      return [{ name, description, inputSchema }];
    });
  }

  /**
   * Call a tool. Note KeeperHub reports tool-level failures as a 200 with
   * `isError: true` in the body rather than an HTTP error, so success has to
   * be read from the payload, never from the status code.
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<string> {
    const result = (await this.rpc("tools/call", {
      name,
      arguments: args,
    })) as McpToolResult;

    const text = (result?.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");

    if (result?.isError) {
      throw new McpError(`tool ${name} failed: ${text}`, undefined, false);
    }
    return text;
  }

  /** Convenience: parse a tool result that returns JSON text. */
  async callToolJson<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const text = await this.callTool(name, args);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new McpError(
        `tool ${name} returned non-JSON: ${text.slice(0, 200)}`,
      );
    }
  }

  // ────────────────────────────────────────────────────────────

  private async rpc(method: string, params: unknown): Promise<unknown> {
    if (!this.sessionId) await this.connect();

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
      try {
        const { body } = await this.post({
          jsonrpc: "2.0",
          id: this.nextId++,
          method,
          params,
        });

        const envelope = asObject(body);
        const rpcError = objectField(envelope, "error");
        if (rpcError) {
          const code = numberField(rpcError, "code");
          const message = stringField(rpcError, "message");
          // -32003 means the session lapsed. Re-handshake once, then retry.
          if (code === -32003) {
            this.sessionId = null;
            await this.connect();
            throw new McpError(message ?? "session expired", code, true);
          }
          throw new McpError(message ?? "rpc error", code, false);
        }

        return envelope.result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const retryable =
          lastError instanceof McpError ? lastError.retryable : true;

        if (!retryable || attempt === this.opts.maxAttempts) break;

        // Exponential backoff with jitter, so parallel keepers do not
        // synchronise their retries into a thundering herd.
        const delay =
          this.opts.baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random());
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastError ?? new McpError(`${method} failed`);
  }

  private async post(
    payload: unknown,
  ): Promise<{ response: Response; body: unknown }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.opts.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // 202 Accepted with an empty body is the correct reply to a notification.
    const raw = await response.text();
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new McpError(
        `HTTP ${response.status}: ${raw.slice(0, 200) || response.statusText}`,
        response.status,
        retryable,
      );
    }
    if (!raw.trim()) return { response, body: null };

    return { response, body: parseMaybeSse(raw) };
  }
}

/**
 * The endpoint may answer as JSON or as a single SSE frame depending on the
 * call. Strip the `data: ` prefix when present rather than assuming either.
 */
function parseMaybeSse(raw: string): unknown {
  const text = raw
    .split("\n")
    .map((line) => (line.startsWith("data: ") ? line.slice(6) : line))
    .filter((line) => line.trim() && !line.startsWith("event:"))
    .join("");

  try {
    return JSON.parse(text);
  } catch {
    throw new McpError(`unparseable response: ${raw.slice(0, 200)}`);
  }
}

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function objectField(
  object: JsonObject | undefined,
  key: string,
): JsonObject | undefined {
  const value = object?.[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringField(
  object: JsonObject | undefined,
  key: string,
): string | undefined {
  const value = object?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === "number" ? value : undefined;
}
