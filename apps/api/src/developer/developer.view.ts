/**
 * The PUBLIC Developer API contract. Deliberately separate from the dashboard's InvoiceView
 * so the contract stays stable and never leaks internal ids, QRIS ids or user emails.
 * `reference` (the public invoice id) is the only identifier a developer ever needs.
 */
export type DeveloperInvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED';

export interface DeveloperInvoice {
  reference: string;
  amount: number;
  currency: string;
  description: string | null;
  status: DeveloperInvoiceStatus;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
}

export interface InvoiceLike {
  publicId: string;
  amount: string | number;
  currency: string;
  description: string | null;
  status: string;
  createdAt: Date | string;
  expiresAt: Date | string;
  paidAt: Date | string | null;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function toDeveloperInvoice(row: InvoiceLike): DeveloperInvoice {
  return {
    reference: row.publicId,
    amount: Number(row.amount),
    currency: row.currency,
    description: row.description,
    status: row.status as DeveloperInvoiceStatus,
    createdAt: iso(row.createdAt),
    expiresAt: iso(row.expiresAt),
    paidAt: row.paidAt ? iso(row.paidAt) : null,
  };
}

export interface DeveloperPaymentLink {
  status: 'ACTIVE' | 'REVOKED';
  url: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** Drops the dashboard-only audit emails (createdBy / revokedBy). */
export function toDeveloperPaymentLink(link: {
  status: 'ACTIVE' | 'REVOKED';
  url: string | null;
  createdAt: string;
  revokedAt: string | null;
}): DeveloperPaymentLink {
  return { status: link.status, url: link.url, createdAt: link.createdAt, revokedAt: link.revokedAt };
}

/* ---------- opaque keyset cursor: (createdAt with microseconds, id) ---------- */

const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Cursor {
  t: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.t, cursor.id]), 'utf8').toString('base64url');
}

/** Returns null for anything that is not exactly a cursor this API produced. */
export function decodeCursor(raw: string): Cursor | null {
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [t, id] = parsed as unknown[];
    if (typeof t !== 'string' || typeof id !== 'string' || !CURSOR_TS.test(t) || !UUID.test(id)) return null;
    return { t, id: id.toLowerCase() };
  } catch {
    return null;
  }
}
