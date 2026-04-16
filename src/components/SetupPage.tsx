import { useState } from 'react';
import QRCode from 'qrcode';

interface GeneratedWallet {
  address: string;
  privateKey: string;
  mnemonic: string;
}

// Client-side only — private key NEVER leaves the browser
async function generateWallet(): Promise<GeneratedWallet> {
  // Use ethers dynamically to keep bundle lean for non-setup users
  const { ethers } = await import('ethers');
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase || '',
  };
}

async function drawQR(canvas: HTMLCanvasElement, data: string) {
  await QRCode.toCanvas(canvas, data, {
    width: 160,
    margin: 1,
    color: { dark: '#ffffff', light: '#1a1a2e' },
  });
}

export function SetupPage({ onSetup }: { onSetup: (address: string) => void }) {
  const [step, setStep] = useState<'intro' | 'generating' | 'wallet' | 'secret' | 'faucet' | 'done'>('intro');
  const [wallet, setWallet] = useState<GeneratedWallet | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function handleGenerate() {
    setStep('generating');
    try {
      const w = await generateWallet();
      setWallet(w);
      setStep('wallet');
      // Draw QR a tick later so canvas is mounted
      setTimeout(() => {
        const canvas = document.getElementById('setup-qr') as HTMLCanvasElement;
        if (canvas && w.address) drawQR(canvas, w.address);
      }, 100);
    } catch (e) {
      console.error(e);
      setStep('intro');
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  function handleSaveAddress() {
    if (!wallet) return;
    // Persist public address to data/wallet.json via a data URI download
    // (user can also just proceed — address is shown in dashboard)
    onSetup(wallet.address);
    setStep('secret');
  }

  return (
    <div className="setup-page">
      <div className="setup-card">
        <h1 className="setup-title">Free Token Claimer — Setup</h1>

        {step === 'intro' && (
          <div className="setup-step">
            <div className="setup-icon">🔑</div>
            <p>
              This tool generates a dedicated wallet, then scans it daily across
              Ethereum, Base, Optimism, Arbitrum and zkSync for claimable tokens —
              and claims them automatically using GitHub Actions.
            </p>
            <p>
              <strong>Your private key never leaves your browser</strong> — it's only
              stored as a GitHub Actions secret on your own repository.
            </p>
            <div className="setup-steps-overview">
              <div className="setup-step-item">① Generate wallet (30s)</div>
              <div className="setup-step-item">② Add secret to GitHub (1 min)</div>
              <div className="setup-step-item">③ Get free gas from faucet (1 min)</div>
              <div className="setup-step-item">④ Done — bot runs daily</div>
            </div>
            <button className="btn-primary" onClick={handleGenerate}>
              Generate My Wallet
            </button>
          </div>
        )}

        {step === 'generating' && (
          <div className="setup-step center">
            <div className="spinner" />
            <p>Generating secure wallet...</p>
          </div>
        )}

        {step === 'wallet' && wallet && (
          <div className="setup-step">
            <h2>Step 1: Save your wallet</h2>
            <div className="key-box">
              <label>Wallet Address (public — share freely)</label>
              <div className="key-row">
                <code>{wallet.address}</code>
                <button onClick={() => copy(wallet.address, 'address')}>
                  {copied === 'address' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
            <canvas id="setup-qr" className="setup-qr" title="Wallet address QR code" />
            <div className="key-box warning">
              <label>Private Key — KEEP SECRET</label>
              <div className="key-row">
                <code className="blurred" onMouseEnter={e => e.currentTarget.classList.remove('blurred')} onMouseLeave={e => e.currentTarget.classList.add('blurred')}>
                  {wallet.privateKey}
                </code>
                <button onClick={() => copy(wallet.privateKey, 'key')}>
                  {copied === 'key' ? '✓' : 'Copy'}
                </button>
              </div>
              <div className="key-note">
                Hover to reveal. Do NOT share this. Store it offline too.
              </div>
            </div>
            {wallet.mnemonic && (
              <div className="key-box warning">
                <label>Recovery Phrase (12 words)</label>
                <div className="key-row">
                  <code className="blurred" onMouseEnter={e => e.currentTarget.classList.remove('blurred')} onMouseLeave={e => e.currentTarget.classList.add('blurred')}>
                    {wallet.mnemonic}
                  </code>
                  <button onClick={() => copy(wallet.mnemonic, 'mnemonic')}>
                    {copied === 'mnemonic' ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
            <button className="btn-primary" onClick={handleSaveAddress}>
              I've saved my keys — Continue
            </button>
          </div>
        )}

        {step === 'secret' && wallet && (
          <div className="setup-step">
            <h2>Step 2: Add secret to GitHub</h2>
            <ol className="setup-list">
              <li>Go to your GitHub repository</li>
              <li>Click <strong>Settings</strong> → <strong>Secrets and variables</strong> → <strong>Actions</strong></li>
              <li>Click <strong>New repository secret</strong></li>
              <li>Name: <code>WALLET_PRIVATE_KEY</code></li>
              <li>Value: your private key (paste it)</li>
              <li>Click <strong>Add secret</strong></li>
            </ol>
            <div className="key-box">
              <label>Secret name</label>
              <div className="key-row">
                <code>WALLET_PRIVATE_KEY</code>
                <button onClick={() => copy('WALLET_PRIVATE_KEY', 'name')}>
                  {copied === 'name' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
            <button className="btn-primary" onClick={() => setStep('faucet')}>
              Secret added — Continue
            </button>
          </div>
        )}

        {step === 'faucet' && wallet && (
          <div className="setup-step">
            <h2>Step 3: Get free gas (ETH)</h2>
            <p>
              To execute claim transactions, your wallet needs a tiny amount of ETH for gas.
              On L2 chains this is less than $0.01 per transaction — $1 of ETH lasts for months.
            </p>
            <p>
              <strong>Get free ETH from the official Optimism Superchain Faucet</strong>{' '}
              (requires GitHub account — which you already have):
            </p>
            <ol className="setup-list">
              <li>
                Open{' '}
                <a href="https://app.optimism.io/faucet" target="_blank" rel="noopener noreferrer">
                  app.optimism.io/faucet
                </a>
              </li>
              <li>Connect with GitHub → paste your wallet address</li>
              <li>Receive free ETH on Base and Optimism</li>
            </ol>
            <div className="key-box">
              <label>Your wallet address</label>
              <div className="key-row">
                <code>{wallet.address}</code>
                <button onClick={() => copy(wallet.address, 'addr2')}>
                  {copied === 'addr2' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
            <button className="btn-primary" onClick={() => setStep('done')}>
              Got gas — Finish Setup
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="setup-step center">
            <div className="setup-icon success">✅</div>
            <h2>Setup Complete!</h2>
            <p>
              GitHub Actions will now scan your wallet daily and claim any available tokens automatically.
              You'll see updates here whenever the bot runs.
            </p>
            <p>
              To trigger an immediate scan: go to your GitHub repo →
              Actions → "Claim Free Tokens" → "Run workflow".
            </p>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Open Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
