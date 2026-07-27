/**
 * LegacyKeeper agent.
 *
 * Watches onchain liveness and drives both modes through KeeperHub:
 *   Mode A — heartbeat missed → grace period → distribution to beneficiaries
 *   Mode B — panic trigger → recovery-key signature → sweep to safe vault
 *
 * The agent decides; KeeperHub executes. Nothing here submits a transaction
 * directly, and nothing here reports success it did not observe.
 */

import { McpClient } from './keeperhub/mcp-client';
import { KeeperHubExecutor, TriggerInfo } from './executor/keeperhub';
import { LivenessMonitor, LivenessState } from './liveness/monitor';
import { AlertNotifier } from './alert/notifier';
import { AuditLedger } from './audit/ledger';

export interface AgentConfig {
  keeperhubApiKey: string;
  keeperhubMcpUrl: string;
  rpcUrl: string;
  contractAddress: string;
  chainId: number;
  checkIntervalMs?: number;
  telegramBotToken?: string;
  telegramChatId?: string;
  discordWebhookUrl?: string;
  auditLedgerPath?: string;
}

export class LegacyKeeperAgent {
  readonly mcp: McpClient;
  readonly executor: KeeperHubExecutor;
  readonly monitor: LivenessMonitor;
  readonly alerts: AlertNotifier;
  readonly ledger: AuditLedger;

  private timer: ReturnType<typeof setInterval> | null = null;
  private graceAlertSent = false;

  constructor(private readonly config: AgentConfig) {
    for (const key of [
      'keeperhubApiKey',
      'keeperhubMcpUrl',
      'rpcUrl',
      'contractAddress',
    ] as const) {
      if (!config[key]) throw new Error(`AgentConfig.${key} is required`);
    }

    this.mcp = new McpClient({
      url: config.keeperhubMcpUrl,
      apiKey: config.keeperhubApiKey,
    });
    this.ledger = new AuditLedger(config.auditLedgerPath);
    this.executor = new KeeperHubExecutor(
      this.mcp,
      this.ledger,
      config.chainId,
      config.contractAddress
    );
    this.monitor = new LivenessMonitor(config.rpcUrl, config.contractAddress);
    this.alerts = new AlertNotifier({
      telegramBotToken: config.telegramBotToken,
      telegramChatId: config.telegramChatId,
      discordWebhookUrl: config.discordWebhookUrl,
    });
  }

  async start(): Promise<void> {
    const server = await this.mcp.connect();
    console.log(
      `[agent] connected to ${server.name} v${server.version}; watching ${this.config.contractAddress}`
    );

    await this.tick();
    this.timer = setInterval(
      () => void this.tick(),
      this.config.checkIntervalMs ?? 60_000
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One liveness evaluation. Safe to call repeatedly; does nothing when idle. */
  async tick(): Promise<LivenessState | null> {
    let state: LivenessState;
    try {
      state = await this.monitor.evaluate();
    } catch (error) {
      console.error('[agent] liveness read failed:', error);
      return null;
    }

    if (state.inheritanceExecuted || state.evacuationExecuted || !state.active) {
      return state;
    }

    if (state.readyToExecute) {
      await this.runInheritance({
        type: 'scheduled',
        source: 'liveness-monitor',
        detail: `no heartbeat for ${state.timeSinceHeartbeat}s`,
      });
      return state;
    }

    // Reset once liveness is restored, so a SECOND grace period alerts too.
    // A latch that never clears means the owner is warned the first time they
    // go quiet and silently the second time — the opposite of useful.
    if (!state.inGracePeriod && this.graceAlertSent) {
      this.graceAlertSent = false;
    }

    if (state.inGracePeriod && !this.graceAlertSent) {
      const deadline = new Date(
        (state.lastHeartbeat + state.timeoutDuration + state.gracePeriod) * 1000
      ).toISOString();
      await this.alerts.gracePeriodStarted(
        deadline,
        'check in from the dashboard or Telegram to reset the timer.'
      );
      this.graceAlertSent = true;
    }

    // Misconfiguration only surfaces at execution time otherwise, which is
    // the worst possible moment to discover the shares do not total 100%.
    if (state.timeoutExceeded && !state.configComplete) {
      await this.alerts.send({
        severity: 'critical',
        title: 'Distribution is due but configuration is incomplete',
        body: 'Beneficiary shares must total exactly 100%. Execution will revert until fixed.',
      });
    }

    return state;
  }

  async runInheritance(trigger: TriggerInfo) {
    const result = await this.executor.executeInheritance(trigger);
    if (result.success && result.txHash) {
      const state = await this.monitor.evaluate().catch(() => null);
      await this.alerts.inheritanceExecuted(result.txHash, state ? 1 : 0);
    } else {
      await this.alerts.executionFailed(
        'executeInheritance',
        result.error ?? 'unknown',
        result.attempts
      );
    }
    return result;
  }

  async runEvacuation(
    params: { nonce: number; deadline: number; signature: string },
    trigger: TriggerInfo,
    safeVault: string
  ) {
    const result = await this.executor.executeEvacuation(params, trigger);
    if (result.success && result.txHash) {
      await this.alerts.evacuationExecuted(result.txHash, safeVault);
    } else {
      await this.alerts.executionFailed(
        'evacuate',
        result.error ?? 'unknown',
        result.attempts
      );
    }
    return result;
  }
}

export { McpClient } from './keeperhub/mcp-client';
export { KeeperHubExecutor } from './executor/keeperhub';
export { LivenessMonitor } from './liveness/monitor';
export { AlertNotifier } from './alert/notifier';
export { AuditLedger } from './audit/ledger';
export type { LivenessState } from './liveness/monitor';
