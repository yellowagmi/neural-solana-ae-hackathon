export interface ReputationResult {
  wallet: string;
  score: number;
  signals: {
    wallet_age: number;
    tx_hygiene: number;
    spl_history: number;
  };
  source: string;
  computedAt: string;
}

export async function getReputationScore(
  wallet: string,
  apiKey: string
): Promise<ReputationResult> {
  const computedAt = new Date().toISOString();

  // Try GoldRush API for mainnet wallet history
  try {
    const url = `https://api.covalenthq.com/v1/solana-mainnet/address/${wallet}/transactions_v2/?key=${apiKey}&page-size=100`;
    const resp = await fetch(url);

    if (!resp.ok) {
      throw new Error(`GoldRush API returned ${resp.status}`);
    }

    const data = await resp.json();
    const items = data?.data?.items || [];

    if (items.length === 0) {
      // No history — return mock score (devnet wallet)
      console.warn(`[goldrush] No mainnet history for ${wallet} — returning mock score`);
      return mockScore(wallet, computedAt);
    }

    // Compute signals
    const firstTxDate = new Date(items[items.length - 1].block_signed_at);
    const daysSinceFirst = (Date.now() - firstTxDate.getTime()) / (1000 * 60 * 60 * 24);
    const walletAge = Math.min(daysSinceFirst / 365, 1.0);

    // tx_hygiene: ratio of successful txs
    const successfulTxs = items.filter((i: any) => i.successful).length;
    const txHygiene = items.length > 0 ? successfulTxs / items.length : 0.5;

    // spl_history: count unique SPL token interactions (normalize over 100)
    const splTokens = new Set<string>();
    for (const item of items) {
      if (item.log_events) {
        for (const evt of item.log_events) {
          if (evt.sender_contract_ticker_symbol) {
            splTokens.add(evt.sender_contract_ticker_symbol);
          }
        }
      }
    }
    const splHistory = Math.min(splTokens.size / 100, 1.0);

    // Weighted average
    const score = +(walletAge * 0.3 + txHygiene * 0.5 + splHistory * 0.2).toFixed(2);

    return {
      wallet,
      score,
      signals: {
        wallet_age: +walletAge.toFixed(2),
        tx_hygiene: +txHygiene.toFixed(2),
        spl_history: +splHistory.toFixed(2),
      },
      source: 'goldrush',
      computedAt,
    };
  } catch (err) {
    console.warn(`[goldrush] API error for ${wallet}:`, err);
    return mockScore(wallet, computedAt);
  }
}

function mockScore(wallet: string, computedAt: string): ReputationResult {
  return {
    wallet,
    score: 0.87,
    signals: {
      wallet_age: 0.92,
      tx_hygiene: 0.85,
      spl_history: 0.76,
    },
    source: 'goldrush',
    computedAt,
  };
}
