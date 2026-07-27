/**
 * KeeperHub workflow definitions for LegacyKeeper.
 *
 * Built against the live `workflowStructure` schema (nodes + edges, react-flow
 * shaped) discovered via `list_action_schemas` — not inferred. Node references
 * use the documented `{{@nodeId:Label.field}}` template syntax.
 *
 * Between them these exercise every automatic trigger the platform offers:
 * Schedule, Webhook, Event and Block — plus Condition, contract read, contract
 * write and native notification actions.
 */

export const SEPOLIA = '11155111';

const READ_ABI = JSON.stringify([
  {
    name: 'getTimeoutStatus', type: 'function', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'timeoutExceeded', type: 'bool' },
      { name: 'graceElapsed', type: 'bool' },
    ],
  },
]);

const INHERIT_ABI = JSON.stringify([
  { name: 'executeInheritance', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
]);

const EVACUATE_ABI = JSON.stringify([
  {
    name: 'evacuate', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
]);

const HEARTBEAT_ABI = JSON.stringify([
  {
    name: 'heartbeatBySig', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
]);

const EVENT_ABI = JSON.stringify([
  {
    name: 'GracePeriodEntered', type: 'event', inputs: [{ name: 'deadline', type: 'uint64', indexed: false }],
  },
]);

export interface WorkflowDef {
  key: string;
  name: string;
  description: string;
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
}

const node = (id: string, label: string, type: 'trigger' | 'action', config: unknown, description?: string) => ({
  id, type,
  data: { label, description, type, config, status: 'idle' },
});

const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ''}`,
  source, target, ...(sourceHandle ? { sourceHandle } : {}),
});

export function buildWorkflows(contract: string, chatId: string): WorkflowDef[] {
  return [
    // ── 1. Schedule → read → condition → write. The unattended core of Mode A.
    {
      key: 'liveness-monitor',
      name: 'LegacyKeeper — Liveness Monitor',
      description:
        'Scheduled liveness evaluation. Reads getTimeoutStatus and distributes the estate once the grace period has elapsed. This is Mode A running with nobody awake.',
      nodes: [
        node('trigger-1', 'Every 5 minutes', 'trigger', { triggerType: 'Schedule', scheduleCron: '*/5 * * * *', scheduleTimezone: 'UTC' }),
        node('read-status', 'Read Timeout Status', 'action', {
          actionType: 'web3/read-contract', network: SEPOLIA,
          contractAddress: contract, abi: READ_ABI, abiFunction: 'getTimeoutStatus', functionArgs: '[]',
        }),
        node('is-due', 'Grace Elapsed?', 'action', {
          actionType: 'Condition',
          condition: '{{@read-status:Read Timeout Status.result.graceElapsed}} == true',
        }),
        node('distribute', 'Execute Inheritance', 'action', {
          actionType: 'web3/write-contract', network: SEPOLIA,
          contractAddress: contract, abi: INHERIT_ABI, abiFunction: 'executeInheritance', functionArgs: '[]',
        }),
        node('notify', 'Notify Beneficiaries', 'action', {
          actionType: 'telegram/send-message', chatId,
          message: 'LegacyKeeper: estate distributed. tx {{@distribute:Execute Inheritance.transactionHash}}',
        }),
      ],
      edges: [
        edge('trigger-1', 'read-status'),
        edge('read-status', 'is-due'),
        edge('is-due', 'distribute', 'true'),
        edge('distribute', 'notify'),
      ],
    },

    // ── 2. Webhook → write. Mode B's external trigger.
    {
      key: 'panic-evacuation',
      name: 'LegacyKeeper — Panic Evacuation',
      description:
        'Authenticated panic path. Accepts a recovery-key signature from the dashboard or bot and sweeps assets to the safe vault. The owner key is never involved.',
      nodes: [
        node('trigger-1', 'Panic Webhook', 'trigger', {
          triggerType: 'Webhook',
          webhookSchema: JSON.stringify({
            type: 'object',
            required: ['nonce', 'deadline', 'signature'],
            properties: { nonce: { type: 'string' }, deadline: { type: 'string' }, signature: { type: 'string' } },
          }),
        }),
        node('evacuate', 'Evacuate To Vault', 'action', {
          actionType: 'web3/write-contract', network: SEPOLIA,
          contractAddress: contract, abi: EVACUATE_ABI, abiFunction: 'evacuate',
          functionArgs: '["{{@trigger-1:Panic Webhook.nonce}}","{{@trigger-1:Panic Webhook.deadline}}","{{@trigger-1:Panic Webhook.signature}}"]',
        }),
        node('notify', 'Confirm Evacuation', 'action', {
          actionType: 'telegram/send-message', chatId,
          message: 'LegacyKeeper: EVACUATION EXECUTED. tx {{@evacuate:Evacuate To Vault.transactionHash}}',
        }),
      ],
      edges: [edge('trigger-1', 'evacuate'), edge('evacuate', 'notify')],
    },

    // ── 3. Webhook → write. Gasless relayed heartbeat.
    {
      key: 'heartbeat-relay',
      name: 'LegacyKeeper — Heartbeat Relay',
      description:
        'Relays an owner-signed EIP-712 heartbeat so proving liveness never requires the owner to hold gas.',
      nodes: [
        node('trigger-1', 'Heartbeat Webhook', 'trigger', { triggerType: 'Webhook' }),
        node('relay', 'Relay Heartbeat', 'action', {
          actionType: 'web3/write-contract', network: SEPOLIA,
          contractAddress: contract, abi: HEARTBEAT_ABI, abiFunction: 'heartbeatBySig',
          functionArgs: '["{{@trigger-1:Heartbeat Webhook.nonce}}","{{@trigger-1:Heartbeat Webhook.deadline}}","{{@trigger-1:Heartbeat Webhook.signature}}"]',
        }),
      ],
      edges: [edge('trigger-1', 'relay')],
    },

    // ── 4. Event trigger. Chain state observed directly, not polled.
    {
      key: 'grace-watch',
      name: 'LegacyKeeper — Grace Period Watch',
      description:
        'Listens for GracePeriodEntered on-chain and alerts immediately. Escalation stops depending on a polling loop being alive.',
      nodes: [
        node('trigger-1', 'GracePeriodEntered', 'trigger', {
          triggerType: 'Event', network: SEPOLIA,
          contractAddress: contract, contractABI: EVENT_ABI, eventName: 'GracePeriodEntered',
        }),
        node('alert', 'Escalate To Owner', 'action', {
          actionType: 'telegram/send-message', chatId,
          message: 'LegacyKeeper: grace period has begun. Check in now to cancel distribution.',
        }),
      ],
      edges: [edge('trigger-1', 'alert')],
    },

    // ── 5. Block trigger. A second scheduling failure domain.
    {
      key: 'block-health',
      name: 'LegacyKeeper — Block Health Check',
      description:
        'Chain-native liveness check every 50 blocks. Deliberately redundant with the cron monitor so a single scheduler outage cannot silently stop the estate from executing.',
      nodes: [
        node('trigger-1', 'Every 50 Blocks', 'trigger', { triggerType: 'Block', network: SEPOLIA, blockInterval: '50' }),
        node('read-status', 'Read Timeout Status', 'action', {
          actionType: 'web3/read-contract', network: SEPOLIA,
          contractAddress: contract, abi: READ_ABI, abiFunction: 'getTimeoutStatus', functionArgs: '[]',
        }),
        node('overdue', 'Overdue?', 'action', {
          actionType: 'Condition',
          condition: '{{@read-status:Read Timeout Status.result.graceElapsed}} == true',
        }),
        node('alert', 'Alert Missed Execution', 'action', {
          actionType: 'telegram/send-message', chatId,
          message: 'LegacyKeeper: distribution is due but has not executed. The scheduled monitor may be down.',
        }),
      ],
      edges: [
        edge('trigger-1', 'read-status'),
        edge('read-status', 'overdue'),
        edge('overdue', 'alert', 'true'),
      ],
    },
  ];
}
