import express, { Request, Response } from 'express';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as crypto from 'crypto';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// In-memory storage (use database in production)
const agents: Map<string, any> = new Map();
const modelProfiles: Map<string, any> = new Map();
const intents: Map<string, any> = new Map();

const connection = new Connection(RPC_URL, 'confirmed');

// === Health Check ===
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'solana-agent-mesh',
    timestamp: new Date().toISOString(),
  });
});

// === Agent Endpoints ===

// Register agent (off-chain registry, complements on-chain)
app.post('/api/agents', (req: Request, res: Response) => {
  const { ownerWallet, agentWallet, modelProfile, metadataUri, permissions } = req.body;

  if (!ownerWallet || !agentWallet) {
    return res.status(400).json({ error: 'ownerWallet and agentWallet required' });
  }

  const agentId = crypto.randomUUID();
  const agent = {
    id: agentId,
    ownerWallet,
    agentWallet,
    modelProfile: modelProfile || null,
    metadataUri: metadataUri || '',
    permissions: permissions || 0,
    createdAt: new Date().toISOString(),
  };

  agents.set(agentId, agent);

  res.status(201).json({ agent });
});

// List agents
app.get('/api/agents', (req: Request, res: Response) => {
  const agentList = Array.from(agents.values());
  res.json({ agents: agentList, count: agentList.length });
});

// Get agent by ID
app.get('/api/agents/:id', (req: Request, res: Response) => {
  const agent = agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json({ agent });
});

// Update agent
app.put('/api/agents/:id', (req: Request, res: Response) => {
  const agent = agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const { agentWallet, modelProfile, metadataUri, permissions } = req.body;

  if (agentWallet) agent.agentWallet = agentWallet;
  if (modelProfile) agent.modelProfile = modelProfile;
  if (metadataUri) agent.metadataUri = metadataUri;
  if (permissions !== undefined) agent.permissions = permissions;

  agent.updatedAt = new Date().toISOString();
  agents.set(req.params.id, agent);

  res.json({ agent });
});

// === Model Profile Endpoints ===

// Create model profile
app.post('/api/model-profiles', (req: Request, res: Response) => {
  const {
    ownerWallet,
    label,
    providerUri,
    pricing,
    billingWallet,
    maxTokensPerDay,
    maxRequestsPerMin,
  } = req.body;

  if (!ownerWallet || !label || !providerUri) {
    return res.status(400).json({ error: 'ownerWallet, label, and providerUri required' });
  }

  const profileId = crypto.randomUUID();
  const profile = {
    id: profileId,
    ownerWallet,
    label,
    providerUri,
    pricing: pricing || 0,
    billingWallet: billingWallet || ownerWallet,
    maxTokensPerDay: maxTokensPerDay || 1000000,
    maxRequestsPerMin: maxRequestsPerMin || 60,
    createdAt: new Date().toISOString(),
  };

  modelProfiles.set(profileId, profile);

  res.status(201).json({ profile });
});

// List model profiles
app.get('/api/model-profiles', (req: Request, res: Response) => {
  const profileList = Array.from(modelProfiles.values());
  res.json({ profiles: profileList, count: profileList.length });
});

// Get model profile by ID
app.get('/api/model-profiles/:id', (req: Request, res: Response) => {
  const profile = modelProfiles.get(req.params.id);
  if (!profile) {
    return res.status(404).json({ error: 'Model profile not found' });
  }
  res.json({ profile });
});

// Update model profile
app.put('/api/model-profiles/:id', (req: Request, res: Response) => {
  const profile = modelProfiles.get(req.params.id);
  if (!profile) {
    return res.status(404).json({ error: 'Model profile not found' });
  }

  const { label, providerUri, pricing, billingWallet, maxTokensPerDay, maxRequestsPerMin } = req.body;

  if (label) profile.label = label;
  if (providerUri) profile.providerUri = providerUri;
  if (pricing !== undefined) profile.pricing = pricing;
  if (billingWallet) profile.billingWallet = billingWallet;
  if (maxTokensPerDay) profile.maxTokensPerDay = maxTokensPerDay;
  if (maxRequestsPerMin) profile.maxRequestsPerMin = maxRequestsPerMin;

  profile.updatedAt = new Date().toISOString();
  modelProfiles.set(req.params.id, profile);

  res.json({ profile });
});

// === Intent Endpoints ===

// Create intent
app.post('/api/intents', async (req: Request, res: Response) => {
  const { fromAgent, toAgent, payload, paymentAmount, paymentMint } = req.body;

  if (!fromAgent || !toAgent || !payload) {
    return res.status(400).json({ error: 'fromAgent, toAgent, and payload required' });
  }

  const intentId = crypto.randomUUID();
  const payloadStr = JSON.stringify(payload);
  const payloadHash = crypto.createHash('sha256').update(payloadStr).digest('hex');

  // In production, upload payload to IPFS/Arweave
  const payloadUri = `https://mesh.example.com/payloads/${intentId}`;

  const intent = {
    id: intentId,
    fromAgent,
    toAgent,
    nonce: Date.now(),
    status: 'pending',
    payloadHash,
    payloadUri,
    payload, // Store inline for demo
    paymentAmount: paymentAmount || 0,
    paymentMint: paymentMint || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    resultHash: null,
    resultUri: null,
    result: null,
    createdAt: new Date().toISOString(),
  };

  intents.set(intentId, intent);

  res.status(201).json({ intent });
});

// List intents
app.get('/api/intents', (req: Request, res: Response) => {
  const { fromAgent, toAgent, status } = req.query;

  let intentList = Array.from(intents.values());

  if (fromAgent) {
    intentList = intentList.filter((i) => i.fromAgent === fromAgent);
  }
  if (toAgent) {
    intentList = intentList.filter((i) => i.toAgent === toAgent);
  }
  if (status) {
    intentList = intentList.filter((i) => i.status === status);
  }

  res.json({ intents: intentList, count: intentList.length });
});

// Get intent by ID
app.get('/api/intents/:id', (req: Request, res: Response) => {
  const intent = intents.get(req.params.id);
  if (!intent) {
    return res.status(404).json({ error: 'Intent not found' });
  }
  res.json({ intent });
});

// Update intent status (process/complete)
app.put('/api/intents/:id/status', async (req: Request, res: Response) => {
  const intent = intents.get(req.params.id);
  if (!intent) {
    return res.status(404).json({ error: 'Intent not found' });
  }

  const { status, result } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'status required' });
  }

  intent.status = status;

  if (result) {
    intent.result = result;
    const resultStr = JSON.stringify(result);
    intent.resultHash = crypto.createHash('sha256').update(resultStr).digest('hex');
    intent.resultUri = `https://mesh.example.com/results/${intent.id}`;
  }

  intent.updatedAt = new Date().toISOString();
  intents.set(req.params.id, intent);

  res.json({ intent });
});

// === LLM Proxy Endpoint ===

// Simple LLM call (routes based on model profile)
app.post('/api/llm/call', async (req: Request, res: Response) => {
  const { profileId, prompt, options } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt required' });
  }

  let profile = profileId ? modelProfiles.get(profileId) : null;

  // Default response for demo
  const response = {
    profileId: profile?.id || 'default',
    model: profile?.label || 'mock-model',
    prompt: prompt.substring(0, 100),
    response: `[Mock LLM Response] Processed: "${prompt.substring(0, 50)}..."`,
    tokens: prompt.split(' ').length * 2,
    timestamp: new Date().toISOString(),
  };

  res.json(response);
});

// === Demo Data Endpoint ===

app.post('/api/demo/setup', (req: Request, res: Response) => {
  // Create demo agents
  const researchAgent = {
    id: 'research-agent-1',
    ownerWallet: 'Demo11111111111111111111111111111111111111',
    agentWallet: 'ResearchWallet1111111111111111111111111111',
    modelProfile: 'cheap-llm-profile',
    metadataUri: 'https://mesh.example.com/agents/research.json',
    permissions: 8, // CAN_CREATE_INTENT
    createdAt: new Date().toISOString(),
  };

  const executionAgent = {
    id: 'execution-agent-1',
    ownerWallet: 'Demo11111111111111111111111111111111111111',
    agentWallet: 'ExecutionWallet11111111111111111111111111',
    modelProfile: 'high-accuracy-profile',
    metadataUri: 'https://mesh.example.com/agents/execution.json',
    permissions: 1 | 2 | 16, // CAN_SWAP | CAN_TRANSFER | CAN_ACCEPT_INTENT
    createdAt: new Date().toISOString(),
  };

  agents.set(researchAgent.id, researchAgent);
  agents.set(executionAgent.id, executionAgent);

  // Create demo model profiles
  const cheapProfile = {
    id: 'cheap-llm-profile',
    ownerWallet: 'Demo11111111111111111111111111111111111111',
    label: 'cheap-llm',
    providerUri: 'https://mesh-gateway.example.com/cheap',
    pricing: 100, // 100 micro-USDC per 1K tokens
    billingWallet: 'Billing1111111111111111111111111111111111',
    maxTokensPerDay: 10000000,
    maxRequestsPerMin: 100,
    createdAt: new Date().toISOString(),
  };

  const accurateProfile = {
    id: 'high-accuracy-profile',
    ownerWallet: 'Demo11111111111111111111111111111111111111',
    label: 'high-accuracy-llm',
    providerUri: 'https://mesh-gateway.example.com/accurate',
    pricing: 1000, // 1000 micro-USDC per 1K tokens
    billingWallet: 'Billing1111111111111111111111111111111111',
    maxTokensPerDay: 1000000,
    maxRequestsPerMin: 30,
    createdAt: new Date().toISOString(),
  };

  modelProfiles.set(cheapProfile.id, cheapProfile);
  modelProfiles.set(accurateProfile.id, accurateProfile);

  res.json({
    message: 'Demo data created',
    agents: [researchAgent, executionAgent],
    profiles: [cheapProfile, accurateProfile],
  });
});

// === Start Server ===

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           Solana Agent Mesh - API Server                  ║
╠═══════════════════════════════════════════════════════════╣
║  Endpoints:                                               ║
║    GET  /health              - Health check               ║
║    POST /api/agents          - Register agent             ║
║    GET  /api/agents          - List agents                ║
║    POST /api/model-profiles  - Create model profile       ║
║    GET  /api/model-profiles  - List profiles              ║
║    POST /api/intents         - Create intent              ║
║    GET  /api/intents         - List intents               ║
║    PUT  /api/intents/:id/status - Update intent status    ║
║    POST /api/llm/call        - Proxy LLM call             ║
║    POST /api/demo/setup      - Setup demo data            ║
╠═══════════════════════════════════════════════════════════╣
║  Server running on port ${PORT}                              ║
║  RPC: ${RPC_URL.substring(0, 40)}...            ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;
