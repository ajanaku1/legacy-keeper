/**
 * Liveness monitor — reads real onchain state.
 *
 * Reads go straight to an RPC provider: they are free, fast, and carry no
 * execution risk. Only transaction *submission* is required to route through
 * KeeperHub (verify.sh gate G4 enforces that this file never sends one).
 */

import { Contract, JsonRpcProvider } from 'ethers';

const LIVENESS_ABI = [
  'function getLivenessStatus() view returns (uint64 lastHeartbeat, uint64 timeSinceHeartbeat, bool active, bool expired)',
  'function getTimeoutStatus() view returns (bool timeoutExceeded, bool graceElapsed)',
  'function liveness() view returns (uint64 heartbeatInterval, uint64 timeoutDuration, uint64 gracePeriod, uint64 lastHeartbeat, bool livenessActive)',
  'function inheritanceExecuted() view returns (bool)',
  'function evacuationExecuted() view returns (bool)',
  'function beneficiaryCount() view returns (uint256)',
  'function totalShareBps() view returns (uint16)',
];

export interface LivenessState {
  lastHeartbeat: number;
  timeSinceHeartbeat: number;
  timeoutDuration: number;
  gracePeriod: number;
  active: boolean;
  timeoutExceeded: boolean;
  graceElapsed: boolean;
  inheritanceExecuted: boolean;
  evacuationExecuted: boolean;
  /** Seconds until distribution becomes callable; 0 once due. */
  secondsUntilDue: number;
  /** True while the owner can still cancel by proving liveness. */
  inGracePeriod: boolean;
  readyToExecute: boolean;
  configComplete: boolean;
}

export class LivenessMonitor {
  private readonly contract: Contract;

  constructor(rpcUrl: string, contractAddress: string) {
    if (!rpcUrl) throw new Error('LivenessMonitor: rpcUrl is required');
    if (!contractAddress) {
      throw new Error('LivenessMonitor: contractAddress is required');
    }
    this.contract = new Contract(
      contractAddress,
      LIVENESS_ABI,
      new JsonRpcProvider(rpcUrl)
    );
  }

  async evaluate(): Promise<LivenessState> {
    const [status, timeout, config, inherited, evacuated, count, shares] =
      await Promise.all([
        this.contract.getLivenessStatus(),
        this.contract.getTimeoutStatus(),
        this.contract.liveness(),
        this.contract.inheritanceExecuted(),
        this.contract.evacuationExecuted(),
        this.contract.beneficiaryCount(),
        this.contract.totalShareBps(),
      ]);

    const timeSince = Number(status[1]);
    const timeoutDuration = Number(config[1]);
    const gracePeriod = Number(config[2]);
    const dueAt = timeoutDuration + gracePeriod;

    const timeoutExceeded = Boolean(timeout[0]);
    const graceElapsed = Boolean(timeout[1]);
    const active = Boolean(status[2]);

    // Shares must total exactly 100% or distribution reverts. Surfacing this
    // as config state means the dashboard can warn before the deadline
    // rather than the keeper discovering it at execution time.
    const configComplete = Number(count) > 0 && Number(shares) === 10000;

    return {
      lastHeartbeat: Number(status[0]),
      timeSinceHeartbeat: timeSince,
      timeoutDuration,
      gracePeriod,
      active,
      timeoutExceeded,
      graceElapsed,
      inheritanceExecuted: Boolean(inherited),
      evacuationExecuted: Boolean(evacuated),
      secondsUntilDue: Math.max(0, dueAt - timeSince),
      inGracePeriod: timeoutExceeded && !graceElapsed,
      readyToExecute:
        graceElapsed &&
        active &&
        !inherited &&
        !evacuated &&
        configComplete,
      configComplete,
    };
  }

  /** Fraction of the way to distribution, for progress display. */
  static progress(state: LivenessState): number {
    const total = state.timeoutDuration + state.gracePeriod;
    if (total === 0) return 0;
    return Math.min(1, state.timeSinceHeartbeat / total);
  }
}
