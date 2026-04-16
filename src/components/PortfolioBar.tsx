interface Props {
  totalUsd: number;
  claimableUsd: number;
  nativeUsd: number;
}

function StatBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat-box ${accent ? 'accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function PortfolioBar({ totalUsd, claimableUsd, nativeUsd }: Props) {
  const pctClaimable = totalUsd > 0 ? (claimableUsd / totalUsd) * 100 : 0;

  return (
    <div className="card portfolio-bar">
      <div className="stat-row">
        <StatBox label="Total Portfolio" value={`$${totalUsd.toFixed(2)}`} />
        <StatBox label="Claimable Tokens" value={`$${claimableUsd.toFixed(2)}`} accent />
        <StatBox label="ETH Balances" value={`$${nativeUsd.toFixed(2)}`} />
      </div>

      {totalUsd > 0 && (
        <div className="portfolio-progress" title={`${pctClaimable.toFixed(1)}% is claimable`}>
          <div
            className="progress-fill"
            style={{ width: `${Math.min(pctClaimable, 100)}%` }}
          />
        </div>
      )}

      <div className="portfolio-caption">
        Powered by public RPCs. Scans Ethereum, Base, Optimism, Arbitrum, zkSync every 24h.
      </div>
    </div>
  );
}
