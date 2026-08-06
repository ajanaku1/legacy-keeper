export const HEARTBEAT_COOLDOWN_SECONDS = 24 * 60 * 60;

export function heartbeatCooldownRemaining(
  lastHeartbeat: number | undefined,
  nowSeconds: number,
): number {
  if (!lastHeartbeat) return 0;
  return Math.max(0, lastHeartbeat + HEARTBEAT_COOLDOWN_SECONDS - nowSeconds);
}
