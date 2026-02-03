import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import axios from 'axios';

// Jupiter API endpoints
const JUPITER_API = 'https://quote-api.jup.ag/v6';

// Common token mints
export const TOKENS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
};

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number; // in lamports/smallest unit
  slippageBps?: number; // default 50 = 0.5%
}

export interface SwapParams {
  quoteResponse: any;
  userPublicKey: string;
  wrapUnwrapSOL?: boolean;
}

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot: number;
}

export class JupiterClient {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Get a swap quote from Jupiter
   */
  async getQuote(params: QuoteParams): Promise<JupiterQuote> {
    const { inputMint, outputMint, amount, slippageBps = 50 } = params;

    const response = await axios.get(`${JUPITER_API}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps,
      },
    });

    return response.data;
  }

  /**
   * Get swap transaction from Jupiter
   */
  async getSwapTransaction(params: SwapParams): Promise<string> {
    const { quoteResponse, userPublicKey, wrapUnwrapSOL = true } = params;

    const response = await axios.post(`${JUPITER_API}/swap`, {
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: wrapUnwrapSOL,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    });

    return response.data.swapTransaction;
  }

  /**
   * Execute a swap (returns serialized transaction for signing)
   */
  async prepareSwap(
    inputMint: string,
    outputMint: string,
    amount: number,
    userPublicKey: PublicKey,
    slippageBps: number = 50
  ): Promise<{ quote: JupiterQuote; transaction: string }> {
    // Get quote
    const quote = await this.getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
    });

    console.log(`[Jupiter] Quote: ${quote.inAmount} ${inputMint} → ${quote.outAmount} ${outputMint}`);
    console.log(`[Jupiter] Price impact: ${quote.priceImpactPct}%`);

    // Get swap transaction
    const transaction = await this.getSwapTransaction({
      quoteResponse: quote,
      userPublicKey: userPublicKey.toBase58(),
    });

    return { quote, transaction };
  }

  /**
   * Deserialize and sign transaction
   */
  async signAndSendSwap(
    swapTransaction: string,
    signer: Keypair
  ): Promise<string> {
    // Deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Sign the transaction
    transaction.sign([signer]);

    // Send the transaction
    const rawTransaction = transaction.serialize();
    const txid = await this.connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 2,
    });

    // Confirm the transaction
    await this.connection.confirmTransaction(txid, 'confirmed');

    console.log(`[Jupiter] Swap executed: ${txid}`);
    return txid;
  }

  /**
   * Get token price in USDC
   */
  async getPrice(tokenMint: string): Promise<number> {
    try {
      // Get quote for 1 token to USDC
      const decimals = tokenMint === TOKENS.SOL ? 9 : 6;
      const amount = Math.pow(10, decimals);

      const quote = await this.getQuote({
        inputMint: tokenMint,
        outputMint: TOKENS.USDC,
        amount,
      });

      // USDC has 6 decimals
      return parseInt(quote.outAmount) / 1e6;
    } catch (error) {
      console.error(`[Jupiter] Failed to get price for ${tokenMint}:`, error);
      return 0;
    }
  }

  /**
   * Get multiple token prices
   */
  async getPrices(tokenMints: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    for (const mint of tokenMints) {
      const price = await this.getPrice(mint);
      prices.set(mint, price);
    }

    return prices;
  }
}

// Demo function
async function demo() {
  console.log('=== Jupiter Integration Demo ===\n');

  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  const jupiter = new JupiterClient(connection);

  // Get SOL price
  console.log('Fetching SOL price...');
  const solPrice = await jupiter.getPrice(TOKENS.SOL);
  console.log(`SOL price: $${solPrice.toFixed(2)} USDC\n`);

  // Get a swap quote (1 SOL to USDC)
  console.log('Getting swap quote: 1 SOL → USDC...');
  const quote = await jupiter.getQuote({
    inputMint: TOKENS.SOL,
    outputMint: TOKENS.USDC,
    amount: 1_000_000_000, // 1 SOL in lamports
    slippageBps: 50,
  });

  console.log(`Input: ${parseInt(quote.inAmount) / 1e9} SOL`);
  console.log(`Output: ${parseInt(quote.outAmount) / 1e6} USDC`);
  console.log(`Price impact: ${quote.priceImpactPct}%`);
  console.log(`Route: ${quote.routePlan.length} hop(s)\n`);

  console.log('To execute swap, call jupiter.prepareSwap() then signAndSendSwap() with a funded wallet.');
}

// Run demo if executed directly
if (require.main === module) {
  demo().catch(console.error);
}

export default JupiterClient;
