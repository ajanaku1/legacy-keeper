const SENSITIVE_FIELD = /signature|token|api.?key|private.?key/i;

export function redactKeeperHubOutput(text: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(text)), null, 2);
  } catch {
    return text.replace(
      /("(?:signature|\w*token|\w*api\w*key|\w*private\w*key)"\s*:\s*)"[^"]*"/gi,
      '$1"[REDACTED]"',
    );
  }
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SENSITIVE_FIELD.test(key) ? "[REDACTED]" : redactValue(child),
    ]),
  );
}
