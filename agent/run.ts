#!/usr/bin/env node
/**
 * LegacyKeeper agent runtime.
 *
 * Long-running process: watches liveness, drives KeeperHub when the estate
 * comes due, and optionally serves the Telegram bot in the same process.
 *
 *   npx tsx agent/run.ts              # monitor only
 *   npx tsx agent/run.ts --with-bot   # monitor + Telegram
 *   npx tsx agent/run.ts --once       # single evaluation, then exit
 *
 * Refuses to start on incomplete configuration rather than running in a
 * degraded state that looks healthy.
 */

import 'dotenv/config';
import { LegacyKeeperAgent } from './index';
import { LegacyKeeperBot } from '../bot/index';

async function main() {
  const once = process.argv.includes('--once');
  const withBot = process.argv.includes('--with-bot');

  const config = {
    keeperhubApiKey: required('KEEPERHUB_API_KEY'),
    keeperhubMcpUrl: process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp',
    rpcUrl: required('SEPOLIA_RPC_URL'),
    contractAddress: required('LEGACY_KEEPER_ADDRESS'),
    chainId: Number(process.env.CHAIN_ID ?? 11155111),
    checkIntervalMs: Number(process.env.CHECK_INTERVAL_MS ?? 60_000),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
  };

  const agent = new LegacyKeeperAgent(config);

  if (once) {
    await agent.mcp.connect();
    const state = await agent.tick();
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  const shutdown = (signal: string) => {
    console.log(`\n[run] ${signal} — stopping`);
    agent.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await agent.start();

  if (withBot) {
    if (!config.telegramBotToken || !config.telegramChatId) {
      throw new Error('--with-bot requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
    }
    const bot = new LegacyKeeperBot({
      botToken: config.telegramBotToken,
      allowedChatIds: config.telegramChatId.split(',').map((s) => s.trim()),
      contractAddress: config.contractAddress,
      rpcUrl: config.rpcUrl,
    });
    // Polls forever alongside the monitor.
    void bot.start();
  }

  console.log('[run] agent is live; Ctrl-C to stop');
  await new Promise(() => {}); // run until signalled
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required. The agent will not start half-configured — a monitor ` +
        `that silently cannot execute is worse than one that refuses to boot.`
    );
  }
  return value;
}

main().catch((error) => {
  console.error('[run]', error instanceof Error ? error.message : error);
  process.exit(1);
});
