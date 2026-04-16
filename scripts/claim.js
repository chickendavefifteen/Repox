/**
 * claim.js — Claim executor
 *
 * Reads pending.json (produced by scan.js), evaluates each claimable position,
 * and executes the on-chain claim transaction if:
 *   - Estimated token value > gas cost × GAS_VALUE_MULTIPLIER (default 3×)
 *   - OR the claim is gas-free (meta-transaction / sponsored)
 *
 * On success, appends to data/claims.json.
 *
 * Required env: WALLET_PRIVATE_KEY
 */

import { ethers } from 'ethers';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GAS_VALUE_MULTIPLIER = parseFloat(process.env.GAS_VALUE_MULTIPLIER || '3');
const DRY_RUN = process.env.DRY_RUN === 'true';

const protocols = JSON.parse(readFileSync(join(__dirname, 'protocols.json'), 'utf8'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 8);
  console.log(`[${ts}] ${msg}`);
}

async function getProvider(chain) {
  const chainConfig = protocols.chains[chain];
  if (!chainConfig) throw new Error(`Unknown chain: ${chain}`);
  const rpcs = [chainConfig.rpc, ...(chainConfig.fallbackRpcs || [])];
  const network = ethers.Network.from(chainConfig.chainId);
  for (const rpc of rpcs) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc, network, { staticNetwork: network });
      await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
      return provider;
    } catch {
      // Try next RPC
    }
  }
  throw new Error(`All RPCs failed for ${chain}`);
}

async function getEthPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const data = await res.json();
    return data.ethereum?.usd || 3000;
  } catch {
    return 3000; // Fallback price
  }
}

async function estimateGasCostUsd(provider, tx) {
  try {
    const [gasEstimate, feeData, ethPrice] = await Promise.all([
      provider.estimateGas(tx),
      provider.getFeeData(),
      getEthPrice(),
    ]);
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits('5', 'gwei');
    const gasCostWei = gasEstimate * gasPrice;
    const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));
    return gasCostEth * ethPrice;
  } catch {
    return 0.5; // Assume $0.50 on failure (conservative)
  }
}

// ─── Claim strategies ─────────────────────────────────────────────────────────

async function claimMerkle(claimable, wallet) {
  const provider = await getProvider(claimable.chain);
  const signer = wallet.connect(provider);
  const contract = new ethers.Contract(claimable.contractAddress, claimable.abi, signer);

  // Try simple claim() first, then claim(amount, proof) with empty proof
  try {
    const tx = await contract.claim();
    return await tx.wait();
  } catch {
    // Some merkle distributors need proof — we can't provide it without an API
    throw new Error('Merkle proof required — cannot claim without backend proof data');
  }
}

async function claimGaugeReward(claimable, wallet) {
  const provider = await getProvider(claimable.chain);
  const signer = wallet.connect(provider);
  const contract = new ethers.Contract(claimable.contractAddress, claimable.abi, signer);

  const tx = await contract.getReward(wallet.address, [claimable.contractAddress]);
  return await tx.wait();
}

async function claimStakingReward(claimable, wallet) {
  const provider = await getProvider(claimable.chain);
  const signer = wallet.connect(provider);
  const contract = new ethers.Contract(claimable.contractAddress, claimable.abi, signer);

  const tx = await contract.getReward();
  return await tx.wait();
}

async function claimEscrowedReward(claimable, wallet) {
  const provider = await getProvider(claimable.chain);
  const signer = wallet.connect(provider);
  const contract = new ethers.Contract(claimable.contractAddress, claimable.abi, signer);

  const tx = await contract.claim();
  return await tx.wait();
}

async function claimCompoundReward(claimable, wallet) {
  const provider = await getProvider(claimable.chain);
  const signer = wallet.connect(provider);
  const contract = new ethers.Contract(claimable.contractAddress, claimable.abi, signer);

  const tx = await contract.claim(claimable.contractAddress, wallet.address, true);
  return await tx.wait();
}

async function executeClaim(claimable, wallet) {
  switch (claimable.claimType || claimable.claimMethod) {
    case 'merkle':
      return claimMerkle(claimable, wallet);
    case 'gauge_rewards':
      return claimGaugeReward(claimable, wallet);
    case 'staking_rewards':
      return claimStakingReward(claimable, wallet);
    case 'escrowed_rewards':
      return claimEscrowedReward(claimable, wallet);
    case 'compound_rewards':
      return claimCompoundReward(claimable, wallet);
    default:
      throw new Error(`Unknown claim type: ${claimable.claimType || claimable.claimMethod}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.WALLET_PRIVATE_KEY) {
    log('WALLET_PRIVATE_KEY not set — skipping claim execution.');
    log('Set this secret in your GitHub repo Settings → Secrets to enable auto-claiming.');
    return;
  }

  const dataDir = join(ROOT, 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const pendingPath = join(dataDir, 'pending.json');
  const claimsPath = join(dataDir, 'claims.json');

  if (!existsSync(pendingPath)) {
    log('No pending.json found — run scan.js first.');
    return;
  }

  const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
  const existingClaims = existsSync(claimsPath)
    ? JSON.parse(readFileSync(claimsPath, 'utf8'))
    : [];

  if (pending.length === 0) {
    log('No claimable tokens found in pending.json. Nothing to claim.');
    return;
  }

  const wallet = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY.trim());
  log(`Claim wallet: ${wallet.address}`);
  log(`Processing ${pending.length} claimable position(s)...`);
  if (DRY_RUN) log('DRY_RUN=true — will not execute transactions.');

  const newClaims = [];
  let totalClaimedUsd = 0;

  for (const claimable of pending) {
    log(`\nEvaluating: ${claimable.name} (${claimable.chain})`);
    log(`  Token: ${claimable.amount.toFixed(4)} ${claimable.tokenSymbol} ≈ $${claimable.usdValue.toFixed(2)}`);

    // Skip if gas can't be estimated (no ETH balance on that chain)
    let gasCostUsd = 0.01; // Default — L2 chains are very cheap
    try {
      const provider = await getProvider(claimable.chain);
      const walletBalance = await provider.getBalance(wallet.address);
      const balanceEth = parseFloat(ethers.formatEther(walletBalance));
      log(`  Gas wallet balance: ${balanceEth.toFixed(6)} ETH`);

      if (balanceEth === 0) {
        log(`  Skipping: wallet has 0 ETH on ${claimable.chain} — no gas for transaction.`);
        log(`  → Fund via faucet or bridge ETH to ${claimable.chain}.`);
        continue;
      }

      gasCostUsd = await estimateGasCostUsd(provider, {
        from: wallet.address,
        to: claimable.contractAddress,
        data: '0x',
      });
    } catch {
      log(`  Could not estimate gas — assuming $${gasCostUsd.toFixed(3)}`);
    }

    const threshold = gasCostUsd * GAS_VALUE_MULTIPLIER;
    log(`  Gas cost: ~$${gasCostUsd.toFixed(3)} | Threshold: $${threshold.toFixed(2)} | Value: $${claimable.usdValue.toFixed(2)}`);

    if (claimable.usdValue < threshold && claimable.usdValue > 0) {
      log(`  Skipping: value ($${claimable.usdValue.toFixed(2)}) < ${GAS_VALUE_MULTIPLIER}× gas cost ($${threshold.toFixed(2)})`);
      continue;
    }

    if (DRY_RUN) {
      log(`  [DRY RUN] Would claim ${claimable.amount.toFixed(4)} ${claimable.tokenSymbol}`);
      continue;
    }

    try {
      log(`  Claiming ${claimable.amount.toFixed(4)} ${claimable.tokenSymbol}...`);
      const receipt = await executeClaim(claimable, wallet);
      const claim = {
        ...claimable,
        claimedAt: new Date().toISOString(),
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasCostUsd,
        netUsdValue: claimable.usdValue - gasCostUsd,
      };
      newClaims.push(claim);
      totalClaimedUsd += claimable.usdValue;
      log(`  Claimed! TX: ${receipt.hash}`);
    } catch (err) {
      log(`  Claim failed: ${err.message}`);
      // Record as failed claim for transparency
      newClaims.push({
        ...claimable,
        claimedAt: new Date().toISOString(),
        status: 'failed',
        error: err.message,
      });
    }
  }

  // Merge with existing claims and write
  const allClaims = [...newClaims, ...existingClaims].slice(0, 500); // Keep last 500
  writeFileSync(claimsPath, JSON.stringify(allClaims, null, 2));

  const successCount = newClaims.filter(c => !c.status).length;
  log(`\nClaim run complete.`);
  log(`  Successful claims: ${successCount}`);
  log(`  Total value claimed: $${totalClaimedUsd.toFixed(2)}`);
}

main().catch(err => {
  console.error('Claim run failed:', err);
  process.exit(1);
});
