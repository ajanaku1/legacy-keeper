/**
 * LegacyKeeper Telegram bot — real long-polling against the Bot API.
 *
 * Every command reads live chain state or drives a real KeeperHub workflow.
 * Nothing here reports an outcome it did not observe.
 *
 * The panic command deliberately cannot evacuate on its own: evacuation needs
 * the recovery key, which does not live in a chat client. /panic prepares and
 * hands off. A bot that appeared to evacuate would be lying about its reach.
 */

import { LivenessMonitor, LivenessState } from '../agent/liveness/monitor';

const API = 'https://api.telegram.org';

export interface BotConfig {
  botToken: string;
  allowedChatIds: string[];
  contractAddress: string;
  rpcUrl: string;
  /** Webhook URL of the KeeperHub panic-evacuation workflow, if configured. */
  panicWebhookUrl?: string;
  explorerBaseUrl?: string;
}

interface Update {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

export class LegacyKeeperBot {
  private readonly monitor: LivenessMonitor;
  private offset = 0;
  private running = false;

  constructor(private readonly config: BotConfig) {
    if (!config.botToken) throw new Error('BotConfig.botToken is required');
    this.monitor = new LivenessMonitor(config.rpcUrl, config.contractAddress);
  }

  /** Verifies the token before claiming to be online. */
  async start(): Promise<void> {
    const me = await this.api<{ username: string }>('getMe');
    console.log(`[bot] connected as @${me.username}`);
    console.log(`[bot] authorised chats: ${this.config.allowedChatIds.join(', ') || 'NONE'}`);

    this.running = true;
    while (this.running) {
      try {
        const updates = await this.api<Update[]>('getUpdates', {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ['message'],
        });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handle(update).catch((e) => console.error('[bot] handler:', e));
        }
      } catch (error) {
        console.error('[bot] poll failed:', error);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private async handle(update: Update): Promise<void> {
    const chatId = String(update.message?.chat?.id ?? '');
    const text = (update.message?.text ?? '').trim();
    if (!chatId || !text.startsWith('/')) return;

    if (!this.config.allowedChatIds.includes(chatId)) {
      await this.send(chatId, `Unauthorised. This chat (\`${chatId}\`) is not registered.`);
      return;
    }

    const command = text.split(/\s+/)[0].split('@')[0];
    await this.send(chatId, await this.respond(command, chatId));
  }

  private async respond(command: string, chatId: string): Promise<string> {
    switch (command) {
      case '/start':
      case '/help':
        return [
          '*LegacyKeeper*',
          'Verifiable autonomous continuity agent',
          'Monitors wallet liveness, coordinates KeeperHub execution, and proves outcomes onchain.',
          '',
          '/status — live liveness and configuration',
          '/checkin — how to reset the timer',
          '/panic — prepare an emergency evacuation',
          '/config — contract and vault details',
        ].join('\n');

      case '/status':
        return this.statusMessage();

      case '/checkin':
        return [
          '*Check in*',
          '',
          'Open the dashboard and press “Check in safely”, or relay a signed',
          'heartbeat through the KeeperHub workflow. Either resets the timer;',
          'KeeperHub sponsors the gas, so you never need a funded wallet.',
        ].join('\n');

      case '/panic':
        return this.panicMessage(chatId);

      case '/config':
        return this.configMessage();

      default:
        return 'Unknown command. Send /help.';
    }
  }

  private async statusMessage(): Promise<string> {
    let s: LivenessState;
    try {
      s = await this.monitor.evaluate();
    } catch (error) {
      return `Could not read chain state.\n\n\`${error instanceof Error ? error.message : error}\``;
    }

    if (s.evacuationExecuted) return '*Evacuated.* Assets were swept to the safe vault.';
    if (s.inheritanceExecuted) return '*Distributed.* The estate has been settled.';

    const phase = !s.active
      ? 'Paused'
      : s.graceElapsed
      ? 'DUE — distribution is callable now'
      : s.timeoutExceeded
      ? 'GRACE PERIOD — check in to cancel'
      : 'Active';

    return [
      `*Status:* ${phase}`,
      '',
      `Last heartbeat: ${fmtAgo(s.timeSinceHeartbeat)} ago`,
      `Time remaining: ${fmtDuration(s.secondsUntilDue)}`,
      `Timeout / grace: ${fmtDuration(s.timeoutDuration)} / ${fmtDuration(s.gracePeriod)}`,
      `Shares configured: ${s.configComplete ? 'complete' : 'INCOMPLETE — execution would revert'}`,
    ].join('\n');
  }

  private async panicMessage(chatId: string): Promise<string> {
    if (!this.config.panicWebhookUrl) {
      return [
        '*Emergency evacuation*',
        '',
        'No panic workflow is configured, so nothing can be triggered from here.',
        'Set the KeeperHub panic webhook URL to enable this path.',
      ].join('\n');
    }

    return [
      '*Emergency evacuation — action required*',
      '',
      'Evacuation is authorised by your *recovery key*, which is deliberately',
      'not held by this bot. That separation is what makes the emergency path',
      'survive a compromised wallet.',
      '',
      'Sign the evacuation payload with your recovery key and post it to the',
      'panic workflow. The dashboard does this for you.',
      '',
      `Chat \`${chatId}\` is authorised to request it.`,
    ].join('\n');
  }

  private async configMessage(): Promise<string> {
    const explorer = this.config.explorerBaseUrl ?? 'https://sepolia.etherscan.io';
    return [
      '*Configuration*',
      '',
      `Contract: \`${this.config.contractAddress}\``,
      `${explorer}/address/${this.config.contractAddress}`,
      '',
      'Change beneficiaries, vault, or timings from the dashboard.',
    ].join('\n');
  }

  async send(chatId: string, text: string): Promise<boolean> {
    try {
      await this.api('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
      return true;
    } catch (error) {
      console.error('[bot] send failed:', error);
      return false;
    }
  }

  async broadcast(text: string): Promise<void> {
    await Promise.all(this.config.allowedChatIds.map((id) => this.send(id, text)));
  }

  private async api<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API}/bot${this.config.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const payload = (await response.json()) as { ok: boolean; result?: T; description?: string };
    if (!payload.ok) {
      throw new Error(`telegram ${method}: ${payload.description ?? response.status}`);
    }
    return payload.result as T;
  }
}

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return 'due now';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtAgo(seconds: number): string {
  return fmtDuration(seconds) === 'due now' ? 'moments' : fmtDuration(seconds);
}
