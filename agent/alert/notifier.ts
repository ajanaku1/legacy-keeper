/**
 * Alert Notifier
 *
 * Sends notifications across multiple channels:
 * - Telegram (primary — also handles panic triggers)
 * - Discord (secondary)
 * - Email (fallback)
 *
 * NOTE: This module includes stub implementations for hackathon scaffolding.
 * Real API calls (Telegram Bot API, Discord webhooks, SMTP) need to be
 * implemented with actual HTTP requests in production.
 */

export type AlertChannel = 'telegram' | 'discord' | 'email';
export type AlertSeverity = 'info' | 'warning' | 'critical' | 'success';

export interface AlertMessage {
  severity: AlertSeverity;
  title: string;
  body: string;
  channels: AlertChannel[];
  metadata?: Record<string, string>;
}

export class AlertNotifier {
  private telegramBotToken?: string;
  private telegramChatId?: string;
  private discordWebhookUrl?: string;
  private emailConfig?: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    to: string;
  };
  // Config values referenced in alerts
  private config: {
    timeoutDays: number;
  };

  constructor(config: {
    telegramBotToken?: string;
    telegramChatId?: string;
    discordWebhookUrl?: string;
    emailConfig?: AlertNotifier['emailConfig'];
    timeoutDays?: number;
  }) {
    this.telegramBotToken = config.telegramBotToken;
    this.telegramChatId = config.telegramChatId;
    this.discordWebhookUrl = config.discordWebhookUrl;
    this.emailConfig = config.emailConfig;
    this.config = {
      timeoutDays: config.timeoutDays ?? 30,
    };
  }

  /**
   * Send an alert across specified channels
   */
  async send(alert: AlertMessage): Promise<Record<AlertChannel, boolean>> {
    const results: Record<string, boolean> = {};

    const promises = alert.channels.map(async (channel) => {
      try {
        switch (channel) {
          case 'telegram':
            results.telegram = await this.sendTelegram(alert);
            break;
          case 'discord':
            results.discord = await this.sendDiscord(alert);
            break;
          case 'email':
            results.email = await this.sendEmail(alert);
            break;
        }
      } catch (error) {
        console.error(`[AlertNotifier] ${channel} failed:`, error);
        results[channel] = false;
      }
    });

    await Promise.all(promises);
    return results as Record<AlertChannel, boolean>;
  }

  /**
   * Send a heartbeat reminder
   */
  async sendHeartbeatReminder(timeSinceLast: number): Promise<void> {
    const hoursSince = Math.round(timeSinceLast / 3600);
    await this.send({
      severity: 'warning',
      title: 'Heartbeat Reminder',
      body: `It's been ${hoursSince} hours since your last heartbeat. Your inheritance timeout is configured to ${this.config.timeoutDays} days. Sign in to reset the timer.`,
      channels: ['telegram', 'email'],
    });
  }

  /**
   * Send grace period alert
   */
  async sendGracePeriodAlert(deadline: string): Promise<void> {
    await this.send({
      severity: 'critical',
      title: 'Grace Period Started',
      body: `Your LegacyKeeper grace period has started. Inheritance will execute on ${deadline} unless you cancel it. Reply /cancel to stop it.`,
      channels: ['telegram', 'discord', 'email'],
    });
  }

  /**
   * Send inheritance executed notification
   */
  async sendInheritanceExecuted(txHash: string, recipient: string): Promise<void> {
    await this.send({
      severity: 'success',
      title: 'Inheritance Executed',
      body: `Assets have been transferred to ${recipient}. Transaction: ${txHash}`,
      channels: ['telegram', 'email'],
    });
  }

  /**
   * Send evacuation alert
   */
  async sendEvacuationAlert(txHash: string, vaultAddress: string): Promise<void> {
    await this.send({
      severity: 'critical',
      title: 'Emergency Evacuation',
      body: `All assets have been evacuated to ${vaultAddress}. Transaction: ${txHash}`,
      channels: ['telegram', 'discord', 'email'],
    });
  }

  /**
   * Send a simple info message
   */
  async sendInfo(title: string, body: string): Promise<void> {
    await this.send({
      severity: 'info',
      title,
      body,
      channels: ['telegram'],
    });
  }

  // ────────────────────────────────
  // Channel Implementations
  // ────────────────────────────────

  private async sendTelegram(alert: AlertMessage): Promise<boolean> {
    if (!this.telegramBotToken || !this.telegramChatId) {
      console.warn('[AlertNotifier] Telegram not configured');
      return false;
    }

    const emojiMap: Record<AlertSeverity, string> = {
      info: '',
      warning: '',
      critical: '',
      success: '',
    };

    const text = `${emojiMap[alert.severity]} *${alert.title}*\n\n${alert.body}`;

    // TODO: Implement actual Telegram Bot API call
    // POST https://api.telegram.org/bot${this.telegramBotToken}/sendMessage
    // with parse_mode: 'Markdown' and chat_id: this.telegramChatId
    console.log(`[Telegram] Sending to ${this.telegramChatId}: ${text.substring(0, 120)}...`);
    return true;
  }

  private async sendDiscord(alert: AlertMessage): Promise<boolean> {
    if (!this.discordWebhookUrl) {
      console.warn('[AlertNotifier] Discord not configured');
      return false;
    }

    const colorMap: Record<AlertSeverity, number> = {
      info: 0x5ac8fa,
      warning: 0xfbbf24,
      critical: 0xf87171,
      success: 0x4ade80,
    };

    // TODO: Implement actual Discord webhook POST
    // POST to this.discordWebhookUrl with JSON payload
    console.log(`[Discord] Sending embed: ${alert.title}`);
    return true;
  }

  private async sendEmail(alert: AlertMessage): Promise<boolean> {
    if (!this.emailConfig) {
      console.warn('[AlertNotifier] Email not configured');
      return false;
    }

    // TODO: Implement actual SMTP send via nodemailer
    // const transporter = nodemailer.createTransport({ ... });
    // await transporter.sendMail({ ... });
    console.log(`[Email] Sending: ${alert.title} to ${this.emailConfig.to}`);
    return true;
  }
}
