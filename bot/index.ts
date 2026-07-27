/**
 * LegacyKeeper Telegram Bot
 *
 * Handles:
 * - Alert delivery (heartbeat reminders, grace period, inheritance, evacuation)
 * - Panic trigger (/panic command)
 * - Check-in (/heartbeat command)
 * - Status queries (/status)
 * - Cancel inheritance (/cancel)
 *
 * Commands:
 *   /start   — Initialize the bot
 *   /status  — Check liveness and config status
 *   /panic   — 🚨 TRIGGER EMERGENCY EVACUATION
 *   /checkin — Record a heartbeat manually
 *   /cancel  — Cancel pending inheritance
 *   /config  — View current configuration
 *   /help    — Show available commands
 */

export interface BotConfig {
  botToken: string;
  allowedChatIds: string[];
  contractAddress: string;
  ownerAddress: string;
}

export interface BotMessage {
  chatId: string;
  text: string;
  parseMode?: 'Markdown' | 'HTML';
}

export class LegacyKeeperBot {
  private config: BotConfig;
  private panicCallback?: (chatId: string) => Promise<boolean>;
  private heartbeatCallback?: () => Promise<boolean>;
  private cancelCallback?: () => Promise<boolean>;

  constructor(config: BotConfig) {
    this.config = config;
  }

  /**
   * Register callbacks
   */
  onPanic(callback: (chatId: string) => Promise<boolean>): void {
    this.panicCallback = callback;
  }

  onHeartbeat(callback: () => Promise<boolean>): void {
    this.heartbeatCallback = callback;
  }

  onCancel(callback: () => Promise<boolean>): void {
    this.cancelCallback = callback;
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    console.log('[LegacyKeeperBot] Starting...');
    console.log('[LegacyKeeperBot] Bot configured for chat IDs:', this.config.allowedChatIds);
    console.log('[LegacyKeeperBot] Listening for commands...');

    // In production, this uses node-telegram-bot-api or telegraf
    // Polling updates from Telegram API
  }

  /**
   * Send a message to allowed chats
   */
  async sendMessage(message: BotMessage): Promise<boolean> {
    console.log(`[Bot] Sending to ${message.chatId}: ${message.text.substring(0, 100)}`);
    // POST https://api.telegram.org/bot${TOKEN}/sendMessage
    return true;
  }

  /**
   * Broadcast to all allowed chats
   */
  async broadcast(text: string, parseMode?: BotMessage['parseMode']): Promise<void> {
    const promises = this.config.allowedChatIds.map((chatId) =>
      this.sendMessage({ chatId, text, parseMode })
    );
    await Promise.all(promises);
  }

  /**
   * Handle an incoming command
   */
  async handleCommand(chatId: string, command: string, args: string[]): Promise<string> {
    if (!this.config.allowedChatIds.includes(chatId)) {
      return '⛔ Unauthorized. Your chat ID is not registered.';
    }

    switch (command) {
      case '/start':
        return this.handleStart();
      case '/status':
        return this.handleStatus();
      case '/panic':
        return this.handlePanic(chatId);
      case '/checkin':
        return this.handleCheckin();
      case '/cancel':
        return this.handleCancel();
      case '/config':
        return this.handleConfig();
      case '/help':
        return this.handleHelp();
      default:
        return 'Unknown command. Send /help for available commands.';
    }
  }

  private handleStart(): string {
    return (
      '*🔐 LegacyKeeper Bot active*\n\n' +
      'I monitor your onchain liveness and handle emergency evacuation.\n\n' +
      '*/status* — Check everything\n' +
      '*/checkin* — Send a heartbeat\n' +
      '*/panic* — Emergency evacuation\n' +
      '*/cancel* — Cancel inheritance\n' +
      '*/help* — Show all commands'
    );
  }

  private async handleStatus(): Promise<string> {
    const status = {
      contract: this.config.contractAddress,
      owner: this.config.ownerAddress,
      liveness: 'active',
      lastHeartbeat: '23 minutes ago',
      timeout: '30 days',
      gracePeriod: '7 days',
      beneficiaries: 3,
      recoveryKey: 'registered',
      safeVault: 'configured',
    };

    return (
      '*📊 LegacyKeeper Status*\n\n' +
      `Contract: \`${status.contract}\`\n` +
      `Owner: \`${status.owner}\`\n` +
      `Liveness: ✅ *${status.liveness}*\n` +
      `Heartbeat: ${status.lastHeartbeat}\n` +
      `Timeout: ${status.timeout}\n` +
      `Grace Period: ${status.gracePeriod}\n` +
      `Beneficiaries: ${status.beneficiaries}\n` +
      `Recovery Key: ✅ *${status.recoveryKey}*\n` +
      `Safe Vault: ✅ *${status.safeVault}*`
    );
  }

  private async handlePanic(chatId: string): Promise<string> {
    if (!this.panicCallback) {
      return '❌ Panic handler not configured.';
    }

    const confirmed = await this.panicCallback(chatId);

    if (confirmed) {
      return (
        '🚨 *EMERGENCY EVACUATION TRIGGERED*\n\n' +
        'All assets are being transferred to your safe vault via KeeperHub private routing.\n' +
        'You will receive a confirmation when the transaction completes.'
      );
    }

    return '❌ Evacuation failed. Check logs for details.';
  }

  private async handleCheckin(): Promise<string> {
    if (!this.heartbeatCallback) {
      return '❌ Heartbeat handler not configured.';
    }

    const recorded = await this.heartbeatCallback();
    if (recorded) {
      return '✅ *Heartbeat recorded!* Your liveness timer has been reset.';
    }
    return '❌ Failed to record heartbeat.';
  }

  private async handleCancel(): Promise<string> {
    if (!this.cancelCallback) {
      return '❌ Cancel handler not configured.';
    }

    const cancelled = await this.cancelCallback();
    if (cancelled) {
      return '✅ *Inheritance cancelled.* Grace period has been reset.';
    }
    return '❌ No pending inheritance to cancel.';
  }

  private handleConfig(): string {
    return (
      '*⚙️ Configuration*\n\n' +
      `Contract: \`${this.config.contractAddress}\`\n` +
      `Owner: \`${this.config.ownerAddress}\`\n` +
      'Use the web dashboard to modify settings.'
    );
  }

  private handleHelp(): string {
    return (
      '*Available Commands*\n\n' +
      '*/start* — Initialize bot\n' +
      '*/status* — Current liveness and config status\n' +
      '*/checkin* — Record a heartbeat\n' +
      '*/panic* — 🚨 Emergency evacuation\n' +
      '*/cancel* — Cancel pending inheritance\n' +
      '*/config* — View configuration\n' +
      '*/help* — Show this message'
    );
  }
}
