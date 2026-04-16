export interface NativeBalance {
  amount: number;
  usdValue: number;
  currency: string;
}

export interface Claimable {
  id: string;
  type: 'airdrop' | 'protocol_reward';
  name: string;
  chain: string;
  chainId: number;
  contractAddress: string;
  tokenSymbol: string;
  amount: number;
  amountRaw: string;
  usdValue: number;
  price: number;
  discoveredAt: string;
  claimMethod?: string;
  claimType?: string;
}

export interface Portfolio {
  address: string;
  lastScan: string | null;
  nativeBalances: Record<string, NativeBalance>;
  totalNativeUsd: number;
  claimables: Claimable[];
  totalClaimableUsd: number;
  totalUsd: number;
}

export interface Claim extends Claimable {
  claimedAt: string;
  txHash?: string;
  blockNumber?: number;
  gasCostUsd?: number;
  netUsdValue?: number;
  status?: 'failed';
  error?: string;
}

export interface WalletData {
  address: string;
  setupComplete: boolean;
}
