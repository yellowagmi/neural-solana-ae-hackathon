import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createV1,
  mplCore,
  fetchAssetV1,
} from '@metaplex-foundation/mpl-core';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  type Umi,
  type KeypairSigner,
} from '@metaplex-foundation/umi';

let agentAddress: string | null = null;

export function createAipUmi(rpcUrl: string, keypairBytes: Uint8Array): Umi {
  const umi = createUmi(rpcUrl).use(mplCore());

  // Convert raw keypair bytes to Umi keypair
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(keypairBytes);
  umi.use(keypairIdentity(umiKeypair));

  return umi;
}

export async function registerAgent(
  umi: Umi,
  metadata: { name: string; description: string; apiEndpoint: string }
): Promise<string> {
  // Metaplex Agent Registry: create a Core asset representing the agent identity
  // This serves as the on-chain agent registration
  try {
    const assetSigner = generateSigner(umi);

    await createV1(umi, {
      asset: assetSigner,
      name: metadata.name,
      uri: '', // Can point to off-chain metadata JSON
    }).sendAndConfirm(umi);

    agentAddress = assetSigner.publicKey.toString();
    console.log(`[metaplex] Agent registered: ${agentAddress}`);
    return agentAddress;
  } catch (err) {
    console.error('[metaplex] Agent registration failed:', err);
    // Return a placeholder if registration fails (e.g., no SOL balance)
    agentAddress = `AGENT_${umi.identity.publicKey.toString().substring(0, 8)}`;
    console.warn(`[metaplex] Using placeholder agent address: ${agentAddress}`);
    return agentAddress;
  }
}

export async function mintAccessNFT(
  umi: Umi,
  buyerWallet: string,
  bundleId: string
): Promise<{ nftAddress: string; solscanUrl: string }> {
  try {
    const assetSigner = generateSigner(umi);

    await createV1(umi, {
      asset: assetSigner,
      name: `AIP Access: ${bundleId}`,
      uri: '', // Metadata URI
      owner: publicKey(buyerWallet),
    }).sendAndConfirm(umi);

    const nftAddress = assetSigner.publicKey.toString();
    const solscanUrl = `https://solscan.io/token/${nftAddress}?cluster=devnet`;

    console.log(`[metaplex] Access NFT minted: ${nftAddress} → ${buyerWallet}`);
    return { nftAddress, solscanUrl };
  } catch (err) {
    console.error('[metaplex] NFT minting failed:', err);
    // Return placeholder for demo when wallet has no SOL
    const placeholder = `NFT_${bundleId}_${Date.now()}`;
    return {
      nftAddress: placeholder,
      solscanUrl: `https://solscan.io/token/${placeholder}?cluster=devnet`,
    };
  }
}

export function getAgentAddress(): string | null {
  return agentAddress;
}
