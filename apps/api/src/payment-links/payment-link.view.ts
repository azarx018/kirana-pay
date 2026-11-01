/**
 * Pure mapping from database rows to the two response shapes. No I/O here so the
 * privacy rules (what is public, when a QR may be shown) are unit-testable.
 * Entities/rows are never serialized directly.
 */
export type PublicState = 'PAYABLE' | 'PAID' | 'EXPIRED';

export interface PublicPaymentView {
  state: PublicState;
  merchantName: string;
  invoice: {
    reference: string;
    description: string | null;
    amount: number;
    currency: string;
    createdAt: string;
    expiresAt: string;
    paidAt: string | null;
  };
  qrImageDataUrl: string | null;
  serverTime: string;
}

export interface PaymentLinkView {
  status: 'ACTIVE' | 'REVOKED';
  url: string | null;
  createdAt: string;
  createdBy: { email: string } | null;
  revokedAt: string | null;
  revokedBy: { email: string } | null;
}

export interface PublicRow {
  linkStatus: string;
  invoiceStatus: string;
  expired: boolean;
  merchantName: string;
  publicId: string;
  description: string | null;
  amount: string | number;
  currency: string;
  createdAt: Date;
  expiresAt: Date;
  paidAt: Date | null;
}

export interface LinkRow {
  tokenNonce: string;
  status: string;
  createdAt: Date;
  revokedAt: Date | null;
  createdByEmail: string | null;
  revokedByEmail: string | null;
}

/**
 * null => the link must look "unavailable" (revoked link, or an invoice status this
 * code does not know). PAID always wins over the expiry flag: a paid invoice is never
 * shown as expired.
 */
export function derivePublicState(input: {
  linkStatus: string;
  invoiceStatus: string;
  expired: boolean;
}): PublicState | null {
  if (input.linkStatus !== 'ACTIVE') return null;
  switch (input.invoiceStatus) {
    case 'PAID':
      return 'PAID';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'PENDING':
      return input.expired ? 'EXPIRED' : 'PAYABLE';
    default:
      return null;
  }
}

export function toPublicView(
  row: PublicRow,
  state: PublicState,
  qrPng: Buffer | null,
  serverTime: Date,
): PublicPaymentView {
  return {
    state,
    merchantName: row.merchantName,
    invoice: {
      reference: row.publicId,
      description: row.description,
      amount: Number(row.amount),
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    },
    // The QR is only ever exposed while the invoice is payable.
    qrImageDataUrl:
      state === 'PAYABLE' && qrPng ? `data:image/png;base64,${qrPng.toString('base64')}` : null,
    serverTime: serverTime.toISOString(),
  };
}

export function toLinkView(row: LinkRow, url: string | null): PaymentLinkView {
  const active = row.status === 'ACTIVE';
  return {
    status: active ? 'ACTIVE' : 'REVOKED',
    url: active ? url : null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdByEmail ? { email: row.createdByEmail } : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revokedBy: row.revokedByEmail ? { email: row.revokedByEmail } : null,
  };
}
