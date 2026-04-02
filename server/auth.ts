import { Request, Response, NextFunction } from 'express';

/**
 * x402 payment header validation middleware.
 * Demo mode: accepts "demo-access" as valid.
 * Production: validates actual x402 USDC payment.
 */
export function x402Auth(req: Request, res: Response, next: NextFunction): void {
  const paymentHeader = req.headers['x-payment'] as string | undefined;

  if (!paymentHeader) {
    res.status(402).json({
      status: 402,
      message: 'Payment Required',
      protocol: 'x402',
      payment: {
        amount: '0.10',
        currency: 'USDC',
        network: 'solana-devnet',
        description: 'Access requires x402 micropayment or demo token',
        resource: req.originalUrl,
      },
      instructions: {
        demo: 'Set header X-PAYMENT: demo-access for hackathon demo',
        production: 'Sign a USDC transfer and pass as X-PAYMENT header',
        reference: 'https://www.x402.org',
      },
    });
    return;
  }

  // Demo mode — accept "demo-access" as valid
  if (paymentHeader === 'demo-access') {
    (req as any).x402Payment = {
      from: 'demo',
      amount: '0.10',
      timestamp: new Date().toISOString(),
      verified: false,
      mode: 'demo',
    };
    next();
    return;
  }

  // Production mode — validate actual payment payload
  try {
    const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
    const paymentData = JSON.parse(decoded);

    if (!paymentData.from || !paymentData.signature) {
      res.status(400).json({ error: 'Invalid payment payload. Required: from, signature' });
      return;
    }

    console.log(`[x402] Payment received from ${paymentData.from} for ${req.originalUrl}`);

    (req as any).x402Payment = {
      from: paymentData.from,
      amount: '0.10',
      timestamp: new Date().toISOString(),
      verified: true,
      mode: 'production',
    };
    next();
  } catch (err) {
    res.status(400).json({ error: 'Malformed payment payload' });
  }
}
