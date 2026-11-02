import { decodeCursor, encodeCursor, toDeveloperInvoice, toDeveloperPaymentLink } from './developer.view';

describe('toDeveloperInvoice', () => {
  const row = {
    publicId: 'INV-ABCDEFGHJKMN',
    amount: '25000',
    currency: 'IDR',
    description: 'Kopi',
    status: 'PENDING',
    createdAt: new Date('2026-11-02T10:00:00Z'),
    expiresAt: '2026-11-02T11:00:00.000Z',
    paidAt: null,
  };

  it('exposes exactly the public contract and nothing internal', () => {
    const wide = { ...row, id: 'uuid-1', merchantId: 'm', qrisId: 'q', qrPath: 'var/qr/x', confirmedByUserId: 'u', confirmationMethod: 'MANUAL' };
    const view = toDeveloperInvoice(wide);
    expect(Object.keys(view).sort()).toEqual([
      'amount',
      'createdAt',
      'currency',
      'description',
      'expiresAt',
      'paidAt',
      'reference',
      'status',
    ]);
    expect(JSON.stringify(view)).not.toMatch(/uuid-1|var\/qr|confirm|merchantId|qrisId/);
    expect(view).toMatchObject({ reference: 'INV-ABCDEFGHJKMN', amount: 25000, paidAt: null });
    expect(view.createdAt).toBe('2026-11-02T10:00:00.000Z');
  });
});

describe('toDeveloperPaymentLink', () => {
  it('drops dashboard-only audit emails', () => {
    const view = toDeveloperPaymentLink({
      status: 'ACTIVE',
      url: 'https://x/pay/T',
      createdAt: 'c',
      revokedAt: null,
      createdBy: { email: 'a@b.id' },
    } as never);
    expect(Object.keys(view).sort()).toEqual(['createdAt', 'revokedAt', 'status', 'url']);
  });
});

describe('cursor', () => {
  const cursor = { t: '2026-11-02T10:00:00.123456Z', id: '3f2c1b0a-1111-4222-8333-444455556666' };

  it('round-trips with microsecond precision (no skips on equal milliseconds)', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    'not base64 !!',
    '',
    Buffer.from('{"t":1}').toString('base64url'),
    Buffer.from(JSON.stringify(['2026-11-02T10:00:00Z', '3f2c1b0a-1111-4222-8333-444455556666'])).toString('base64url'),
    Buffer.from(JSON.stringify(['2026-11-02T10:00:00.123456Z', "x'; DROP TABLE invoices;--"])).toString('base64url'),
    Buffer.from(JSON.stringify(['2026-11-02T10:00:00.123456Z', '3f2c1b0a-1111-4222-8333-444455556666', 'extra'])).toString('base64url'),
    'A'.repeat(500),
  ])('rejects tampered cursor %#', (raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});
