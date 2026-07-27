# LegacyKeeper

**Your autonomous onchain emergency & inheritance agent, powered by KeeperHub.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

LegacyKeeper solves two of the most expensive failure modes in crypto: **loss of access** (lost keys, incapacitation, death) and **wallet compromise** (active attack). Instead of requiring multisig signers or trusted custodians, it uses an autonomous agent running on KeeperHub to execute independently of your compromised or missing keys.

## Two-Mode Agent

### Mode A: Inheritance (passive)

| Feature | Status |
|---------|--------|
| Onchain heartbeat signatures (EIP-712) | ✅ |
| Configurable timeout (30d default) | ✅ |
| Grace period with alerts (7d default) | ✅ |
| Telegram/Discord/Email notifications | ✅ |
| Cancelation before execution | ✅ |
| Onchain asset transfer to beneficiaries | ✅ |
| KeeperHub scheduled workflow | ✅ |

### Mode B: Emergency Evacuation (instant)

| Feature | Status |
|---------|--------|
| Panic trigger — Telegram, dashboard, secret URL | ✅ |
| Recovery key authentication (separate from wallet key) | ✅ |
| Instant asset sweep (native + ERC-20s) | ✅ |
| KeeperHub private routing (MEV protection) | ✅ |
| Gas sponsorship (no pre-funded wallet needed) | ✅ |
| KeeperHub audit trail | ✅ |

## Quick Start

```bash
git clone https://github.com/your-org/legacy-keeper
cd legacy-keeper

# Run the setup wizard (5 minutes)
chmod +x starter/setup.sh
./starter/setup.sh

# Or do it manually:
npm install
cp .env.example .env
# Edit .env with your credentials
npx hardhat run scripts/deploy.ts --network sepolia
```

See the **[full tutorial](starter/docs/tutorial.md)** for step-by-step instructions.

## Architecture

```
┌──────────────┐    ┌───────────────┐    ┌────────────────────┐
│  Dashboard   │───▶│  Agent (TS)   │───▶│  KeeperHub         │
│  (HTML/CSS)  │    │  + Bot        │    │  MCP + Workflows   │
└──────────────┘    └───────────────┘    └────────────────────┘
                           │                       │
                           ▼                       ▼
                     ┌─────────────┐       ┌──────────────┐
                     │  Telegram   │       │  EVM Chain   │
                     │  Bot        │       │  (Sepolia)   │
                     └─────────────┘       └──────────────┘
```

**Key principle:** All onchain execution flows through KeeperHub. No direct RPC calls for transactions.

## Project Structure

```
legacy-keeper/
├── agent/                    # Core agent logic
│   ├── liveness/monitor.ts   # Heartbeat tracking & timeout detection
│   ├── executor/keeperhub.ts # KeeperHub workflow orchestration
│   ├── alert/notifier.ts     # Multi-channel alerts
│   └── index.ts              # Agent entry point
├── bot/
│   └── index.ts              # Telegram bot (alerts + panic trigger)
├── contracts/
│   └── LegacyKeeper.sol      # Onchain config & execution
├── dashboard/
│   └── index.html            # Web dashboard (Guardian design)
├── starter/                  # BOUNTY: reusable KeeperHub starter kit
│   ├── config/               # MCP configuration
│   ├── templates/            # Workflow definitions (JSON)
│   ├── examples/             # Usage examples
│   ├── docs/tutorial.md      # Step-by-step tutorial
│   └── setup.sh              # Setup wizard
├── proposals/                # UI design proposals
├── reports/                  # Upstream bug/doc gap reports
└── .env.example              # Configuration template
```

## Smart Contract

The `LegacyKeeper.sol` contract stores all onchain configuration:
- **Beneficiaries** — wallet addresses with share percentages (in basis points)
- **Liveness config** — heartbeat interval, timeout, grace period
- **Safe vault** — evacuation destination address
- **Recovery key** — separate key for emergency authorization
- **Heartbeat ledger** — timestamped, EIP-712 signed records

Deployed to Sepolia testnet. Expandable to mainnet and additional EVM chains.

## KeeperHub Integration

| Technology | Usage |
|------------|-------|
| MCP Server | Agent discovers & triggers workflows |
| Scheduled Workflows | Liveness → inheritance execution |
| HTTP-triggered Workflows | Panic button → evacuation |
| Gas Sponsorship | Mainnet transactions without pre-funded wallet |
| Private Routing | MEV protection for emergency transfer |
| Audit Trail | Verifiable execution proof |

## Dashboard Preview

The dashboard uses a warm, approachable design ("The Guardian") with:
- Real-time liveness status with heartbeat timeline
- Beneficiary management with share percentages
- Inheritance configuration (grace period, timeout, alerts)
- Security & vault status indicators
- Secret panic trigger URLs
- Confirmation modal for irreversible actions

Open `dashboard/index.html` in any browser to use it.

## License

MIT
