import { extractApiKeyCredential, MAX_API_KEY_LENGTH } from './api-key-credential';

const req = (headers: Record<string, string>) => ({
  header: (name: string) => headers[name.toLowerCase()],
});
const KEY = `kp_live_${'a'.repeat(48)}`;

describe('extractApiKeyCredential', () => {
  it('reads Authorization: Bearer (scheme is case-insensitive)', () => {
    expect(extractApiKeyCredential(req({ authorization: `Bearer ${KEY}` }))).toEqual({ kind: 'key', key: KEY });
    expect(extractApiKeyCredential(req({ authorization: `bearer   ${KEY}` }))).toEqual({ kind: 'key', key: KEY });
  });

  it('keeps the legacy x-api-key header working', () => {
    expect(extractApiKeyCredential(req({ 'x-api-key': KEY }))).toEqual({ kind: 'key', key: KEY });
  });

  it('accepts both headers when they carry the same key', () => {
    expect(extractApiKeyCredential(req({ authorization: `Bearer ${KEY}`, 'x-api-key': KEY }))).toEqual({
      kind: 'key',
      key: KEY,
    });
  });

  it('rejects ambiguous credentials instead of picking one', () => {
    expect(extractApiKeyCredential(req({ authorization: `Bearer ${KEY}`, 'x-api-key': `${KEY}x` }))).toEqual({
      kind: 'invalid',
    });
  });

  it('returns none without credentials and ignores non-Bearer schemes', () => {
    expect(extractApiKeyCredential(req({}))).toEqual({ kind: 'none' });
    expect(extractApiKeyCredential(req({ authorization: 'Basic dXNlcjpwYXNz' }))).toEqual({ kind: 'none' });
    expect(extractApiKeyCredential(req({ authorization: 'Bearer' }))).toEqual({ kind: 'none' });
    expect(extractApiKeyCredential(req({ 'x-api-key': '   ' }))).toEqual({ kind: 'none' });
  });

  it('marks oversized, multi-value or whitespace-containing keys invalid', () => {
    expect(extractApiKeyCredential(req({ 'x-api-key': 'k'.repeat(MAX_API_KEY_LENGTH + 1) })).kind).toBe('invalid');
    expect(extractApiKeyCredential(req({ 'x-api-key': `${KEY}, ${KEY}` })).kind).toBe('invalid');
    expect(extractApiKeyCredential(req({ authorization: `Bearer ${KEY} extra` })).kind).toBe('none');
  });

  it('never reads the query string or body (only headers are consulted)', () => {
    const spy = jest.fn((name: string) => (name === 'x-api-key' ? undefined : undefined));
    const source = { header: spy, query: { api_key: KEY, apiKey: KEY }, body: { apiKey: KEY } };
    expect(extractApiKeyCredential(source)).toEqual({ kind: 'none' });
    expect(spy.mock.calls.map((c) => c[0]).sort()).toEqual(['authorization', 'x-api-key']);
  });
});
