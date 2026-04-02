import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { config } from 'dotenv';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import archiver from 'archiver';

import { x402Auth } from './auth.js';
import { anchorReceipt } from './solana.js';
import { getReputationScore } from './goldrush.js';
import { createAipUmi, registerAgent, mintAccessNFT, getAgentAddress } from './metaplex.js';
import { generateGraph, type GraphResult } from './scanner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Multer for file uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Serve neural-vis frontend
app.use('/ui', express.static(join(__dirname, '..', 'ui'), { index: 'index.html' }));
// Dev: 3D-improved visualiser
app.use('/ui-dev2', express.static(join(__dirname, '..', 'ui'), { index: 'index-dev2.html' }));
// Dev: 3D-improved visualiser v3 (cleaned params)
app.use('/ui-dev3', express.static(join(__dirname, '..', 'ui'), { index: 'index-dev3.html' }));
// Dev: 3D-improved visualiser v4 (MP4 export)
app.use('/ui-dev4', express.static(join(__dirname, '..', 'ui'), { index: 'index-dev4.html' }));

// ─── Globals ─────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const GOLDRUSH_KEY = process.env.GOLDRUSH_API_KEY || '';
const GRAPHS_PATH = join(__dirname, '..', 'graphs');

let connection: Connection;
let walletKeypair: Keypair;
let umi: any;

// ─── In-memory graph store ──────────────────────────────────────────────────
interface GraphRecord {
  id: string;
  graph: GraphResult;
  requesterWallet: string;
  nftAddress: string;
  nftSolscanUrl: string;
  txSignature: string;
  memoSolscanUrl: string;
  createdAt: string;
}

const graphStore = new Map<string, GraphRecord>();

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET / — redirect to UI
app.get('/', (_req, res) => res.redirect('/ui/'));

// GET /health
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Neural Graph Service',
    version: '1.0',
    chain: 'solana-devnet',
    graphsGenerated: graphStore.size,
    agentAddress: getAgentAddress(),
  });
});

// POST /generate — the core A2A endpoint
// Accepts either JSON body { files: { "filename.md": "content", ... }, wallet: "..." }
// or multipart form with .md file uploads + wallet field
app.post('/generate', x402Auth, upload.array('files', 20), async (req, res) => {
  try {
    let files: Record<string, string> = {};
    let requesterWallet = '';

    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      // Multipart upload
      for (const file of req.files as Express.Multer.File[]) {
        const filename = file.originalname || `file_${Object.keys(files).length}.md`;
        files[filename] = file.buffer.toString('utf-8');
      }
      requesterWallet = req.body?.wallet || 'anonymous';
    } else if (req.body?.files) {
      // JSON body
      files = req.body.files;
      requesterWallet = req.body.wallet || 'anonymous';
    } else {
      res.status(400).json({ error: 'No files provided. Send JSON { files: { "name.md": "content" }, wallet: "..." } or multipart form with .md files.' });
      return;
    }

    if (Object.keys(files).length === 0) {
      res.status(400).json({ error: 'No files provided' });
      return;
    }

    // Generate graph
    console.log(`[neural] Generating graph from ${Object.keys(files).length} file(s) for ${requesterWallet}`);
    const graph = generateGraph(files);
    const graphId = uuidv4().split('-')[0];

    // Anchor memo receipt
    let txSignature = `PLACEHOLDER_NEURAL_${Date.now()}`;
    let memoSolscanUrl = `https://solscan.io/tx/${txSignature}?cluster=devnet`;

    try {
      const payload = `neural:${graphId}:generate:${graph.meta.nodeCount}nodes:${graph.meta.edgeCount}edges:${requesterWallet.substring(0, 8)}`;
      const result = await anchorReceipt(connection, walletKeypair, payload);
      txSignature = result.txSignature;
      memoSolscanUrl = result.solscanUrl;
    } catch (err) {
      console.warn('[neural] Failed to anchor memo:', err);
    }

    // Mint NFT
    let nftAddress = `NFT_NEURAL_${graphId}`;
    let nftSolscanUrl = `https://solscan.io/token/${nftAddress}?cluster=devnet`;

    try {
      const mintResult = await mintAccessNFT(umi, requesterWallet !== 'anonymous' ? requesterWallet : walletKeypair.publicKey.toBase58(), `neural-${graphId}`);
      nftAddress = mintResult.nftAddress;
      nftSolscanUrl = mintResult.solscanUrl;
    } catch (err) {
      console.warn('[neural] NFT minting failed:', err);
    }

    // Store
    const record: GraphRecord = {
      id: graphId,
      graph,
      requesterWallet,
      nftAddress,
      nftSolscanUrl,
      txSignature,
      memoSolscanUrl,
      createdAt: new Date().toISOString(),
    };
    graphStore.set(graphId, record);

    // Persist to disk
    const graphDir = join(GRAPHS_PATH, graphId);
    mkdirSync(graphDir, { recursive: true });
    writeFileSync(join(graphDir, 'graph.json'), JSON.stringify(graph, null, 2));
    writeFileSync(join(graphDir, 'meta.json'), JSON.stringify({
      id: graphId,
      requesterWallet,
      nftAddress,
      nftSolscanUrl,
      txSignature,
      memoSolscanUrl,
      nodeCount: graph.meta.nodeCount,
      edgeCount: graph.meta.edgeCount,
      createdAt: record.createdAt,
    }, null, 2));

    // Save original files for NFT download
    const filesDir = join(graphDir, 'files');
    mkdirSync(filesDir, { recursive: true });
    Object.entries(files).forEach(([filename, content]) => {
      writeFileSync(join(filesDir, filename), content);
    });
    console.log(`[neural] Saved ${Object.keys(files).length} files for NFT download`);

    console.log(`[neural] Graph ${graphId}: ${graph.meta.nodeCount} nodes, ${graph.meta.edgeCount} edges, NFT: ${nftAddress}`);

    res.json({
      id: graphId,
      nodeCount: graph.meta.nodeCount,
      edgeCount: graph.meta.edgeCount,
      sharedNodes: graph.meta.sharedNodes,
      fileCount: graph.meta.fileCount,
      nftAddress,
      nftSolscanUrl,
      txSignature,
      memoSolscanUrl,
      graphUrl: `/graphs/${graphId}`,
      visualiserUrl: `/ui/?graph=/graphs/${graphId}`,
      downloadUrl: `/download/${graphId}`,
    });
  } catch (err: any) {
    console.error('[neural] Generation error:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

// GET /graphs — list all generated graphs
app.get('/graphs', (_req, res) => {
  const graphs = [...graphStore.values()].map(r => ({
    id: r.id,
    project: r.graph.meta.project,
    nodeCount: r.graph.meta.nodeCount,
    edgeCount: r.graph.meta.edgeCount,
    requesterWallet: r.requesterWallet,
    nftAddress: r.nftAddress,
    createdAt: r.createdAt,
  }));

  res.json({ graphs, total: graphs.length });
});

// GET /graphs/:id — get full graph JSON
app.get('/graphs/:id', (req, res) => {
  const id = req.params.id as string;
  const record = graphStore.get(id);

  if (!record) {
    res.status(404).json({ error: 'Graph not found' });
    return;
  }

  res.json(record.graph);
});

// GET /graphs/:id/meta — get graph metadata (NFT, tx, etc)
app.get('/graphs/:id/meta', (req, res) => {
  const id = req.params.id as string;
  const record = graphStore.get(id);

  if (!record) {
    res.status(404).json({ error: 'Graph not found' });
    return;
  }

  res.json({
    id: record.id,
    project: record.graph.meta.project,
    nodeCount: record.graph.meta.nodeCount,
    edgeCount: record.graph.meta.edgeCount,
    sharedNodes: record.graph.meta.sharedNodes,
    requesterWallet: record.requesterWallet,
    nftAddress: record.nftAddress,
    nftSolscanUrl: record.nftSolscanUrl,
    txSignature: record.txSignature,
    memoSolscanUrl: record.memoSolscanUrl,
    createdAt: record.createdAt,
  });
});

// GET /reputation/:wallet
app.get('/reputation/:wallet', async (req, res) => {
  const result = await getReputationScore(req.params.wallet, GOLDRUSH_KEY);
  res.json(result);
});

// GET /download/skill — Download pre-built neural-gen scanner skill (no auth required)
app.get('/download/skill', (_req, res) => {
  const skillPath = join(__dirname, 'assets', 'neural-gen.zip');
  if (!existsSync(skillPath)) {
    res.status(404).json({ error: 'Skill package not found' });
    return;
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="neural-gen.zip"');
  res.sendFile(skillPath);
});

// Verify NFT ownership on-chain
async function verifyNFTOwnership(walletAddress: string, nftAddress: string): Promise<boolean> {
  try {
    if (!connection || !nftAddress) return false;
    
    const nftMint = new PublicKey(nftAddress);
    const ownerWallet = new PublicKey(walletAddress);
    
    const tokens = await connection.getParsedTokenAccountsByOwner(ownerWallet, {
      mint: nftMint,
    });
    
    const hasNFT = tokens.value.some(acc => {
      const amount = acc.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0;
      return amount >= 1;
    });
    
    return hasNFT;
  } catch (err) {
    console.warn('[verify] NFT check failed:', err);
    return false;
  }
}

// GET /download/:id - Download agent files as ZIP (NFT holder only)
app.get('/download/:id', async (req, res) => {
  const graphId = req.params.id as string;
  const record = graphStore.get(graphId);
  
  if (!record) {
    res.status(404).json({ error: 'Graph not found' });
    return;
  }
  
  const filesDir = join(GRAPHS_PATH, graphId, 'files');
  
  if (!existsSync(filesDir)) {
    res.status(404).json({ error: 'No files available for download' });
    return;
  }
  
  // Demo mode - skip verification
  const isDemo = req.headers['x-payment'] === 'demo-access';
  
  if (!isDemo) {
    const buyerWallet = req.headers['x-wallet'] as string || req.query.wallet as string;
    
    if (!buyerWallet) {
      res.status(401).json({ error: 'Wallet address required. Pass X-WALLET header or ?wallet= param' });
      return;
    }
    
    // Verify on-chain that buyer owns the NFT
    const ownsNFT = await verifyNFTOwnership(buyerWallet, record.nftAddress);
    
    if (!ownsNFT) {
      res.status(403).json({ error: 'You do not own the NFT for this agent. Purchase it first.' });
      return;
    }
  }
  
  // Create ZIP archive
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="agent-${graphId}.zip"`);
  
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  archive.on('error', (err) => {
    console.error('[download] Archive error:', err);
    res.status(500).end();
  });
  
  archive.pipe(res);
  
  // Add all files from files directory
  const files = readdirSync(filesDir);
  for (const file of files) {
    const filePath = join(filesDir, file);
    archive.file(filePath, { name: file });
  }
  
  // Add graph.json
  const graphJsonPath = join(GRAPHS_PATH, graphId, 'graph.json');
  if (existsSync(graphJsonPath)) {
    archive.file(graphJsonPath, { name: 'graph.json' });
  }
  
  // Add meta.json
  const metaJsonPath = join(GRAPHS_PATH, graphId, 'meta.json');
  if (existsSync(metaJsonPath)) {
    archive.file(metaJsonPath, { name: 'meta.json' });
  }
  
  await archive.finalize();
  
  console.log(`[neural] Downloaded agent ${graphId} by ${req.headers['x-wallet'] || 'demo'}`);
});

// ─── Startup ─────────────────────────────────────────────────────────────────
async function start() {
  connection = new Connection(RPC_URL, 'confirmed');

  // Load keypair
  try {
    let keypairData: number[];
    if (process.env.SELLER_WALLET_KEYPAIR_JSON) {
      keypairData = JSON.parse(process.env.SELLER_WALLET_KEYPAIR_JSON);
    } else {
      const keypairPath = join(__dirname, process.env.SELLER_WALLET_KEYPAIR || './keypair.json');
      keypairData = JSON.parse(readFileSync(keypairPath, 'utf-8'));
    }
    walletKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log(`[solana] Wallet: ${walletKeypair.publicKey.toBase58()}`);
  } catch (err) {
    console.warn('[solana] No keypair found — using generated wallet');
    walletKeypair = Keypair.generate();
  }

  // Init Metaplex UMI
  try {
    umi = createAipUmi(RPC_URL, walletKeypair.secretKey);
  } catch (err) {
    console.warn('[metaplex] UMI init failed:', err);
  }

  // Create graphs dir
  mkdirSync(GRAPHS_PATH, { recursive: true });

  // Load existing graphs from disk
  if (existsSync(GRAPHS_PATH)) {
    const dirs = readdirSync(GRAPHS_PATH, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      try {
        const graphPath = join(GRAPHS_PATH, dir.name, 'graph.json');
        const metaPath = join(GRAPHS_PATH, dir.name, 'meta.json');
        if (existsSync(graphPath) && existsSync(metaPath)) {
          const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
          const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
          graphStore.set(dir.name, { id: dir.name, graph, ...meta });
        }
      } catch {}
    }
    if (graphStore.size > 0) console.log(`[neural] Loaded ${graphStore.size} graph(s) from disk`);
  }

  // Register agent
  let agentAddr = 'not-registered';
  try {
    agentAddr = await registerAgent(umi, {
      name: 'Neural Graph Service',
      description: 'Agent-to-agent knowledge graph generation and NFT minting service on Solana',
      apiEndpoint: `http://localhost:${PORT}`,
    });
  } catch (err) {
    console.warn('[metaplex] Agent registration skipped:', err);
  }

  app.listen(PORT, () => {
    console.log(`
  ┌──────────────────────────────────────────────┐
  │  Neural — Agent Graph Service                │
  │  Solana Agent Economy Hackathon 2026         │
  ├──────────────────────────────────────────────┤
  │  POST /generate            → graph + mint    │
  │  GET  /graphs              → list graphs     │
  │  GET  /graphs/:id          → graph JSON      │
  │  GET  /graphs/:id/meta     → NFT + tx info   │
  │  GET  /reputation/:wallet  → trust score     │
  │  GET  /ui/                 → 3D visualiser   │
  ├──────────────────────────────────────────────┤
  │  Chain:  Solana devnet                       │
  │  Graphs: ${String(graphStore.size).padEnd(2)} loaded                        │
  │  Agent:  ${agentAddr.substring(0, 33).padEnd(33)} │
  │  Port:   ${String(PORT).padEnd(33)} │
  └──────────────────────────────────────────────┘
    `);
  });
}

start().catch(console.error);
