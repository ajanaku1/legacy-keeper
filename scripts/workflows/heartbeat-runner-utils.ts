export function resolveHeartbeatContract(
  environmentAddress: string | undefined,
  manifestAddress: string | undefined,
): string {
  const address = environmentAddress || manifestAddress;
  if (!address) throw new Error("LegacyKeeper contract address is required");
  return address;
}

export function webhookUrl(workflowId: string): string {
  return `https://app.keeperhub.com/api/workflows/${workflowId}/webhook`;
}
