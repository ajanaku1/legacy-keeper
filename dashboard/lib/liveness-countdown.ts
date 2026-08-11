interface RecoveryCountdownInput {
  configuredDuration: number;
  chainElapsed: number;
  localTick: number;
  graceElapsed: boolean;
}

export function confirmedRecoveryCountdown(
  input: RecoveryCountdownInput,
): number {
  if (input.graceElapsed) return 0;
  const estimated =
    input.configuredDuration - input.chainElapsed - input.localTick;
  return Math.max(1, estimated);
}
