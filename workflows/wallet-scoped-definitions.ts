import type { WorkflowDef } from "./definitions";

const SEPOLIA = "11155111";
const FACTORY_READ_ABI = abi([
  {
    name: "planOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "plan", type: "address" }],
  },
]);
const CREATE_PLAN_ABI = abi([
  {
    name: "createPlan",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "heartbeatInterval", type: "uint64" },
          { name: "timeoutDuration", type: "uint64" },
          { name: "gracePeriod", type: "uint64" },
          { name: "beneficiaryWallets", type: "address[]" },
          { name: "beneficiaryShares", type: "uint16[]" },
          { name: "recoveryKey", type: "address" },
          { name: "safeVault", type: "address" },
          { name: "trackedTokens", type: "address[]" },
          { name: "allowSharedRecovery", type: "bool" },
        ],
      },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "planAddress", type: "address" }],
  },
]);

const SIGNED_ABIS = {
  setBeneficiariesBySig: signedAbi("setBeneficiariesBySig", [
    { name: "wallets", type: "address[]" },
    { name: "shares", type: "uint16[]" },
  ]),
  setLivenessConfigBySig: signedAbi("setLivenessConfigBySig", [
    { name: "heartbeatInterval", type: "uint64" },
    { name: "timeoutDuration", type: "uint64" },
    { name: "gracePeriod", type: "uint64" },
  ]),
  setRecoveryConfigBySig: signedAbi("setRecoveryConfigBySig", [
    { name: "recoveryKey", type: "address" },
    { name: "safeVault", type: "address" },
    { name: "allowSharedRecovery", type: "bool" },
  ]),
  setTrackedTokensBySig: signedAbi("setTrackedTokensBySig", [
    { name: "tokens", type: "address[]" },
  ]),
  heartbeatBySig: signedAbi("heartbeatBySig", []),
  evacuate: signedAbi("evacuate", []),
} as const;

interface ConfigurationAction {
  readonly action: string;
  readonly id: string;
  readonly label: string;
  readonly functionName: keyof Pick<
    typeof SIGNED_ABIS,
    | "setBeneficiariesBySig"
    | "setLivenessConfigBySig"
    | "setRecoveryConfigBySig"
    | "setTrackedTokensBySig"
  >;
}

const CONFIGURATION_ACTIONS: readonly ConfigurationAction[] = [
  {
    action: "beneficiaries",
    id: "set-beneficiaries",
    label: "Set Beneficiaries",
    functionName: "setBeneficiariesBySig",
  },
  {
    action: "liveness",
    id: "set-liveness",
    label: "Set Liveness",
    functionName: "setLivenessConfigBySig",
  },
  {
    action: "recovery",
    id: "set-recovery",
    label: "Set Recovery",
    functionName: "setRecoveryConfigBySig",
  },
  {
    action: "trackedTokens",
    id: "set-tokens",
    label: "Set Tracked Tokens",
    functionName: "setTrackedTokensBySig",
  },
];

export function buildWalletScopedWorkflows(factory: string): WorkflowDef[] {
  return [
    planCreationWorkflow(factory),
    configurationWorkflow(factory),
    signedPlanWorkflow(
      factory,
      "heartbeat-relay",
      "LegacyKeeper — Heartbeat Relay",
      "Heartbeat Webhook",
      "heartbeatBySig",
    ),
    signedPlanWorkflow(
      factory,
      "panic-evacuation",
      "LegacyKeeper — Panic Evacuation",
      "Panic Webhook",
      "evacuate",
    ),
  ];
}

function planCreationWorkflow(factory: string): WorkflowDef {
  return {
    key: "plan-creation",
    name: "LegacyKeeper — Plan Creation",
    description:
      "Creates one owner-signed wallet plan through the deployed factory.",
    nodes: [
      trigger("Plan Creation Webhook", ["functionArgs"]),
      write(
        "create-plan",
        "Create Owner Plan",
        factory,
        CREATE_PLAN_ABI,
        "createPlan",
      ),
    ],
    edges: [edge("trigger-1", "create-plan")],
  };
}

function configurationWorkflow(factory: string): WorkflowDef {
  return {
    key: "plan-configuration",
    name: "LegacyKeeper — Plan Configuration",
    description:
      "Re-resolves the owner plan, then relays one action-specific signature.",
    nodes: [
      trigger("Configuration Webhook", [
        "owner",
        "plan",
        "action",
        "functionArgs",
      ]),
      registryRead(factory, "Configuration Webhook"),
      registryCondition("Configuration Webhook"),
      ...CONFIGURATION_ACTIONS.flatMap(
        ({ action, id, label, functionName }, index) => [
          actionCondition(action, index),
          write(
            id,
            label,
            "{{@trigger-1:Configuration Webhook.plan}}",
            SIGNED_ABIS[functionName],
            functionName,
            "Configuration Webhook",
          ),
        ],
      ),
    ],
    edges: configurationEdges(),
  };
}

function signedPlanWorkflow(
  factory: string,
  key: string,
  name: string,
  label: string,
  functionName: "heartbeatBySig" | "evacuate",
): WorkflowDef {
  return {
    key,
    name,
    description:
      "Re-resolves the owner plan before relaying its signed action.",
    nodes: [
      trigger(label, ["owner", "plan", "functionArgs"]),
      registryRead(factory, label),
      registryCondition(label),
      write(
        "signed-write",
        functionName === "evacuate" ? "Evacuate To Vault" : "Relay Heartbeat",
        `{{@trigger-1:${label}.plan}}`,
        SIGNED_ABIS[functionName],
        functionName,
        label,
      ),
    ],
    edges: [
      edge("trigger-1", "resolve-plan"),
      edge("resolve-plan", "plan-matches"),
      edge("plan-matches", "signed-write", "true"),
    ],
  };
}

function trigger(
  label: string,
  required: readonly string[],
): Record<string, unknown> {
  const properties = Object.fromEntries(
    required.map((field) => [field, { type: "string" }]),
  );
  return node("trigger-1", label, "trigger", {
    triggerType: "Webhook",
    webhookSchema: JSON.stringify({
      type: "object",
      required,
      properties,
      additionalProperties: false,
    }),
  });
}

function registryRead(
  factory: string,
  triggerLabel: string,
): Record<string, unknown> {
  return node("resolve-plan", "Resolve Owner Plan", "action", {
    actionType: "web3/read-contract",
    network: SEPOLIA,
    contractAddress: factory,
    abi: FACTORY_READ_ABI,
    abiFunction: "planOf",
    functionArgs: `["{{@trigger-1:${triggerLabel}.owner}}"]`,
  });
}

function registryCondition(triggerLabel: string): Record<string, unknown> {
  return node("plan-matches", "Registered Plan?", "action", {
    actionType: "Condition",
    condition:
      `{{@resolve-plan:Resolve Owner Plan.result.plan}} === ` +
      `{{@trigger-1:${triggerLabel}.plan}}`,
  });
}

function actionCondition(
  action: string,
  index: number,
): Record<string, unknown> {
  return node(`is-action-${index}`, `Action Is ${action}`, "action", {
    actionType: "Condition",
    condition:
      `{{@trigger-1:Configuration Webhook.action}} === ` +
      JSON.stringify(action),
  });
}

function write(
  id: string,
  label: string,
  contractAddress: string,
  contractAbi: string,
  functionName: string,
  triggerLabel = "Plan Creation Webhook",
): Record<string, unknown> {
  return node(id, label, "action", {
    actionType: "web3/write-contract",
    network: SEPOLIA,
    contractAddress,
    abi: contractAbi,
    abiFunction: functionName,
    functionArgs: `{{@trigger-1:${triggerLabel}.functionArgs}}`,
  });
}

function configurationEdges(): Record<string, unknown>[] {
  return [
    edge("trigger-1", "resolve-plan"),
    edge("resolve-plan", "plan-matches"),
    edge("plan-matches", "is-action-0", "true"),
    ...CONFIGURATION_ACTIONS.flatMap(({ id: writeId }, index) => {
      const conditionId = `is-action-${index}`;
      const next = `is-action-${index + 1}`;
      return [
        edge(conditionId, writeId, "true"),
        ...(index < CONFIGURATION_ACTIONS.length - 1
          ? [edge(conditionId, next, "false")]
          : []),
      ];
    }),
  ];
}

function signedAbi(
  name: string,
  inputs: Array<{ name: string; type: string }>,
): string {
  return abi([
    {
      name,
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        ...inputs,
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "signature", type: "bytes" },
      ],
      outputs: [],
    },
  ]);
}

function node(
  id: string,
  label: string,
  type: "trigger" | "action",
  config: Record<string, unknown>,
): Record<string, unknown> {
  return { id, type, data: { label, type, config, status: "idle" } };
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string,
): Record<string, unknown> {
  return {
    id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ""}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  };
}

function abi(value: unknown[]): string {
  return JSON.stringify(value);
}
