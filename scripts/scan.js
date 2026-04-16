/**
 * scan.js — Multi-chain airdrop & reward scanner
 *
 * Scans the configured wallet across all supported chains for:
 *  1. Claimable airdrop tokens (Merkle distributor pattern)
 *  2. DeFi protocol rewards (gauge rewards, staking, LP fees)
 *
 * Writes results to:
 *  - data/portfolio.json  (wallet balances + claimable totals)
 *  - data/pending.json    (list of claimable positions ready to claim)
 *
 * Required env: WALLET_ADDRESS or WALLET_PRIVATE_KEY
 * No API keys needed — uses only free public RPCs + CoinGecko free tier.
 */

import { ethers } from 'ethers';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Config ───────────────────────────────────────────────────────────────────

const WALLET_ADDRESS = (() => {
  if (process.env.WALLET_ADDRESS) return process.env.WALLET_ADDRESS;
  if (process.env.WALLET_PRIVATE_KEY) {
    const wallet = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY.trim());
    return wallet.address;
  }
  // Fallback: read from data/wallet.json (set during setup)
  const walletPath = join(ROOT, 'data', 'wallet.json');
  if (existsSync(walletPath)) {
    const { address } = JSON.parse(readFileSync(walletPath, 'utf8'));
    return address;
  }
  throw new Error(
    'No wallet configured. Set WALLET_ADDRESS or WALLET_PRIVATE_KEY env var, ' +
    'or complete setup at the GitHub Pages dashboard.'
  );
})();

const airdrops = JSON.parse(readFileSync(join(__dirname, 'airdrops.json'), 'utf8'));
const protocols = JSON.parse(readFileSync(join(__dirname, 'protocols.json'), 'utf8'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getProvider(chainConfig) {
  const rpcs = [chainConfig.rpc, ...(chainConfig.fallbackRpcs || [])];
  for (const rpc of rpcs) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
      return provider;
    } catch {
      console.warn(`  RPC failed: ${rpc}, trying next...`);
    }
  }
  throw new Error(`All RPCs failed for chain ${chainConfig.chainId}`);
}

async function getTokenPrice(symbol) {
  const symbolMap = {
    ETH: 'ethereum', WETH: 'ethereum',
    UNI: 'uniswap', ARB: 'arbitrum', OP: 'optimism',
    BLUR: 'blur', EIGEN: 'eigenlayer', ZK: 'zksync',
    STRK: 'starknet', W: 'wormhole', ZRO: 'layerzero-token',
    DRIFT: 'drift-protocol', MERL: 'merlin-chain',
    CRV: 'curve-dao-token', COMP: 'compound-governance-token',
    AAVE: 'aave', VELO: 'velodrome-finance', AERO: 'aerodrome-finance',
    GMX: 'gmx', esGMX: 'gmx', SNX: 'havven',
  };
  const id = symbolMap[symbol];
  if (!id) return 0;
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const data = await res.json();
    return data[id]?.usd || 0;
  } catch {
    return 0;
  }
}

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 8);
  console.log(`[${ts}] ${msg}`);
}

// ─── Airdrop scanner (Merkle distributor pattern) ─────────────────────────────

async function scanAirdrop(airdrop) {
  const chainConfig = protocols.chains[airdrop.chain];
  if (!chainConfig) {
    log(`  Skipping ${airdrop.name}: unknown chain "${airdrop.chain}"`);
    return null;
  }
  try {
    const provider = await getProvider(chainConfig);
    const contract = new ethers.Contract(airdrop.contractAddress, airdrop.abi, provider);

    let claimableAmount = 0n;

    // Try different claimable() signatures
    try {
      const result = await contract.claimable(WALLET_ADDRESS);
      if (typeof result === 'bigint') {
        claimableAmount = result;
      } else if (result && typeof result === 'object' && 'amount' in result) {
        claimableAmount = result.amount;
        if (!result.claimable) claimableAmount = 0n;
      }
    } catch {
      // Contract not matching this signature or not deployed
      return null;
    }

    if (claimableAmount === 0n) return null;

    const amountFormatted = parseFloat(ethers.formatUnits(claimableAmount, 18));
    if (amountFormatted < 0.0001) return null;

    const price = await getTokenPrice(airdrop.tokenSymbol);
    const usdValue = amountFormatted * price;

    log(`  Found: ${amountFormatted.toFixed(4)} ${airdrop.tokenSymbol} ($${usdValue.toFixed(2)}) — ${airdrop.name}`);

    return {
      id: `${airdrop.chain}-${airdrop.contractAddress}-${airdrop.tokenSymbol}`,
      type: 'airdrop',
      name: airdrop.name,
      chain: airdrop.chain,
      chainId: chainConfig.chainId,
      contractAddress: airdrop.contractAddress,
      tokenSymbol: airdrop.tokenSymbol,
      amount: amountFormatted,
      amountRaw: claimableAmount.toString(),
      usdValue,
      price,
      discoveredAt: new Date().toISOString(),
      abi: airdrop.abi,
      claimMethod: airdrop.claimMethod,
    };
  } catch (err) {
    log(`  Error scanning ${airdrop.name}: ${err.message}`);
    return null;
  }
}

// ─── Protocol reward scanner ──────────────────────────────────────────────────

async function scanProtocolReward(contract) {
  const chainConfig = protocols.chains[contract.chain];
  if (!chainConfig) return null;

  try {
    const provider = await getProvider(chainConfig);
    const ethContract = new ethers.Contract(contract.address, contract.abi, provider);

    let earned = 0n;

    switch (contract.type) {
      case 'gauge_rewards':
      case 'staking_rewards': {
        earned = await ethContract.earned(WALLET_ADDRESS);
        break;
      }
      case 'escrowed_rewards': {
        earned = await ethContract.claimable(WALLET_ADDRESS);
        break;
      }
      case 'compound_rewards': {
        const owed = await ethContract.getRewardOwed(contract.address, WALLET_ADDRESS);
        earned = owed.owed;
        break;
      }
      case 'aave_rewards': {
        // Skip for now — requires knowing which assets user has
        return null;
      }
      default:
        return null;
    }

    if (earned === 0n) return null;

    const amountFormatted = parseFloat(ethers.formatUnits(earned, 18));
    if (amountFormatted < 0.0001) return null;

    const price = await getTokenPrice(contract.tokenSymbol);
    const usdValue = amountFormatted * price;

    log(`  Found reward: ${amountFormatted.toFixed(4)} ${contract.tokenSymbol} ($${usdValue.toFixed(2)}) — ${contract.name}`);

    return {
      id: `${contract.chain}-${contract.address}-${contract.tokenSymbol}-reward`,
      type: 'protocol_reward',
      name: contract.name,
      chain: contract.chain,
      chainId: chainConfig.chainId,
      contractAddress: contract.address,
      tokenSymbol: contract.tokenSymbol,
      amount: amountFormatted,
      amountRaw: earned.toString(),
      usdValue,
      price,
      discoveredAt: new Date().toISOString(),
      abi: contract.abi,
      claimType: contract.type,
    };
  } catch {
    // Most wallets won't have positions in all protocols — silent skip
    return null;
  }
}

// ─── Native ETH balance scanner ───────────────────────────────────────────────

async function scanNativeBalances() {
  const balances = {};
  for (const [chainName, chainConfig] of Object.entries(protocols.chains)) {
    try {
      const provider = await getProvider(chainConfig);
      const bal = await provider.getBalance(WALLET_ADDRESS);
      const formatted = parseFloat(ethers.formatEther(bal));
      const price = await getTokenPrice('ETH');
      balances[chainName] = {
        amount: formatted,
        usdValue: formatted * price,
        currency: chainConfig.nativeCurrency,
      };
      if (formatted > 0) {
        log(`  Balance on ${chainName}: ${formatted.toFixed(6)} ETH ($${(formatted * price).toFixed(2)})`);
      }
    } catch {
      balances[chainName] = { amount: 0, usdValue: 0, currency: 'ETH' };
    }
  }
  return balances;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(`Starting scan for wallet: ${WALLET_ADDRESS}`);

  // Ensure data dir exists
  const dataDir = join(ROOT, 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  // Load existing portfolio/claims so we can merge
  const portfolioPath = join(dataDir, 'portfolio.json');
  const pendingPath = join(dataDir, 'pending.json');

  const existingPortfolio = existsSync(portfolioPath)
    ? JSON.parse(readFileSync(portfolioPath, 'utf8'))
    : { address: WALLET_ADDRESS, lastScan: null, nativeBalances: {}, claimables: [] };

  // Scan ETH balances across chains
  log('Scanning native ETH balances...');
  const nativeBalances = await scanNativeBalances();

  // Scan airdrops
  log('Scanning airdrop contracts...');
  const airdropResults = await Promise.allSettled(
    airdrops.map(a => scanAirdrop(a))
  );

  // Scan protocol rewards
  log('Scanning protocol reward contracts...');
  const rewardResults = await Promise.allSettled(
    protocols.rewardContracts.map(c => scanProtocolReward(c))
  );

  // Collect non-null results
  const claimables = [
    ...airdropResults.map(r => r.status === 'fulfilled' ? r.value : null),
    ...rewardResults.map(r => r.status === 'fulfilled' ? r.value : null),
  ].filter(Boolean);

  const totalClaimableUsd = claimables.reduce((s, c) => s + c.usdValue, 0);
  const totalNativeUsd = Object.values(nativeBalances).reduce((s, b) => s + b.usdValue, 0);

  const portfolio = {
    address: WALLET_ADDRESS,
    lastScan: new Date().toISOString(),
    nativeBalances,
    totalNativeUsd,
    claimables,
    totalClaimableUsd,
    totalUsd: totalNativeUsd + totalClaimableUsd,
    scanDurationMs: 0,
  };

  writeFileSync(portfolioPath, JSON.stringify(portfolio, null, 2));
  writeFileSync(pendingPath, JSON.stringify(claimables, null, 2));

  log(`Scan complete. Found ${claimables.length} claimable(s) worth $${totalClaimableUsd.toFixed(2)}.`);
  if (claimables.length === 0) {
    log('No claimable tokens found. Dashboard will update to show live balances.');
  }
}

main().catch(err => {
  console.error('Scan failed:', err);
  process.exit(1);
});
