/**
 * LegacyKeeper — Basic Setup Example
 *
 * This example shows you how to initialize the LegacyKeeper agent,
 * configure it with your KeeperHub credentials, and start monitoring.
 *
 * Run with: npx tsx examples/basic-setup.ts
 */

import { config } from 'dotenv';
import { LegacyKeeperAgent } from '../../agent/index';

// Load environment variables
config();

async function main() {
  // ── 1. Create the agent ──────────────────────────
  const agent = new LegacyKeeperAgent({
    keeperhubApiKey: process.env.KEEPERHUB_API_KEY!,
    keeperhubMcpUrl: process.env.KEEPERHUB_MCP_URL!,
    contractAddress: process.env.LEGACY_KEEPER_ADDRESS!,
    ownerAddress: process.env.OWNER_ADDRESS!,

    liveness: {
      heartbeatInterval: Number(process.env.HEARTBEAT_INTERVAL_SECONDS) || 86400,
      timeoutDuration: Number(process.env.TIMEOUT_DURATION_SECONDS) || 2592000,
      gracePeriod: Number(process.env.GRACE_PERIOD_SECONDS) || 604800,
    },

    // Notifications
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    emailConfig: process.env.EMAIL_HOST ? {
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT),
      user: process.env.EMAIL_USER!,
      pass: process.env.EMAIL_PASS!,
      from: process.env.EMAIL_FROM!,
      to: process.env.EMAIL_TO!,
    } : undefined,
  });

  // ── 2. Start monitoring ──────────────────────────
  console.log('Starting LegacyKeeper agent...');
  await agent.start();

  // ── 3. Manual heartbeat (optional) ───────────────
  // await agent.liveness.sendHeartbeat(process.env.OWNER_PRIVATE_KEY!);

  // ── 4. Check liveness status ─────────────────────
  const state = await agent.liveness.evaluate();
  console.log('Liveness state:', state);

  // ── 5. Graceful shutdown ─────────────────────────
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await agent.stop();
    process.exit(0);
  });

  // Keep the process alive
  console.log('Agent is running. Press Ctrl+C to stop.');
}

main().catch(console.error);
