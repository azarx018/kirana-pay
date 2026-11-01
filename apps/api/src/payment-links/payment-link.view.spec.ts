import {
  derivePublicState,
  toLinkView,
  toPublicView,
  type LinkRow,
  type PublicRow,
} from './payment-link.view';

const row = (over: Partial<PublicRow> = {}): PublicRow => ({
  linkStatus: 'ACTIVE',
  invoiceStatus: 'PENDING',
  expired: false,
  merchantName: 'Toko Utama',
  publicId: 'INV-ABCDEFGHJKMN',
  description: '<script>alert(1)</script> kopi',
  amount: '2300',
  currency: 'IDR',
  createdAt: new Date('2026-11-02T10:00:00Z'),
  expiresAt: new Date('2026-11-02T11:00:00Z'),
  paidAt: null,
  ...over,
});
const NOW = new Date('2026-11-02T10:30:00Z');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('derivePublicState', () => {
  it.each([
    ['ACTIVE', 'PENDING', false, 'PAYABLE'],
    ['ACTIVE', 'PENDING', true, 'EXPIRED'],
    ['ACTIVE', 'EXPIRED', false, 'EXPIRED'],
    ['ACTIVE', 'PAID', false, 'PAID'],
    ['ACTIVE', 'PAID', true, 'PAID'], // a paid invoice is never shown as expired
    ['REVOKED', 'PENDING', false, null], // revoked wins over a pending invoice
    ['REVOKED', 'PAID', false, null],
    ['ACTIVE', 'CANCELLED', false, null], // unknown status fails safe
    ['ACTIVE', '', false, null],
  ] as const)('link=%s invoice=%s expired=%s -> %s', (linkStatus, invoiceStatus, expired, expected) => {
    expect(derivePublicState({ linkStatus, invoiceStatus, expired })).toBe(expected);
  });
});

describe('toPublicView privacy', () => {
  it('exposes exactly the approved fields and nothing else', () => {
    const view = toPublicView(row(), 'PAYABLE', PNG, NOW);
    expect(Object.keys(view).sort()).toEqual(['invoice', 'merchantName', 'qrImageDataUrl', 'serverTime', 'state']);
    expect(Object.keys(view.invoice).sort()).toEqual([
      'amount',
      'createdAt',
      'currency',
      'description',
      'expiresAt',
      'paidAt',
      'reference',
    ]);
  });

  it('ignores extra private columns even if a caller passes a wider row', () => {
    const wide = {
      ...row(),
      qrPath: 'var/qr/secret.png',
      merchantId: 'm-1',
      qrisId: 'q-1',
      id: 'uuid',
      confirmedByUserId: 'u-1',
      contactEmail: 'owner@x.id',
      phone: '0812',
    } as PublicRow;
    const json = JSON.stringify(toPublicView(wide, 'PAYABLE', PNG, NOW));
    for (const leak of ['var/qr', 'm-1', 'q-1', 'uuid', 'u-1', 'owner@x.id', '0812', 'qrPath', 'merchantId']) {
      expect(json).not.toContain(leak);
    }
  });

  it('shows the QR only while payable', () => {
    expect(toPublicView(row(), 'PAYABLE', PNG, NOW).qrImageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(toPublicView(row({ invoiceStatus: 'PAID', paidAt: NOW }), 'PAID', PNG, NOW).qrImageDataUrl).toBeNull();
    expect(toPublicView(row({ invoiceStatus: 'EXPIRED' }), 'EXPIRED', PNG, NOW).qrImageDataUrl).toBeNull();
    expect(toPublicView(row(), 'PAYABLE', null, NOW).qrImageDataUrl).toBeNull();
  });

  it('keeps merchant text as inert data and converts amounts to numbers', () => {
    const view = toPublicView(row(), 'PAYABLE', PNG, NOW);
    expect(view.invoice.description).toBe('<script>alert(1)</script> kopi');
    expect(view.invoice.amount).toBe(2300);
    expect(view.serverTime).toBe(NOW.toISOString());
  });
});

describe('toLinkView', () => {
  const link = (over: Partial<LinkRow> = {}): LinkRow => ({
    tokenNonce: 'N'.repeat(22),
    status: 'ACTIVE',
    createdAt: new Date('2026-11-02T10:00:00Z'),
    revokedAt: null,
    createdByEmail: 'a@b.id',
    revokedByEmail: null,
    ...over,
  });

  it('returns the url only for active links and never the nonce/hash', () => {
    const active = toLinkView(link(), 'https://x/pay/T');
    expect(active.url).toBe('https://x/pay/T');
    expect(JSON.stringify(active)).not.toContain('N'.repeat(22));
    const revoked = toLinkView(link({ status: 'REVOKED', revokedAt: new Date(), revokedByEmail: 'c@d.id' }), 'https://x/pay/T');
    expect(revoked.url).toBeNull();
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.revokedBy).toEqual({ email: 'c@d.id' });
  });
});
