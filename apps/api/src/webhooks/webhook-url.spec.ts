import { MAX_URL_LENGTH, validateWebhookUrl } from './webhook-url';

const prod = { devAllowPrivate: false, allowedPorts: [443, 8443] };
const dev = { devAllowPrivate: true, allowedPorts: [443, 8443] };
const ok = (raw: unknown, policy = prod) => validateWebhookUrl(raw, policy);

describe('validateWebhookUrl (production policy)', () => {
  it('accepts a normal https URL and normalises it', () => {
    expect(ok('https://Hooks.Example.com/kirana')).toEqual({ ok: true, url: 'https://hooks.example.com/kirana', host: 'hooks.example.com' });
    expect(ok('  https://example.com:8443/a?b=1  ')).toMatchObject({ ok: true, host: 'example.com:8443' });
    expect(ok('https://example.com:443/x')).toMatchObject({ ok: true, host: 'example.com' });
  });

  it.each([
    ['http scheme', 'http://example.com/hook'],
    ['ftp scheme', 'ftp://example.com/'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['file scheme', 'file:///etc/passwd'],
    ['gopher scheme', 'gopher://example.com/'],
    ['credentials', 'https://user:pw@example.com/'],
    ['username only', 'https://user@example.com/'],
    ['fragment', 'https://example.com/#x'],
    ['no host', 'https:///path'],
    ['not a url', 'example.com/hook'],
    ['empty', ''],
    ['whitespace', '   '],
  ])('rejects %s', (_n, raw) => {
    expect(ok(raw)).toMatchObject({ ok: false, code: 'INVALID_WEBHOOK_URL' });
  });

  it.each([
    'https://127.0.0.1/',
    'https://10.0.0.5/',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://8.8.8.8/', // even a PUBLIC IP literal: require a DNS name
    'https://2130706433/', // decimal IP
    'https://0x7f.0.0.1/',
    'https://0177.0.0.1/',
    'https://127.1/',
  ])('rejects IP-literal host %s', (raw) => {
    expect(ok(raw)).toMatchObject({ ok: false });
  });

  it.each([
    'https://localhost/',
    'https://LOCALHOST/',
    'https://localhost./',
    'https://app.localhost/',
    'https://printer.local/',
    'https://db.internal/',
    'https://nas.lan/',
    'https://router.home.arpa/',
    'https://postgres/', // docker service name (single label)
    'https://qr-engine/',
    'https://qr-engine:8081/',
  ])('rejects internal-looking host %s', (raw) => {
    expect(ok(raw)).toMatchObject({ ok: false });
  });

  it('only allows the configured ports', () => {
    expect(ok('https://example.com:22/')).toMatchObject({ ok: false });
    expect(ok('https://example.com:5432/')).toMatchObject({ ok: false });
    expect(ok('https://example.com:8443/')).toMatchObject({ ok: true });
    expect(validateWebhookUrl('https://example.com:9000/', { devAllowPrivate: false, allowedPorts: [9000] })).toMatchObject({ ok: true });
  });

  it('rejects non-strings and oversized URLs', () => {
    for (const v of [undefined, null, 42, {}, [], true]) expect(ok(v)).toMatchObject({ ok: false });
    expect(ok(`https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`)).toMatchObject({ ok: false });
  });

  it('never allows the dev-only relaxations', () => {
    expect(ok('http://localhost:3000/hook')).toMatchObject({ ok: false });
    expect(ok('http://127.0.0.1:9999/hook')).toMatchObject({ ok: false });
  });
});

describe('validateWebhookUrl (dev policy, never enabled in production)', () => {
  it('allows http, loopback and any port for local testing', () => {
    expect(ok('http://127.0.0.1:9999/hook', dev)).toMatchObject({ ok: true, host: '127.0.0.1:9999' });
    expect(ok('http://localhost:3000/hook', dev)).toMatchObject({ ok: true });
  });
  it('still rejects credentials, fragments, odd schemes and bad URLs', () => {
    for (const raw of ['https://u:p@localhost/', 'http://localhost/#f', 'ftp://localhost/', 'javascript:1', 'nope']) {
      expect(ok(raw, dev)).toMatchObject({ ok: false });
    }
  });
});
