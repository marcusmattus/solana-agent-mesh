import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import JupiterClient, { TOKENS } from './jupiter';
import SolanaClient, { YieldAggregator } from './solana-client';
import { MeshController, Permission, AgentConfig, IntentData, IntentStatus } from './mesh-controller';
import * as crypto from 'crypto';

/**
 * Research Agent - Analyzes portfolios and creates recommendations
 * Uses cheap LLM, read-only permissions
 */
export class ResearchAgent {
  private name: string;
  private solanaClient: SolanaClient;
  private jupiter: JupiterClient;
  private yieldAggregator: YieldAggregator;

  constructor(name: string, rpcUrl: string) {
    this.name = name;
    this.solanaClient = new SolanaClient(rpcUrl);
    this.jupiter = new JupiterClient(new Connection(rpcUrl));
    this.yieldAggregator = new YieldAggregator();
  }

  /**
   * Analyze a wallet's portfolio
   */
  async analyzePortfolio(wallet: PublicKey): Promise<any> {
    console.log(`[${this.name}] Analyzing portfolio for ${wallet.toBase58().slice(0, 8)}...`);

    // Get balances
    const balances = await this.solanaClient.getTokenBalances(wallet);
    console.log(`[${this.name}] SOL balance: ${balances.sol.toFixed(4)}`);
    console.log(`[${this.name}] Token positions: ${balances.tokens.size}`);

    // Get DeFi positions
    const positions = await this.solanaClient.getDeFiPositions(wallet);
    console.log(`[${this.name}] DeFi positions: ${positions.length}`);

    // Get current yields
    const yields = await this.yieldAggregator.getYields();

    // Analyze and recommend
    const recommendations = this.generateRecommendations(balances, positions, yields);

    return {
      wallet: wallet.toBase58(),
      timestamp: new Date().toISOString(),
      balances: {
        sol: balances.sol,
        tokens: Object.fromEntries(balances.tokens),
      },
      positions,
      yields: Object.fromEntries(yields),
      recommendations,
    };
  }

  /**
   * Generate yield optimization recommendations
   */
  private generateRecommendations(
    balances: any,
    positions: any[],
    yields: Map<string, number>
  ): any[] {
    const recommendations = [];

    // If holding idle SOL, recommend staking
    if (balances.sol > 1) {
      const bestSolYield = Math.max(
        yields.get('marinade-msol') || 0,
        yields.get('jito-jitosol') || 0
      );
      const bestProtocol = (yields.get('jito-jitosol') || 0) > (yields.get('marinade-msol') || 0)
        ? 'Jito'
        : 'Marinade';

      recommendations.push({
        action: 'stake',
        asset: 'SOL',
        amount: balances.sol * 0.8, // Keep 20% liquid
        protocol: bestProtocol,
        expectedApy: bestSolYield,
        reason: `Idle SOL detected. Stake with ${bestProtocol} for ${bestSolYield}% APY.`,
      });
    }

    // Check for USDC that could earn yield
    const usdcBalance = balances.tokens.get(TOKENS.USDC);
    if (usdcBalance && usdcBalance.uiAmount > 100) {
      const bestUsdcYield = Math.max(
        yields.get('kamino-usdc') || 0,
        yields.get('drift-usdc') || 0,
        yields.get('marginfi-usdc') || 0
      );

      recommendations.push({
        action: 'lend',
        asset: 'USDC',
        amount: usdcBalance.uiAmount,
        protocol: 'Kamino',
        expectedApy: bestUsdcYield,
        reason: `USDC earning 0%. Lend on Kamino for ${bestUsdcYield}% APY.`,
      });
    }

    // Check for underperforming positions
    for (const position of positions) {
      const currentYield = yields.get(`${position.protocol.toLowerCase()}-${position.type}`);
      const betterYield = this.findBetterYield(position, yields);

      if (betterYield && betterYield.apy > position.apy * 1.2) {
        recommendations.push({
          action: 'rebalance',
          from: position.protocol,
          to: betterYield.protocol,
          asset: position.type,
          currentApy: position.apy,
          newApy: betterYield.apy,
          reason: `${betterYield.protocol} offers ${betterYield.apy}% vs current ${position.apy}%`,
        });
      }
    }

    return recommendations;
  }

  private findBetterYield(position: any, yields: Map<string, number>): { protocol: string; apy: number } | null {
    let best = null;

    for (const [key, apy] of yields) {
      if (key.includes(position.type) && apy > position.apy) {
        if (!best || apy > best.apy) {
          best = { protocol: key.split('-')[0], apy };
        }
      }
    }

    return best;
  }

  /**
   * Create an intent for the execution agent
   */
  createExecutionIntent(recommendations: any[], executionAgentPubkey: string): any {
    const payload = {
      type: 'execute_recommendations',
      recommendations: recommendations.filter(r => r.action === 'swap' || r.action === 'stake'),
      timestamp: new Date().toISOString(),
      priority: 'normal',
    };

    const payloadStr = JSON.stringify(payload);
    const payloadHash = crypto.createHash('sha256').update(payloadStr).digest();

    return {
      toAgent: executionAgentPubkey,
      payload,
      payloadHash: Array.from(payloadHash),
      paymentAmount: 1000, // 0.001 USDC for the service
    };
  }
}

/**
 * Execution Agent - Executes DeFi operations
 * Uses accurate LLM, has swap/transfer permissions
 */
export class ExecutionAgent {
  private name: string;
  private solanaClient: SolanaClient;
  private jupiter: JupiterClient;
  private wallet: Keypair;

  constructor(name: string, rpcUrl: string, wallet: Keypair) {
    this.name = name;
    this.solanaClient = new SolanaClient(rpcUrl);
    this.jupiter = new JupiterClient(new Connection(rpcUrl));
    this.wallet = wallet;
  }

  /**
   * Process an intent from another agent
   */
  async processIntent(intent: any): Promise<any> {
    console.log(`[${this.name}] Processing intent...`);

    const results = [];

    for (const rec of intent.payload.recommendations || []) {
      try {
        const result = await this.executeRecommendation(rec);
        results.push({ recommendation: rec, success: true, result });
      } catch (error: any) {
        results.push({ recommendation: rec, success: false, error: error.message });
      }
    }

    return {
      intentId: intent.id,
      processedAt: new Date().toISOString(),
      results,
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      },
    };
  }

  /**
   * Execute a single recommendation
   */
  private async executeRecommendation(rec: any): Promise<any> {
    console.log(`[${this.name}] Executing: ${rec.action} ${rec.amount} ${rec.asset}`);

    switch (rec.action) {
      case 'swap':
        return this.executeSwap(rec);
      case 'stake':
        return this.executeStake(rec);
      case 'lend':
        return this.executeLend(rec);
      default:
        throw new Error(`Unknown action: ${rec.action}`);
    }
  }

  /**
   * Execute a token swap via Jupiter
   */
  private async executeSwap(rec: any): Promise<any> {
    const inputMint = rec.inputMint || TOKENS.SOL;
    const outputMint = rec.outputMint || TOKENS.USDC;
    const amount = Math.floor(rec.amount * 1e9); // Convert to lamports

    console.log(`[${this.name}] Preparing swap: ${rec.amount} ${rec.asset}`);

    // Get quote
    const quote = await this.jupiter.getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps: 50,
    });

    console.log(`[${this.name}] Quote received: ${quote.outAmount} output`);

    // In production, would sign and send
    // const { transaction } = await this.jupiter.prepareSwap(inputMint, outputMint, amount, this.wallet.publicKey);
    // const txid = await this.jupiter.signAndSendSwap(transaction, this.wallet);

    return {
      action: 'swap',
      inputMint,
      outputMint,
      inputAmount: amount,
      outputAmount: quote.outAmount,
      priceImpact: quote.priceImpactPct,
      status: 'simulated', // Would be 'confirmed' with real tx
    };
  }

  /**
   * Execute staking (Marinade/Jito)
   */
  private async executeStake(rec: any): Promise<any> {
    console.log(`[${this.name}] Staking ${rec.amount} SOL with ${rec.protocol}`);

    // In production, would call Marinade/Jito program
    return {
      action: 'stake',
      protocol: rec.protocol,
      amount: rec.amount,
      expectedApy: rec.expectedApy,
      status: 'simulated',
    };
  }

  /**
   * Execute lending (Kamino/Drift)
   */
  private async executeLend(rec: any): Promise<any> {
    console.log(`[${this.name}] Lending ${rec.amount} ${rec.asset} on ${rec.protocol}`);

    // In production, would call Kamino/Drift program
    return {
      action: 'lend',
      protocol: rec.protocol,
      asset: rec.asset,
      amount: rec.amount,
      expectedApy: rec.expectedApy,
      status: 'simulated',
    };
  }
}

/**
 * Demo: Multi-agent DeFi orchestration
 */
async function demo() {
  console.log('=== Multi-Agent DeFi Orchestration Demo ===\n');

  const RPC_URL = 'https://api.devnet.solana.com';

  // Create agents
  const researchAgent = new ResearchAgent('ResearchBot', RPC_URL);
  const executionWallet = Keypair.generate();
  const executionAgent = new ExecutionAgent('ExecutionBot', RPC_URL, executionWallet);

  // Test wallet to analyze
  const testWallet = Keypair.generate();
  console.log(`Test wallet: ${testWallet.publicKey.toBase58()}`);
  console.log(`Execution wallet: ${executionWallet.publicKey.toBase58()}\n`);

  // Step 1: Research agent analyzes portfolio
  console.log('--- Step 1: Portfolio Analysis ---');
  const analysis = await researchAgent.analyzePortfolio(testWallet.publicKey);
  console.log(`\nAnalysis complete. Recommendations: ${analysis.recommendations.length}`);
  for (const rec of analysis.recommendations) {
    console.log(`  - ${rec.action}: ${rec.reason}`);
  }

  // Step 2: Research agent creates intent for execution agent
  console.log('\n--- Step 2: Create Execution Intent ---');
  const intent = researchAgent.createExecutionIntent(
    analysis.recommendations,
    executionWallet.publicKey.toBase58()
  );
  console.log(`Intent created with ${intent.payload.recommendations.length} tasks`);

  // Step 3: Execution agent processes intent
  console.log('\n--- Step 3: Execute Recommendations ---');
  const result = await executionAgent.processIntent(intent);
  console.log(`\nExecution Summary:`);
  console.log(`  Total: ${result.summary.total}`);
  console.log(`  Successful: ${result.summary.successful}`);
  console.log(`  Failed: ${result.summary.failed}`);

  for (const r of result.results) {
    const status = r.success ? '✓' : '✗';
    console.log(`  ${status} ${r.recommendation.action}: ${r.success ? r.result.status : r.error}`);
  }

  console.log('\n=== Demo Complete ===');
}

if (require.main === module) {
  demo().catch(console.error);
}

export { ResearchAgent, ExecutionAgent };
