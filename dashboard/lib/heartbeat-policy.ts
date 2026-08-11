export function heartbeatCooldownRemaining(
  lastHeartbeat: number | undefined,
  heartbeatInterval: number | undefined,
  nowSeconds: number,
): number {
  if (!lastHeartbeat || !heartbeatInterval) return 0;
  return Math.max(0, lastHeartbeat + heartbeatInterval - nowSeconds);
}
