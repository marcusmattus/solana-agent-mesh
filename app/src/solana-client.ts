import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import axios from 'axios';

// Helius RPC for enhanced data
const HELIUS_RPC = process.env.HELIUS_RPC || 'https://api.mainnet-beta.solana.com';

// DeFi protocol addresses
const PROTOCOLS = {
  MARINADE: {
    program: 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',
    mSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  },
  JITO: {
    program: 'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb',
    jitoSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  },
  KAMINO: {
    program: 'KAMino1111111111111111111111111111111111111',
  },
};

export interface WalletBalance {
  sol: number;
  tokens: Map<string, { amount: number; decimals: number; uiAmount: number }>;
}

export interface StakingPosition {
  protocol: string;
  amount: number;
  rewards: number;
  apy: number;
}

export interface DeFiPosition {
  protocol: string;
  type: 'stake' | 'lp' | 'lend' | 'borrow';
  value: number;
  apy: number;
}

export class SolanaClient {
  private connection: Connection;

  constructor(rpcUrl: string = HELIUS_RPC) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Get SOL balance for a wallet
   */
  async getBalance(wallet: PublicKey): Promise<number> {
    const balance = await this.connection.getBalance(wallet);
    return balance / LAMPORTS_PER_SOL;
  }

  /**
   * Get all token balances for a wallet
   */
  async getTokenBalances(wallet: PublicKey): Promise<WalletBalance> {
    const solBalance = await this.getBalance(wallet);

    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(wallet, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });

    const tokens = new Map<string, { amount: number; decimals: number; uiAmount: number }>();

    for (const { account } of tokenAccounts.value) {
      const parsed = account.data.parsed.info;
      const mint = parsed.mint;
      const amount = parseInt(parsed.tokenAmount.amount);
      const decimals = parsed.tokenAmount.decimals;
      const uiAmount = parsed.tokenAmount.uiAmount;

      if (amount > 0) {
        tokens.set(mint, { amount, decimals, uiAmount });
      }
    }

    return { sol: solBalance, tokens };
  }

  /**
   * Check if wallet has mSOL (Marinade staked SOL)
   */
  async getMarinadePosition(wallet: PublicKey): Promise<StakingPosition | null> {
    try {
      const msolAta = await getAssociatedTokenAddress(
        new PublicKey(PROTOCOLS.MARINADE.mSOL),
        wallet
      );

      const account = await getAccount(this.connection, msolAta);
      const amount = Number(account.amount) / LAMPORTS_PER_SOL;

      if (amount > 0) {
        return {
          protocol: 'Marinade',
          amount,
          rewards: 0, // Would need to calculate based on mSOL/SOL rate
          apy: 7.2, // Approximate APY
        };
      }
    } catch {
      // No mSOL position
    }
    return null;
  }

  /**
   * Check if wallet has jitoSOL
   */
  async getJitoPosition(wallet: PublicKey): Promise<StakingPosition | null> {
    try {
      const jitoAta = await getAssociatedTokenAddress(
        new PublicKey(PROTOCOLS.JITO.jitoSOL),
        wallet
      );

      const account = await getAccount(this.connection, jitoAta);
      const amount = Number(account.amount) / LAMPORTS_PER_SOL;

      if (amount > 0) {
        return {
          protocol: 'Jito',
          amount,
          rewards: 0,
          apy: 7.8, // Approximate APY with MEV rewards
        };
      }
    } catch {
      // No jitoSOL position
    }
    return null;
  }

  /**
   * Get all DeFi positions for a wallet
   */
  async getDeFiPositions(wallet: PublicKey): Promise<DeFiPosition[]> {
    const positions: DeFiPosition[] = [];

    // Check Marinade
    const marinade = await this.getMarinadePosition(wallet);
    if (marinade) {
      positions.push({
        protocol: 'Marinade',
        type: 'stake',
        value: marinade.amount,
        apy: marinade.apy,
      });
    }

    // Check Jito
    const jito = await this.getJitoPosition(wallet);
    if (jito) {
      positions.push({
        protocol: 'Jito',
        type: 'stake',
        value: jito.amount,
        apy: jito.apy,
      });
    }

    // TODO: Add Kamino, Drift, etc.

    return positions;
  }

  /**
   * Get recent transactions for a wallet
   */
  async getRecentTransactions(wallet: PublicKey, limit: number = 10): Promise<any[]> {
    const signatures = await this.connection.getSignaturesForAddress(wallet, { limit });

    const transactions = await Promise.all(
      signatures.map(async (sig) => {
        const tx = await this.connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });
        return {
          signature: sig.signature,
          slot: sig.slot,
          blockTime: sig.blockTime,
          err: sig.err,
          memo: sig.memo,
        };
      })
    );

    return transactions;
  }

  /**
   * Get current slot and block height
   */
  async getNetworkStatus(): Promise<{ slot: number; blockHeight: number; epoch: number }> {
    const slot = await this.connection.getSlot();
    const blockHeight = await this.connection.getBlockHeight();
    const epochInfo = await this.connection.getEpochInfo();

    return {
      slot,
      blockHeight,
      epoch: epochInfo.epoch,
    };
  }

  /**
   * Airdrop SOL (devnet only)
   */
  async airdrop(wallet: PublicKey, amount: number = 1): Promise<string> {
    const signature = await this.connection.requestAirdrop(
      wallet,
      amount * LAMPORTS_PER_SOL
    );
    await this.connection.confirmTransaction(signature);
    return signature;
  }
}

// Yield aggregator - fetches APYs from various sources
export class YieldAggregator {
  private solanaYieldApi = 'https://api.solanayield.com'; // Example

  /**
   * Get current yields from major protocols
   */
  async getYields(): Promise<Map<string, number>> {
    const yields = new Map<string, number>();

    // Hardcoded for demo - in production, fetch from APIs
    yields.set('marinade-msol', 7.2);
    yields.set('jito-jitosol', 7.8);
    yields.set('kamino-usdc', 12.5);
    yields.set('kamino-sol', 8.3);
    yields.set('drift-usdc', 15.2);
    yields.set('marginfi-usdc', 11.8);

    return yields;
  }

  /**
   * Get best yield for a given asset
   */
  async getBestYield(asset: string): Promise<{ protocol: string; apy: number }> {
    const yields = await this.getYields();

    let bestProtocol = '';
    let bestApy = 0;

    for (const [key, apy] of yields) {
      if (key.includes(asset.toLowerCase()) && apy > bestApy) {
        bestProtocol = key.split('-')[0];
        bestApy = apy;
      }
    }

    return { protocol: bestProtocol, apy: bestApy };
  }
}

// Demo
async function demo() {
  console.log('=== Solana Client Demo ===\n');

  const client = new SolanaClient('https://api.devnet.solana.com');

  // Generate a test wallet
  const wallet = Keypair.generate();
  console.log(`Test wallet: ${wallet.publicKey.toBase58()}`);

  // Get network status
  const status = await client.getNetworkStatus();
  console.log(`\nNetwork Status:`);
  console.log(`  Slot: ${status.slot}`);
  console.log(`  Block Height: ${status.blockHeight}`);
  console.log(`  Epoch: ${status.epoch}`);

  // Yield aggregator demo
  const yields = new YieldAggregator();
  const allYields = await yields.getYields();
  console.log(`\nCurrent Yields:`);
  for (const [protocol, apy] of allYields) {
    console.log(`  ${protocol}: ${apy}%`);
  }

  const bestUsdc = await yields.getBestYield('usdc');
  console.log(`\nBest USDC yield: ${bestUsdc.protocol} at ${bestUsdc.apy}%`);
}

if (require.main === module) {
  demo().catch(console.error);
}

export default SolanaClient;
