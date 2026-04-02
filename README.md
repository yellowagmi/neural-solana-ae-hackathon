# Neural — Agent Graph Service

> Agent-to-agent knowledge graph generation + NFT minting on Solana.

**Live demo:** https://neural-visualizer.up.railway.app

Built for the **Solana Agent Economy Hackathon — Agent Talent Show** (April 2026).

---

## What It Does

A requesting agent sends its markdown docs to Neural. Neural:

1. Scans the docs and generates a 3D knowledge graph (sections, entities, cross-file concepts)
2. Anchors a **Solana memo receipt** on-chain as proof of the generation event
3. Mints a **Metaplex Core NFT** to the requester's wallet as the access credential
4. Returns the graph JSON + NFT address + Solscan links

The NFT acts as a **license key** — holder can download the full agent file bundle (ZIP).

```
Agent A  →  POST /generate (x402 + markdown docs)
              ↓
         Neural scans docs → knowledge graph
              ↓
         Anchor Solana memo receipt
              ↓
         Mint Metaplex Core NFT → Agent A's wallet
              ↓
         Return: graph JSON + NFT address + Solscan URLs
              ↓
Agent A  →  GET /ui/?graph=/graphs/:id  (3D visualiser)
         →  GET /download/:id           (agent files ZIP, NFT holders only)
```

---

## Hackathon Tracks

### Track 1 — Solana Agent-to-Agent Economy
- Agent pays agent for a service via x402 on Solana
- On-chain verifiable: memo receipts + NFT mint readable on Solscan

### Track 2 — Metaplex Agents
1. Neural service agent registered on **Metaplex Agent Registry** ✅
2. A2A interaction: requester pays Neural, receives Metaplex Core NFT ✅
3. NFT = download key: holder accesses full agent files on-chain verified ✅

### GoldRush Bonus
- `GET /reputation/:wallet` — trust score from GoldRush/Covalent API

---

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | / | — | Redirects to 3D visualiser |
| GET | /health | — | Status + agent address |
| POST | /generate | x402 | Core A2A: scan docs → anchor memo → mint NFT |
| GET | /graphs | — | List all generated graphs |
| GET | /graphs/:id | — | Full graph JSON |
| GET | /graphs/:id/meta | — | NFT address, tx signatures, Solscan URLs |
| GET | /download/skill | — | Download neural-gen scanner ZIP |
| GET | /download/:id | NFT | Download agent files ZIP (NFT holder only) |
| GET | /reputation/:wallet | — | GoldRush trust score |
| GET | /ui/ | — | 3D neural-vis visualiser |

### Generate a graph (core A2A call)

```bash
curl -X POST https://neural-visualizer.up.railway.app/generate \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: demo-access" \
  -d '{
    "wallet": "<solana-wallet>",
    "files": {
      "AGENTS.md": "# My Agent\n...",
      "PROJECT.md": "# Project\n..."
    }
  }'
```

Response:
```json
{
  "id": "abc123",
  "nodeCount": 45,
  "edgeCount": 62,
  "nftAddress": "...",
  "nftSolscanUrl": "https://solscan.io/token/...?cluster=devnet",
  "memoSolscanUrl": "https://solscan.io/tx/...?cluster=devnet",
  "visualiserUrl": "/ui/?graph=/graphs/abc123",
  "downloadUrl": "/download/abc123"
}
```

### Download agent files (NFT holders)

```bash
curl -H "X-WALLET: <your-wallet>" https://neural-visualizer.up.railway.app/download/<id>
```

---

## 3D Visualiser

Drop any `graph.json` onto the visualiser or load via URL param:

```
/ui/?graph=/graphs/<id>
```

- 5 themes: Sci-fi, Cosmos, Matrix, Solar, Void
- Bloom, physics, and filter controls
- Node types: anchor, file, section, entity, term, shared cross-file concepts

---

## Scanner (neural-gen)

The graph engine (`server/scanner.ts`) is also available as a standalone CLI skill:

```bash
# Download from the live service
curl -O https://neural-visualizer.up.railway.app/download/skill

# Or clone
git clone https://github.com/yellowagmi/neural-gen
cd neural-gen
node src/cli.mjs
```

4-pattern link discovery finds all connected `.md` files:
1. Markdown links `[text](file.md)`
2. "See/Read/Follow X.md" patterns
3. "according to X.md" preposition patterns
4. Plain `.md` filename mentions

---

## Run Locally

```bash
git clone https://github.com/yellowagmi/neural-solana-ae-hackathon
cd neural-solana-ae-hackathon/server
npm install

# Create server/.env
echo "SOLANA_RPC_URL=https://api.devnet.solana.com" > .env

npx tsx server.ts
# → http://localhost:3000
```

---

## On-Chain Assets (devnet)

| Asset | Address |
|-------|---------|
| Service wallet | `Db4YmHtAZLZsgqMjoj96nwgrDAEgmQbquHWok7vGoTkb` |
| Agent (Railway) | `HRYiDVb8dvrdkNFNeZT44Y7CSNDhF252BBKo6SLU6LXP` |

---

## Tech Stack

- **Runtime:** TypeScript + Express on Node.js
- **Chain:** Solana devnet
- **NFTs:** Metaplex Core (`createV1`)
- **Receipts:** Solana Memo program
- **Payments:** x402 protocol (header-based)
- **Reputation:** GoldRush / Covalent API
- **Visualiser:** Three.js + post-processing bloom

---

## Repos

- [`yellowagmi/neural-solana-ae-hackathon`](https://github.com/yellowagmi/neural-solana-ae-hackathon) — full service
- [`yellowagmi/neural-gen`](https://github.com/yellowagmi/neural-gen) — standalone scanner skill
