/**
 * Publish and exercise the narrow LegacyKeeper status MCP surface.
 * Nothing is published unless --publish is explicit.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { McpClient } from "../../agent/keeperhub/mcp-client";

const SLUG = "legacykeeper-status-sepolia";

interface Manifest {
  workflows: Array<{ key: string; workflowId: string }>;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--publish")) {
    throw new Error("publishing requires the explicit --publish flag");
  }
  const manifest = JSON.parse(
    readFileSync("workflows/manifest.json", "utf8"),
  ) as Manifest;
  const statusWorkflow = manifest.workflows.find(
    (workflow) => workflow.key === "block-health",
  );
  if (!statusWorkflow) throw new Error("block-health workflow is missing");

  const aggregate = client(process.env.KEEPERHUB_MCP_URL);
  await aggregate.connect();
  await aggregate.callTool("list_workflow", {
    workflowId: statusWorkflow.workflowId,
    slug: SLUG,
    category: "monitoring",
    chain: "11155111",
    workflowType: "read",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputMapping: {
      timeoutExceeded:
        "{{@read-status:Read Timeout Status.result.timeoutExceeded}}",
      graceElapsed: "{{@read-status:Read Timeout Status.result.graceElapsed}}",
    },
  });

  const narrow = client(`https://app.keeperhub.com/mcp/w/${SLUG}`);
  await narrow.connect();
  const tools = await narrow.listToolDefinitions();
  if (tools.length !== 1) {
    throw new Error(`expected one per-workflow tool, received ${tools.length}`);
  }
  const result = await narrow.callTool(tools[0].name, {
    type: "on-chain-event",
    chainId: 11155111,
  });
  console.log(
    JSON.stringify(
      { slug: SLUG, tool: tools[0], result: JSON.parse(result) },
      null,
      2,
    ),
  );
}

function client(url = "https://app.keeperhub.com/mcp"): McpClient {
  return new McpClient({ url, apiKey: required("KEEPERHUB_API_KEY") });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
