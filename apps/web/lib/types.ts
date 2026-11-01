export interface Me {
  user: { email: string };
  merchant: { name: string; role: string; phone?: string | null };
}

export interface Provider {
  code: string;
  name: string;
}

export interface Qris {
  id: string;
  displayName: string;
  status: "ACTIVE" | "ARCHIVED";
  provider: Provider;
  nmid: string | null;
  merchantName: string | null;
  imageUrl: string;
}

export interface QrJob {
  id: string;
  status: string;
  amount: number;
  createdAt: string;
  merchant: { name: string; nmid: string };
}

export interface ConvertResult {
  id: string;
  status: string;
  amount: number;
  merchant: { name: string; nmid: string };
  qrImage: { data: string };
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  revoked: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export type InvoiceStatus = "PENDING" | "PAID" | "EXPIRED";

export interface Invoice {
  id: string;
  publicId: string;
  amount: number;
  currency: string;
  description: string | null;
  status: InvoiceStatus;
  qris: { id: string; displayName: string; provider: Provider };
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  confirmationMethod: string | null;
  confirmedBy: { email: string } | null;
  qrUrl: string | null;
}

export interface InvoiceEvent {
  type: "CREATED" | "PAYMENT_CONFIRMED" | "EXPIRED";
  actorEmail: string | null;
  createdAt: string;
}

export interface InvoiceDetail extends Invoice {
  events: InvoiceEvent[];
}

export interface InvoiceList {
  items: Invoice[];
  nextCursor: string | null;
}
