import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { Portfolio } from '../types';

interface Props {
  portfolio: Portfolio;
  onTriggerScan: () => void;
  scanning: boolean;
}

const CHAIN_EMOJI: Record<string, string> = {
  ethereum: '⟠',
  base:     '🔵',
  optimism: '🔴',
  arbitrum: '🟦',
  zksync:   '⚡',
};

const CHAIN_LABEL: Record<string, string> = {
  ethereum: 'Ethereum',
  base:     'Base',
  optimism: 'Optimism',
  arbitrum: 'Arbitrum',
  zksync:   'zkSync',
};

export function WalletCard({ portfolio, onTriggerScan, scanning }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  const address = portfolio.address;
  const shortAddr = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : '—';

  useEffect(() => {
    if (!canvasRef.current || !address) return;
    QRCode.toCanvas(canvasRef.current, address, {
      width: 140,
      margin: 1,
      color: { dark: '#ffffff', light: '#1a1a2e' },
    });
  }, [address]);

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  const lastScan = portfolio.lastScan
    ? new Date(portfolio.lastScan).toLocaleString()
    : 'Never';

  const hasBalance = Object.values(portfolio.nativeBalances || {}).some(b => b.amount > 0);

  return (
    <div className="card wallet-card">
      <div className="wallet-header">
        <div className="wallet-info">
          <div className="wallet-label">Your Wallet</div>
          <div className="wallet-address" onClick={copyAddress} title="Click to copy">
            {shortAddr}
            <span className="copy-icon">{copied ? '✓' : '⎘'}</span>
          </div>
          <div className="wallet-full">{address || 'Not configured — see Setup'}</div>
        </div>
        {address && (
          <canvas ref={canvasRef} className="qr-canvas" title="Scan to receive" />
        )}
      </div>

      <div className="balance-row">
        <div className="balance-item primary">
          <span className="balance-label">Total Portfolio</span>
          <span className="balance-value">${portfolio.totalUsd.toFixed(2)}</span>
        </div>
        <div className="balance-item">
          <span className="balance-label">Claimable</span>
          <span className="balance-value claimable">${portfolio.totalClaimableUsd.toFixed(2)}</span>
        </div>
        <div className="balance-item">
          <span className="balance-label">ETH Balances</span>
          <span className="balance-value">${portfolio.totalNativeUsd.toFixed(2)}</span>
        </div>
      </div>

      {hasBalance && (
        <div className="chain-balances">
          {Object.entries(portfolio.nativeBalances).map(([chain, bal]) =>
            bal.amount > 0 ? (
              <div key={chain} className="chain-balance">
                <span>{CHAIN_EMOJI[chain]} {CHAIN_LABEL[chain]}</span>
                <span>{bal.amount.toFixed(5)} ETH</span>
              </div>
            ) : null
          )}
        </div>
      )}

      {!hasBalance && address && (
        <div className="gas-warning">
          No ETH for gas detected. Get free gas from the{' '}
          <a href="https://app.optimism.io/faucet" target="_blank" rel="noopener noreferrer">
            Optimism Superchain Faucet
          </a>{' '}
          (free with GitHub login).
        </div>
      )}

      <div className="scan-row">
        <span className="last-scan">Last scan: {lastScan}</span>
        <button
          className={`btn-scan ${scanning ? 'scanning' : ''}`}
          onClick={onTriggerScan}
          disabled={scanning || !address}
        >
          {scanning ? 'Scanning...' : 'Scan Now'}
        </button>
      </div>
    </div>
  );
}
