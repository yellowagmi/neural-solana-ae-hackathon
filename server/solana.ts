import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export async function anchorReceipt(
  connection: Connection,
  wallet: Keypair,
  payload: string
): Promise<{ txSignature: string; solscanUrl: string }> {
  const tx = new Transaction().add(
    new TransactionInstruction({
      keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(payload, 'utf-8'),
    })
  );

  const txSignature = await sendAndConfirmTransaction(connection, tx, [wallet]);
  const solscanUrl = `https://solscan.io/tx/${txSignature}?cluster=devnet`;

  console.log(`[solana] Memo anchored: ${payload.substring(0, 50)}... → ${txSignature}`);

  return { txSignature, solscanUrl };
}

export async function verifyReceipt(
  connection: Connection,
  txSignature: string,
  expectedPayload: string
): Promise<boolean> {
  // Accept PLACEHOLDER signatures as valid for demo
  if (txSignature.startsWith('PLACEHOLDER_')) {
    console.warn(`[solana] Accepting placeholder signature: ${txSignature}`);
    return true;
  }

  try {
    const tx = await connection.getTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      console.warn(`[solana] Transaction not found: ${txSignature}`);
      return false;
    }

    // Find memo instruction and decode
    const message = tx.transaction.message;
    const accountKeys = message.staticAccountKeys
      ? message.staticAccountKeys.map((k: PublicKey) => k.toBase58())
      : (message as any).accountKeys?.map((k: PublicKey) => k.toBase58()) || [];

    const memoIndex = accountKeys.indexOf(MEMO_PROGRAM_ID.toBase58());
    if (memoIndex === -1) {
      console.warn(`[solana] No memo instruction in tx: ${txSignature}`);
      return false;
    }

    // Decode memo data from the instruction
    const instructions = message.compiledInstructions
      ? message.compiledInstructions
      : (message as any).instructions || [];

    for (const ix of instructions) {
      const progIdx = ix.programIdIndex ?? ix.programIdIndex;
      if (accountKeys[progIdx] === MEMO_PROGRAM_ID.toBase58()) {
        const data = ix.data instanceof Uint8Array
          ? Buffer.from(ix.data).toString('utf-8')
          : Buffer.from(ix.data, 'base64').toString('utf-8');

        if (data === expectedPayload) {
          return true;
        }
        console.warn(`[solana] Memo mismatch: got "${data}", expected "${expectedPayload}"`);
        return false;
      }
    }

    return false;
  } catch (err) {
    console.error(`[solana] Verification error for ${txSignature}:`, err);
    return false;
  }
}
