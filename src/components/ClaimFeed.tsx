import type { Claimable, Claim } from '../types';

interface Props {
  claimables: Claimable[];
  claims: Claim[];
}

const CHAIN_COLOR: Record<string, string> = {
  ethereum: '#627eea',
  base:     '#0052ff',
  optimism: '#ff0420',
  arbitrum: '#2d374b',
  zksync:   '#8c8dfc',
};

function ChainBadge({ chain }: { chain: string }) {
  return (
    <span
      className="chain-badge"
      style={{ background: CHAIN_COLOR[chain] || '#555' }}
    >
      {chain}
    </span>
  );
}

function formatAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor(diff / 60000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${mins}m ago`;
}

function ClaimableRow({ item }: { item: Claimable }) {
  return (
    <div className="claim-row claimable-row">
      <div className="claim-left">
        <ChainBadge chain={item.chain} />
        <div className="claim-name">{item.name}</div>
        <div className="claim-discovered">{formatAgo(item.discoveredAt)}</div>
      </div>
      <div className="claim-right">
        <div className="claim-amount">
          {item.amount.toFixed(4)} <strong>{item.tokenSymbol}</strong>
        </div>
        <div className="claim-usd">${item.usdValue.toFixed(2)}</div>
        <div className="claim-status pending">Pending</div>
      </div>
    </div>
  );
}

function ClaimRow({ item }: { item: Claim }) {
  const failed = item.status === 'failed';
  return (
    <div className={`claim-row history-row ${failed ? 'failed' : 'success'}`}>
      <div className="claim-left">
        <ChainBadge chain={item.chain} />
        <div className="claim-name">{item.name}</div>
        <div className="claim-discovered">{formatAgo(item.claimedAt)}</div>
      </div>
      <div className="claim-right">
        <div className="claim-amount">
          {item.amount.toFixed(4)} <strong>{item.tokenSymbol}</strong>
        </div>
        <div className="claim-usd">${item.usdValue.toFixed(2)}</div>
        {failed ? (
          <div className="claim-status failed" title={item.error}>Failed</div>
        ) : (
          <div className="claim-status success">
            {item.txHash ? (
              <a
                href={`https://etherscan.io/tx/${item.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Claimed ↗
              </a>
            ) : 'Claimed'}
          </div>
        )}
      </div>
    </div>
  );
}

export function ClaimFeed({ claimables, claims }: Props) {
  const totalClaimed = claims
    .filter(c => !c.status)
    .reduce((s, c) => s + c.usdValue, 0);

  return (
    <div className="card claim-feed">
      {claimables.length > 0 && (
        <section>
          <h2 className="section-title">
            Claimable Now
            <span className="section-badge claimable">{claimables.length}</span>
          </h2>
          <div className="claim-list">
            {claimables.map(c => (
              <ClaimableRow key={c.id} item={c} />
            ))}
          </div>
          <div className="section-note">
            Claims execute automatically each day via GitHub Actions.
          </div>
        </section>
      )}

      {claimables.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">No claimable tokens right now</div>
          <div className="empty-sub">
            The bot scans daily. When new airdrops or rewards are found,
            they appear here and are claimed automatically.
          </div>
        </div>
      )}

      {claims.length > 0 && (
        <section className="history-section">
          <h2 className="section-title">
            Claim History
            <span className="section-badge history">{claims.length}</span>
            <span className="section-total">${totalClaimed.toFixed(2)} total</span>
          </h2>
          <div className="claim-list">
            {claims.slice(0, 20).map((c, i) => (
              <ClaimRow key={`${c.id}-${i}`} item={c} />
            ))}
            {claims.length > 20 && (
              <div className="more-claims">
                + {claims.length - 20} older claims
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
