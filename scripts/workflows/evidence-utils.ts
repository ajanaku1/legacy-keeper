type ExecutionIdentity = Record<string, unknown>;

export function keeperHubRunId(
  execution: ExecutionIdentity,
): string | undefined {
  return (
    stringValue(execution.runId) ??
    stringValue(execution.dispatchKey) ??
    stringValue(execution.id)
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
