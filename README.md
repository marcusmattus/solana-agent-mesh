# Solana Agent Mesh

**Wallet-Attached, Model-Aware Agent Platform for Solana**

A composable infrastructure layer enabling agent-to-agent communication, LLM model management, and wallet-based permissions on Solana.

## 🎯 Problem

Today's AI agents are:
- Tied to a single app/wallet
- Hardwired to specific LLM providers
- Not composable with other agents in a permissioned, on-chain way

## ✨ Solution

Solana Agent Mesh provides:

| Feature | Description |
|---------|-------------|
| **On-chain Agent Identity** | Each agent has a Solana PDA with configurable permissions |
| **Model Profiles** | LLM configurations stored on-chain (provider, pricing, limits) |
| **Agent Intents** | On-chain messaging between agents with optional payments |
| **Multi-wallet Support** | One team can run multiple agents with different wallets/permissions |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Solana Agent Mesh                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐   Intent    ┌─────────────┐                   │
│  │ Research    │ ─────────▶  │ Execution   │                   │
│  │ Agent       │             │ Agent       │                   │
│  │ (cheap LLM) │  ◀─────────  │ (accurate)  │                   │
│  └──────┬──────┘   Result    └──────┬──────┘                   │
│         │                           │                           │
│         ▼                           ▼                           │
│  ┌─────────────┐            ┌─────────────┐                    │
│  │ Model       │            │ Model       │                    │
│  │ Profile A   │            │ Profile B   │                    │
│  │ (DeepSeek)  │            │ (GPT-4)     │                    │
│  └─────────────┘            └─────────────┘                    │
│                                                                 │
│  ══════════════════ Solana Blockchain ══════════════════════   │
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │ Agent   │  │ Agent   │  │ Model   │  │ Intent  │           │
│  │ PDA 1   │  │ PDA 2   │  │ Profile │  │ PDA     │           │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 📦 Project Structure

```
solana-agent-mesh/
├── programs/
│   └── agent-mesh/
│       └── src/
│           └── lib.rs          # Anchor program (PDAs, instructions)
├── app/
│   └── src/
│       ├── index.ts            # REST API server
│       └── mesh-controller.ts  # Off-chain runtime & LLM integration
├── Anchor.toml
└── README.md
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd app
npm install
```

### 2. Run API Server

```bash
npm run dev
```

### 3. Setup Demo Data

```bash
curl -X POST http://localhost:3000/api/demo/setup
```

### 4. Create an Intent

```bash
# Research agent sends task to execution agent
curl -X POST http://localhost:3000/api/intents \
  -H "Content-Type: application/json" \
  -d '{
    "fromAgent": "research-agent-1",
    "toAgent": "execution-agent-1",
    "payload": {
      "action": "swap",
      "params": {
        "inputMint": "SOL",
        "outputMint": "USDC",
        "amount": 1000000000
      }
    },
    "paymentAmount": 1000
  }'
```

## 🔧 On-Chain Program

### Account Types

#### Agent Identity PDA
```rust
pub struct AgentIdentity {
    pub owner_wallet: Pubkey,      // Controls config
    pub agent_wallet: Pubkey,      // Executes actions
    pub model_profile: Pubkey,     // LLM configuration
    pub metadata_uri: String,      // Off-chain metadata
    pub permissions: u64,          // Capability bitmask
}
```

#### Model Profile PDA
```rust
pub struct ModelProfile {
    pub label: String,             // "cheap-llm", "high-accuracy"
    pub provider_uri: String,      // LLM gateway URL
    pub pricing: u64,              // micro-USDC per 1K tokens
    pub billing_wallet: Pubkey,    // Receives payments
    pub max_tokens_per_day: u64,
    pub max_requests_per_min: u64,
}
```

#### Agent Intent PDA
```rust
pub struct AgentIntent {
    pub from_agent: Pubkey,
    pub to_agent: Pubkey,
    pub status: u8,                // Pending/Accepted/Completed/Failed
    pub payload_hash: [u8; 32],
    pub payload_uri: String,
    pub payment_amount: u64,
    pub result_hash: [u8; 32],
    pub result_uri: String,
}
```

### Permissions

| Flag | Value | Description |
|------|-------|-------------|
| `CAN_SWAP` | `1 << 0` | Execute token swaps |
| `CAN_TRANSFER` | `1 << 1` | Transfer tokens |
| `CAN_VOTE` | `1 << 2` | Participate in governance |
| `CAN_CREATE_INTENT` | `1 << 3` | Send requests to other agents |
| `CAN_ACCEPT_INTENT` | `1 << 4` | Process incoming requests |

## 🎮 Demo Scenarios

### Multi-Agent DeFi Orchestration

1. **Research Agent** (cheap LLM, read-only wallet):
   - Analyzes portfolio via off-chain indexers
   - Creates intent with swap recommendations

2. **Execution Agent** (accurate LLM, trading wallet):
   - Receives intent
   - Validates with high-quality LLM
   - Executes swap via Jupiter
   - Reports result on-chain

### On-Chain Model Swap

1. Agent uses Model Profile A (DeepSeek)
2. Run query → observe response quality
3. Update Model Profile A's `provider_uri` to GPT-4
4. Same query → improved response
5. **No code redeploy needed**

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/agents` | Register agent |
| GET | `/api/agents` | List agents |
| GET | `/api/agents/:id` | Get agent details |
| PUT | `/api/agents/:id` | Update agent |
| POST | `/api/model-profiles` | Create model profile |
| GET | `/api/model-profiles` | List profiles |
| PUT | `/api/model-profiles/:id` | Update profile |
| POST | `/api/intents` | Create intent |
| GET | `/api/intents` | List intents |
| PUT | `/api/intents/:id/status` | Update intent status |
| POST | `/api/llm/call` | Proxy LLM call |
| POST | `/api/demo/setup` | Setup demo data |

## 🔗 Solana Integration

- **PDAs**: Agent identities, model profiles, and intents stored on-chain
- **SPL Token Escrow**: Payment locked until intent completed
- **Events**: `AgentRegistered`, `IntentCreated`, `IntentStatusUpdated`
- **Jupiter Integration**: Swap execution via agent wallets
- **Devnet Deployed**: Program ID `AgentMesh111111111111111111111111111111111`

## 🏆 Hackathon Categories

- **Universal Software Agent Tools**: Reusable infra for any agent
- **SaaS Crypto Enabling Agents**: Model profiles as a service
- **AI**: LLM management and agent coordination

## 📄 License

MIT

---

**Built for Colosseum Agent Hackathon 2026** 🏛️
