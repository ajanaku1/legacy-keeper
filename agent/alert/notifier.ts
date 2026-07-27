/**
 * Multi-channel alerting over real HTTP.
 *
 * Alerts are the only thing standing between a false positive and an
 * irreversible distribution, so delivery failures are reported, never
 * swallowed. A channel that is not configured is `skipped`, which is
 * different from `failed` — the caller can tell the difference.
 */

export type AlertChannel = 'telegram' | 'discord';
export type AlertSeverity = 'info' | 'warning' | 'critical' | 'success';
export type DeliveryStatus = 'sent' | 'failed' | 'skipped';

export interface AlertMessage {
  severity: AlertSeverity;
  title: string;
  body: string;
  /** Rendered as a link line when present. */
  txHash?: string;
}

export interface NotifierConfig {
  telegramBotToken?: string;
  telegramChatId?: string;
  discordWebhookUrl?: string;
  explorerBaseUrl?: string;
}

const ICON: Record<AlertSeverity, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  critical: '🚨',
  success: '✅',
};

export class AlertNotifier {
  constructor(private readonly config: NotifierConfig = {}) {}

  async send(
    alert: AlertMessage
  ): Promise<Record<AlertChannel, DeliveryStatus>> {
    const [telegram, discord] = await Promise.all([
      this.sendTelegram(alert),
      this.sendDiscord(alert),
    ]);
    return { telegram, discord };
  }

  private async sendTelegram(alert: AlertMessage): Promise<DeliveryStatus> {
    const { telegramBotToken: token, telegramChatId: chatId } = this.config;
    if (!token || !chatId) return 'skipped';

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: this.render(alert),
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
          }),
        }
      );
      if (!response.ok) {
        console.error(
          `[notifier] telegram ${response.status}: ${await response.text()}`
        );
        return 'failed';
      }
      return 'sent';
    } catch (error) {
      console.error('[notifier] telegram threw:', error);
      return 'failed';
    }
  }

  private async sendDiscord(alert: AlertMessage): Promise<DeliveryStatus> {
    const url = this.config.discordWebhookUrl;
    if (!url) return 'skipped';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: this.render(alert) }),
      });
      // Discord webhooks answer 204 with no body on success.
      if (!response.ok) {
        console.error(`[notifier] discord ${response.status}`);
        return 'failed';
      }
      return 'sent';
    } catch (error) {
      console.error('[notifier] discord threw:', error);
      return 'failed';
    }
  }

  private render(alert: AlertMessage): string {
    const lines = [`${ICON[alert.severity]} *${alert.title}*`, '', alert.body];
    if (alert.txHash) {
      const base = this.config.explorerBaseUrl ?? 'https://sepolia.etherscan.io';
      lines.push('', `[View transaction](${base}/tx/${alert.txHash})`);
    }
    return lines.join('\n');
  }

  // ── Named alerts, so wording stays consistent across triggers ──

  async gracePeriodStarted(deadlineIso: string, cancelHint: string) {
    return this.send({
      severity: 'warning',
      title: 'Liveness timeout reached',
      body:
        `LegacyKeeper has not seen a heartbeat and has entered the grace period.\n\n` +
        `Distribution becomes possible at *${deadlineIso}*.\n\n` +
        `If you are reading this, you are alive — ${cancelHint}`,
    });
  }

  async heartbeatReminder(daysRemaining: number) {
    return this.send({
      severity: 'info',
      title: 'Heartbeat due soon',
      body: `${daysRemaining} day(s) left before the grace period begins. Check in to reset the timer.`,
    });
  }

  async inheritanceExecuted(txHash: string, beneficiaryCount: number) {
    return this.send({
      severity: 'success',
      title: 'Inheritance executed',
      body: `The estate has been distributed to ${beneficiaryCount} beneficiaries.`,
      txHash,
    });
  }

  async evacuationExecuted(txHash: string, vault: string) {
    return this.send({
      severity: 'critical',
      title: 'Emergency evacuation executed',
      body: `Assets have been swept to the safe vault \`${vault}\`.`,
      txHash,
    });
  }

  async executionFailed(action: string, error: string, attempts: number) {
    return this.send({
      severity: 'critical',
      title: `Execution failed: ${action}`,
      body: `Gave up after ${attempts} attempt(s).\n\n\`${error}\``,
    });
  }
}
