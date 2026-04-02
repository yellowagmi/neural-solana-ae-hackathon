# Neural — Agent Graph Service

## What This Is

An agent-to-agent knowledge graph generation + NFT minting service on Solana. A requesting agent sends markdown docs, Neural generates a 3D knowledge graph, anchors a Solana memo receipt, mints a Metaplex Core NFT, and returns the graph + on-chain proof.

**NFT holder receives:** Full agent files (CLAUDE.md, PROJECT.md, MEMORY.md, etc) as downloadable ZIP — the NFT acts as a license key to download the entire agent.

Built for the **Solana Agent Economy Hackathon — Agent Talent Show** (deadline: April 3, 2026 2PM UTC).

## Project Structure

- `server/` — TypeScript Express server (all backend logic)
- `server/scanner.ts` — neural doc-scan v2.0.0 engine (enhanced link discovery)
- `server/server.ts` — main app, 7 API endpoints
- `server/solana.ts` — Solana memo receipt anchoring
- `server/metaplex.ts` — Metaplex Agent Registry + Core NFT minting
- `server/goldrush.ts` — GoldRush reputation scoring
- `server/auth.ts` — x402 payment middleware
- `ui/index.html` — neural-vis 3D Three.js visualiser (v3.1, stable/production)
- `ui/index-dev2.html` — neural-vis 3D visualiser (v4.0, active dev — static Fibonacci layout, true 3D)
- `graphs/` — persisted generated graphs per ID
- `memory/` — build logs

## Running Locally

```bash
cd server
npm install
npx tsx server.ts
# Server starts on port 3000
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | / | none | Redirects to /ui/ |
| GET | /health | none | Status check |
| POST | /generate | x402 | Generate graph + mint NFT |
| GET | /graphs | none | List all graphs |
| GET | /graphs/:id | none | Get graph JSON |
| GET | /graphs/:id/meta | none | NFT address, tx signature, Solscan links |
| GET | /download/skill | none | Download neural-gen scanner ZIP |
| GET | /download/:id | on-chain | Download ZIP (NFT holder only) |
| GET | /reputation/:wallet | none | Trust score |
| GET | /ui/ | none | 3D visualiser (v3.1 stable) |
| GET | /ui-dev2/ | none | 3D visualiser (v4.0 dev, active) |

## Key Commands

```bash
# Health check
curl http://localhost:3000/health

# Generate a graph (the core A2A endpoint)
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: demo-access" \
  -d '{"wallet":"<solana-wallet>","files":{"AGENTS.md":"# content...","PROJECT.md":"# content..."}}'

# List graphs
curl http://localhost:3000/graphs

# Get graph JSON
curl http://localhost:3000/graphs/<id>

# Download neural-gen scanner skill (no auth)
curl -O http://localhost:3000/download/skill

# Download agent files (demo mode)
curl -H "X-PAYMENT: demo-access" http://localhost:3000/download/<id>

# Download agent files (requires NFT ownership — wallet via header or query param)
curl -H "X-WALLET: <wallet>" http://localhost:3000/download/<id>
# or
curl "http://localhost:3000/download/<id>?wallet=<wallet>"

# View in 3D (stable)
open http://localhost:3000/ui/?graph=/graphs/<id>

# View in 3D (dev — true volumetric, active default)
open http://localhost:3000/ui-dev2/?graph=/graphs/<id>
```

## Generate Response

```json
{
  "id": "abc123",
  "nodeCount": 45,
  "edgeCount": 62,
  "fileCount": 3,
  "nftAddress": "NFT_ADDRESS",
  "nftSolscanUrl": "https://solscan.io/token/...?cluster=devnet",
  "txSignature": "...",
  "memoSolscanUrl": "https://solscan.io/tx/...?cluster=devnet",
  "downloadUrl": "/download/abc123",
  "visualiserUrl": "/ui/?graph=/graphs/abc123"
}
```

## Key Features

### Enhanced Scanner (v2.0.0)
4-pattern link discovery finds .md files:
1. Markdown links `[text](file.md)`
2. "See/Read/Follow X.md" patterns
3. "according to X.md" preposition patterns
4. Plain `.md` filename mentions anywhere

### NFT as Download Key
- NFT holder can download full agent files as ZIP
- Contains: files/*.md + graph.json + meta.json
- On-chain verification: checks if buyer's wallet owns the NFT

### 3D Visualiser v3.1 (`/ui/`) — stable
- 5 themes: Sci-fi, Cosmos, Matrix, Solar, Void
- Auto-load from `?graph=` URL param
- D3 force simulation (2D XY only)
- Auto-orbit enabled

### 3D Visualiser v4.0 (`/ui-dev2/`) — active dev, default route
- All v3.1 features plus:
- **Static Fibonacci sphere layout** (no D3) — true volumetric 3D, nodes never collapse flat
- **Spawn animation** — nodes burst from origin with easeOutExpo, drift fades in last 35%
- **Sinusoidal drift** per node (cozy.im style)
- **Layout params**: Cluster spread, Z spread, Orbit radius, Sub spread, Drift, Orbit speed
- **Play animation** — compact start (clusterSpread:100, subSpread:0.9) → expands to default
- **Export video** — full build + 3s orbit tail (6s/8s/13s for 3/5/10s selections)
- Root `/` redirects to `/ui-dev2/`

## Environment Variables (server/.env)

```
SOLANA_RPC_URL=https://api.devnet.solana.com
SELLER_WALLET_KEYPAIR=./keypair.json
GOLDRUSH_API_KEY=<key>
PORT=3000
```

For Railway deployment, set `SELLER_WALLET_KEYPAIR_JSON` as the JSON array string of the keypair instead of the file path.

## Hackathon Tracks

### Track 1 — Solana Agent-to-Agent Economy ($1K gold target)
- Agent pays agent for a service (graph generation)
- x402 payment on Solana
- On-chain verifiable (memo receipts + NFT mint)

### Track 2 — Metaplex Agents ($3K first target)
1. Agent registered on Metaplex Agent Registry ✅
2. A2A interaction: requester pays Neural, receives NFT ✅
3. NFT download: holder gets full agent files ✅

### GoldRush Bonus ($500)
- GET /reputation/:wallet — trust score from GoldRush API

## Deployment

**Live on Railway:** `https://neural-visualizer.up.railway.app`

**GitHub repos:**
- `github.com/yellowagmi/neural-solana-ae-hackathon` — full service (this repo)
- `github.com/yellowagmi/neural-gen` — standalone scanner skill

**Railway env vars required:**
- `SOLANA_RPC_URL` — devnet RPC
- `SELLER_WALLET_KEYPAIR_JSON` — JSON array string of keypair (NOT a file path)
- `PORT` — set automatically by Railway

## On-Chain Assets (devnet)

- Wallet: `Db4YmHtAZLZsgqMjoj96nwgrDAEgmQbquHWok7vGoTkb`
- Agent (Railway): `HRYiDVb8dvrdkNFNeZT44Y7CSNDhF252BBKo6SLU6LXP`
- Agent (local): `G5ZnV4GtR7ZjsXFqYPUnt5wPeN5gK5XiwmAT7kA6EiuB`

## Post-Hackathon Milestones

- [ ] Pinata/IPFS integration — upload files to decentralized storage
- [ ] Set `uri` on NFT — point to decentralized storage URL
- [ ] Pricing model — fixed price per download

## Important Rules

- Do NOT push to GitHub without explicit permission
- Do NOT modify files in `../AoS/` — that's the fallback
- The devnet wallet at `server/keypair.json` has limited SOL — don't spam transactions
- When deploying to Railway, use `SELLER_WALLET_KEYPAIR_JSON` env var (JSON string of the keypair array)