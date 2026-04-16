import { useEffect, useState, useCallback } from 'react';
import { WalletCard } from './components/WalletCard';
import { ClaimFeed } from './components/ClaimFeed';
import { PortfolioBar } from './components/PortfolioBar';
import { SetupPage } from './components/SetupPage';
import type { Portfolio, Claim, WalletData } from './types';

const BASE = import.meta.env.BASE_URL;

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}?t=${Date.now()}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const EMPTY_PORTFOLIO: Portfolio = {
  address: '',
  lastScan: null,
  nativeBalances: {},
  totalNativeUsd: 0,
  claimables: [],
  totalClaimableUsd: 0,
  totalUsd: 0,
};

export default function App() {
  const [portfolio, setPortfolio] = useState<Portfolio>(EMPTY_PORTFOLIO);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const loadData = useCallback(async () => {
    const [p, c, w] = await Promise.all([
      fetchJson<Portfolio>('data/portfolio.json'),
      fetchJson<Claim[]>('data/claims.json'),
      fetchJson<WalletData>('data/wallet.json'),
    ]);
    if (p) setPortfolio(p);
    if (c) setClaims(c);
    if (w) setWalletData(w);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Trigger a GitHub Actions workflow_dispatch to scan on demand.
  // This works via the GitHub API from the browser.
  async function triggerScan() {
    setScanning(true);
    try {
      // The repo info is baked in at build time via env vars (set by CI)
      const repo = import.meta.env.VITE_GITHUB_REPO;
      const token = import.meta.env.VITE_GITHUB_TOKEN;

      if (!repo || !token) {
        // Fallback: just reload data after a short wait
        await new Promise(r => setTimeout(r, 2000));
        await loadData();
        return;
      }

      await fetch(`https://api.github.com/repos/${repo}/actions/workflows/claim.yml/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      });

      // Poll for updated data — Actions usually finishes in ~2 min
      await new Promise(r => setTimeout(r, 5000));
      await loadData();
    } finally {
      setScanning(false);
    }
  }

  function handleSetupComplete(address: string) {
    setWalletData({ address, setupComplete: true });
    setPortfolio(p => ({ ...p, address }));
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading dashboard...</p>
      </div>
    );
  }

  const needsSetup = !walletData?.address && !portfolio.address;

  if (needsSetup) {
    return <SetupPage onSetup={handleSetupComplete} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="header-title">
            <span className="header-icon">💎</span>
            Free Token Claimer
          </div>
          <div className="header-sub">Multi-chain airdrop &amp; reward auto-claimer</div>
        </div>
      </header>

      <main className="app-main">
        <PortfolioBar
          totalUsd={portfolio.totalUsd}
          claimableUsd={portfolio.totalClaimableUsd}
          nativeUsd={portfolio.totalNativeUsd}
        />

        <WalletCard
          portfolio={portfolio}
          onTriggerScan={triggerScan}
          scanning={scanning}
        />

        <ClaimFeed
          claimables={portfolio.claimables}
          claims={claims}
        />
      </main>

      <footer className="app-footer">
        <p>
          Runs automatically via GitHub Actions · Zero-cost hosting on GitHub Pages ·{' '}
          <a href="https://app.optimism.io/faucet" target="_blank" rel="noopener noreferrer">
            Get free gas ↗
          </a>
        </p>
      </footer>
    </div>
  );
}
