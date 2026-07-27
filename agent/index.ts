/**
 * LegacyKeeper Agent — Main Entry Point
 *
 * Orchestrates the two-mode onchain security & inheritance agent:
 *
 * Mode A: Inheritance (passive)
 *   - Liveness monitoring via onchain heartbeat signatures
 *   - Configurable timeout + grace period
 *   - Grace-period alerts before execution
 *   - Onchain asset transfer to beneficiaries
 *
 * Mode B: Emergency Evacuation (instant)
 *   - Panic trigger via Telegram, secret URL, or dashboard
 *   - Recovery key auth (not compromised wallet key)
 *   - Instant asset evacuation to safe vault
 *   - KeeperHub private routing for MEV protection
 *
 * All onchain execution goes through KeeperHub — no direct RPC.
 */

import { LivenessMonitor, LivenessConfig } from './liveness/monitor';
import { KeeperHubExecutor } from './executor/keeperhub';
import { AlertNotifier, AlertMessage } from './alert/notifier';

export interface AgentConfig {
  // KeeperHub
  keeperhubApiKey: string;
  keeperhubMcpUrl: string;

  // Contract
  contractAddress: string;
  ownerAddress: string;

  // Liveness
  liveness: LivenessConfig;

  // Notifications
  telegramBotToken?: string;
  telegramChatId?: string;
  discordWebhookUrl?: string;
  emailConfig?: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    to: string;
  };

  // Recovery
  recoveryPublicKey?: string;
  safeVaultAddress?: string;
}

export class LegacyKeeperAgent {
  public readonly liveness: LivenessMonitor;
  public readonly executor: KeeperHubExecutor;
  public readonly alerts: AlertNotifier;
  public readonly config: AgentConfig;

  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: AgentConfig) {
    this.config = config;

    this.liveness = new LivenessMonitor(
      config.liveness,
      config.keeperhubApiKey,
      config.contractAddress
    );

    this.executor = new KeeperHubExecutor(
      config.keeperhubMcpUrl,
      config.keeperhubApiKey
    );

    this.alerts = new AlertNotifier({
      telegramBotToken: config.telegramBotToken,
      telegramChatId: config.telegramChatId,
      discordWebhookUrl: config.discordWebhookUrl,
      emailConfig: config.emailConfig,
    });
  }

  /**
   * Start the agent — begins liveness monitoring
   */
  async start(): Promise<void> {
    console.log('🚀 LegacyKeeper Agent starting...');
    console.log(`   Contract: ${this.config.contractAddress}`);
    console.log(`   Owner: ${this.config.ownerAddress}`);
    console.log(`   KeeperHub: ${this.config.keeperhubMcpUrl}`);

    await this.alerts.sendInfo(
      'LegacyKeeper Started',
      `Agent is now active. Contract: ${this.config.contractAddress}`
    );

    // Start periodic liveness checks
    this.checkInterval = setInterval(
      () => this.runLivenessCheck(),
      60_000 // every minute for demo; configurable in production
    );
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('🛑 LegacyKeeper Agent stopped');
  }    /**
   * Run a liveness check cycle
   */
  async runLivenessCheck(): Promise<void> {
    try {
      const state = await this.liveness.evaluate();

      if (state.gracePeriodActive) {
        const deadline = state.gracePeriodDeadline
          ? new Date(state.gracePeriodDeadline * 1000).toISOString()
          : 'unknown';
        await this.alerts.sendGracePeriodAlert(deadline);
        // Trigger KeeperHub inheritance workflow
        await this.executor.triggerInheritanceCheck();
      } else if (state.expired) {
        // Inheritance executes via KeeperHub workflow — agent just logs
        console.log('[Agent] Inheritance condition met — KeeperHub workflow should trigger execution');
      } else {
        // Status OK — warn if approaching threshold
        const threshold = this.config.liveness.timeoutDuration * 0.75;
        if (state.timeSinceHeartbeat > threshold) {
          await this.alerts.sendHeartbeatReminder(state.timeSinceHeartbeat);
        }
      }
    } catch (error) {
      console.error('[Agent] Liveness check failed:', error);
    }
  }

  /**
   * Handle a panic trigger
   */
  async handlePanic(params: {
    walletAddress: string;
    recoverySignature: string;
    signedMessage: string;
  }): Promise<boolean> {
    console.log('🚨 Panic triggered!');

    const result = await this.executor.triggerEvacuation(params);

    if (result.success) {
      await this.alerts.sendEvacuationAlert(
        result.txHash || '0x...',
        this.config.safeVaultAddress || 'unknown'
      );
    }

    return result.success;
  }
}

// Export components for external use
export { LivenessMonitor } from './liveness/monitor';
export { KeeperHubExecutor } from './executor/keeperhub';
export { AlertNotifier } from './alert/notifier';
export type { LivenessConfig } from './liveness/monitor';
