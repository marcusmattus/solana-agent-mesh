import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { Program, AnchorProvider, Idl, BN } from '@coral-xyz/anchor';
import axios from 'axios';
import * as crypto from 'crypto';

// Program ID (update after deployment)
const PROGRAM_ID = new PublicKey('AgentMesh111111111111111111111111111111111');

// Permission flags matching on-chain
export const Permission = {
  CAN_SWAP: 1 << 0,
  CAN_TRANSFER: 1 << 1,
  CAN_VOTE: 1 << 2,
  CAN_CREATE_INTENT: 1 << 3,
  CAN_ACCEPT_INTENT: 1 << 4,
};

// Intent status
export enum IntentStatus {
  Pending = 0,
  Accepted = 1,
  Completed = 2,
  Failed = 3,
}

// Model Profile configuration
export interface ModelProfileConfig {
  label: string;
  providerUri: string;
  pricing: number;
  billingWallet: PublicKey;
  maxTokensPerDay: number;
  maxRequestsPerMin: number;
}

// Agent configuration
export interface AgentConfig {
  ownerWallet: PublicKey;
  agentWallet: PublicKey;
  modelProfile: PublicKey;
  metadataUri: string;
  permissions: number;
}

// Intent data
export interface IntentData {
  fromAgent: PublicKey;
  toAgent: PublicKey;
  nonce: number;
  status: IntentStatus;
  payloadHash: Uint8Array;
  payloadUri: string;
  paymentAmount: number;
  paymentMint: PublicKey;
  resultHash: Uint8Array;
  resultUri: string;
}

// LLM Provider interface
export interface LLMProvider {
  name: string;
  call(prompt: string, options?: any): Promise<string>;
}

// Simple OpenAI-compatible provider
export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1', model = 'gpt-4') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async call(prompt: string, options?: any): Promise<string> {
    const response = await axios.post(
      `${this.baseUrl}/chat/completions`,
      {
        model: options?.model || this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options?.maxTokens || 1000,
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.choices[0].message.content;
  }
}

// Mesh Controller - manages agents, profiles, and intents
export class MeshController {
  private connection: Connection;
  private provider: AnchorProvider;
  private agents: Map<string, AgentConfig> = new Map();
  private modelProfiles: Map<string, ModelProfileConfig> = new Map();
  private llmProviders: Map<string, LLMProvider> = new Map();
  private intentHandlers: Map<string, (intent: IntentData) => Promise<void>> = new Map();

  constructor(connection: Connection, provider: AnchorProvider) {
    this.connection = connection;
    this.provider = provider;
  }

  // Register an LLM provider for a model profile
  registerLLMProvider(profilePubkey: string, provider: LLMProvider) {
    this.llmProviders.set(profilePubkey, provider);
    console.log(`[Mesh] Registered LLM provider ${provider.name} for profile ${profilePubkey}`);
  }

  // Register an intent handler for an agent
  registerIntentHandler(agentPubkey: string, handler: (intent: IntentData) => Promise<void>) {
    this.intentHandlers.set(agentPubkey, handler);
    console.log(`[Mesh] Registered intent handler for agent ${agentPubkey}`);
  }

  // Get PDA for agent identity
  getAgentPDA(ownerWallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), ownerWallet.toBuffer()],
      PROGRAM_ID
    );
  }

  // Get PDA for model profile
  getModelProfilePDA(ownerWallet: PublicKey, profileId: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('model_profile'), ownerWallet.toBuffer(), profileId],
      PROGRAM_ID
    );
  }

  // Get PDA for intent
  getIntentPDA(fromAgent: PublicKey, toAgent: PublicKey, nonce: number): [PublicKey, number] {
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(BigInt(nonce));
    return PublicKey.findProgramAddressSync(
      [Buffer.from('intent'), fromAgent.toBuffer(), toAgent.toBuffer(), nonceBuffer],
      PROGRAM_ID
    );
  }

  // Subscribe to intent events
  async subscribeToIntents(agentPubkey: PublicKey) {
    console.log(`[Mesh] Subscribing to intents for agent ${agentPubkey.toBase58()}`);

    // In production, use WebSocket subscription to program logs
    // For demo, we poll for new intents
    setInterval(async () => {
      try {
        // Fetch program accounts filtered by to_agent
        const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
          filters: [
            { dataSize: 8 + 602 }, // Intent account size
            {
              memcmp: {
                offset: 8 + 32, // Skip discriminator + from_agent
                bytes: agentPubkey.toBase58(),
              },
            },
          ],
        });

        for (const { pubkey, account } of accounts) {
          // Parse intent and check if pending
          const handler = this.intentHandlers.get(agentPubkey.toBase58());
          if (handler) {
            // In production, decode account data properly
            console.log(`[Mesh] Found intent ${pubkey.toBase58()} for agent`);
          }
        }
      } catch (err) {
        console.error('[Mesh] Error polling intents:', err);
      }
    }, 5000);
  }

  // Process an intent with LLM
  async processIntent(intent: IntentData, agentConfig: AgentConfig): Promise<{ hash: Uint8Array; uri: string }> {
    // Fetch payload
    const payloadResponse = await axios.get(intent.payloadUri);
    const payload = payloadResponse.data;

    // Verify hash
    const computedHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest();
    if (!computedHash.equals(Buffer.from(intent.payloadHash))) {
      throw new Error('Payload hash mismatch');
    }

    // Get LLM provider for agent's model profile
    const llmProvider = this.llmProviders.get(agentConfig.modelProfile.toBase58());
    if (!llmProvider) {
      throw new Error('No LLM provider configured for model profile');
    }

    // Call LLM
    console.log(`[Mesh] Processing intent with LLM provider ${llmProvider.name}`);
    const result = await llmProvider.call(payload.prompt || JSON.stringify(payload));

    // Store result (in production, upload to IPFS/Arweave)
    const resultData = {
      input: payload,
      output: result,
      timestamp: Date.now(),
    };

    const resultHash = crypto.createHash('sha256').update(JSON.stringify(resultData)).digest();
    const resultUri = `https://mesh.example.com/results/${resultHash.toString('hex')}`; // Placeholder

    return {
      hash: resultHash,
      uri: resultUri,
    };
  }

  // Execute on-chain action (e.g., swap via Jupiter)
  async executeAction(agentConfig: AgentConfig, action: string, params: any): Promise<string> {
    console.log(`[Mesh] Executing action ${action} for agent ${agentConfig.agentWallet.toBase58()}`);

    // Check permissions
    if (action === 'swap' && !(agentConfig.permissions & Permission.CAN_SWAP)) {
      throw new Error('Agent does not have CAN_SWAP permission');
    }
    if (action === 'transfer' && !(agentConfig.permissions & Permission.CAN_TRANSFER)) {
      throw new Error('Agent does not have CAN_TRANSFER permission');
    }

    // In production, implement actual Jupiter/DeFi integration
    switch (action) {
      case 'swap':
        console.log(`[Mesh] Would execute swap: ${params.inputMint} -> ${params.outputMint}, amount: ${params.amount}`);
        return 'simulated-swap-tx-signature';

      case 'transfer':
        console.log(`[Mesh] Would execute transfer: ${params.amount} to ${params.destination}`);
        return 'simulated-transfer-tx-signature';

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}

// Demo: Create and run a simple mesh
async function main() {
  console.log('=== Solana Agent Mesh Controller ===\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Demo keypairs (in production, load from secure storage)
  const ownerKeypair = Keypair.generate();

  console.log(`Owner wallet: ${ownerKeypair.publicKey.toBase58()}`);

  // Create mock provider
  const mockWallet = {
    publicKey: ownerKeypair.publicKey,
    signTransaction: async (tx: Transaction) => tx,
    signAllTransactions: async (txs: Transaction[]) => txs,
  };

  const provider = new AnchorProvider(connection, mockWallet as any, {
    commitment: 'confirmed',
  });

  // Initialize mesh controller
  const mesh = new MeshController(connection, provider);

  // Get PDAs
  const [agentPDA] = mesh.getAgentPDA(ownerKeypair.publicKey);
  const profileId = crypto.randomBytes(16);
  const [modelProfilePDA] = mesh.getModelProfilePDA(ownerKeypair.publicKey, profileId);

  console.log(`\nAgent PDA: ${agentPDA.toBase58()}`);
  console.log(`Model Profile PDA: ${modelProfilePDA.toBase58()}`);

  // Register a mock LLM provider
  const mockLLM: LLMProvider = {
    name: 'mock-llm',
    call: async (prompt: string) => {
      console.log(`[MockLLM] Processing: ${prompt.substring(0, 50)}...`);
      return `Mock response for: ${prompt.substring(0, 30)}`;
    },
  };

  mesh.registerLLMProvider(modelProfilePDA.toBase58(), mockLLM);

  // Register intent handler
  mesh.registerIntentHandler(agentPDA.toBase58(), async (intent) => {
    console.log(`[Handler] Processing intent from ${intent.fromAgent.toBase58()}`);

    const agentConfig: AgentConfig = {
      ownerWallet: ownerKeypair.publicKey,
      agentWallet: ownerKeypair.publicKey,
      modelProfile: modelProfilePDA,
      metadataUri: 'https://example.com/agent.json',
      permissions: Permission.CAN_CREATE_INTENT | Permission.CAN_ACCEPT_INTENT | Permission.CAN_SWAP,
    };

    try {
      const result = await mesh.processIntent(intent, agentConfig);
      console.log(`[Handler] Intent processed, result hash: ${Buffer.from(result.hash).toString('hex').substring(0, 16)}...`);
    } catch (err) {
      console.error(`[Handler] Error processing intent:`, err);
    }
  });

  // Demo: simulate action execution
  const agentConfig: AgentConfig = {
    ownerWallet: ownerKeypair.publicKey,
    agentWallet: ownerKeypair.publicKey,
    modelProfile: modelProfilePDA,
    metadataUri: 'https://example.com/agent.json',
    permissions: Permission.CAN_SWAP | Permission.CAN_CREATE_INTENT,
  };

  console.log('\n--- Simulating Actions ---');

  try {
    const swapTx = await mesh.executeAction(agentConfig, 'swap', {
      inputMint: 'So11111111111111111111111111111111111111112', // SOL
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      amount: 1000000000, // 1 SOL
    });
    console.log(`Swap simulated: ${swapTx}`);
  } catch (err: any) {
    console.error(`Swap failed: ${err.message}`);
  }

  // Try transfer (should fail - no permission)
  try {
    const transferTx = await mesh.executeAction(agentConfig, 'transfer', {
      amount: 100000,
      destination: Keypair.generate().publicKey.toBase58(),
    });
    console.log(`Transfer simulated: ${transferTx}`);
  } catch (err: any) {
    console.error(`Transfer failed: ${err.message}`);
  }

  console.log('\n=== Mesh Controller Ready ===');
  console.log('In production, this would:');
  console.log('1. Subscribe to on-chain intent events');
  console.log('2. Process intents with configured LLM providers');
  console.log('3. Execute on-chain actions via agent wallets');
  console.log('4. Update intent status on completion');
}

main().catch(console.error);
