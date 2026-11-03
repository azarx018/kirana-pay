import { ipv6ToBytes, isPublicAddress } from './webhook-ip';

describe('isPublicAddress: IPv4', () => {
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '151.101.1.69', '203.0.114.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1', '192.169.0.1', '198.20.0.1'])(
    'allows public %s',
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1', // CGNAT / Tailscale
    '100.100.100.100',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254', // cloud metadata
    '169.254.0.1',
    '172.16.0.1',
    '172.17.0.2', // docker bridge
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['', 'abc', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.256', '01.2.3.4x', ' 8.8.8.8', '8.8.8.8 ', '0x7f.0.0.1', '2130706433', '127.1'])(
    'treats non-address %j as unsafe',
    (value) => expect(isPublicAddress(value)).toBe(false),
  );
});

describe('isPublicAddress: IPv6', () => {
  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:81b::200e', '2620:fe::fe'])('allows global unicast %s', (ip) =>
    expect(isPublicAddress(ip)).toBe(true),
  );

  it.each([
    '::',
    '::1',
    '0:0:0:0:0:0:0:1',
    'fe80::1',
    'fe80::1%eth0',
    'fc00::1',
    'fd12:3456:789a::1', // ULA
    'fec0::1',
    'ff02::1',
    '2001:db8::1', // documentation
    '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
    '2001:10::1', // ORCHID
    '100::1',
    '3fff::1',
    '4000::1',
    'a000::1',
  ])('blocks %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it('judges IPv4-mapped addresses by the embedded IPv4', () => {
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:169.254.169.254')).toBe(false);
    expect(isPublicAddress('::ffff:10.1.2.3')).toBe(false);
    expect(isPublicAddress('::ffff:7f00:1')).toBe(false); // hex form of 127.0.0.1
    expect(isPublicAddress('0:0:0:0:0:ffff:c0a8:101')).toBe(false); // 192.168.1.1
    expect(isPublicAddress('::ffff:808:808')).toBe(true); // 8.8.8.8
  });

  it('judges NAT64 and 6to4 addresses by the embedded IPv4', () => {
    expect(isPublicAddress('64:ff9b::808:808')).toBe(true);
    expect(isPublicAddress('64:ff9b::7f00:1')).toBe(false);
    expect(isPublicAddress('64:ff9b::a9fe:a9fe')).toBe(false); // 169.254.169.254
    expect(isPublicAddress('2002:808:808::1')).toBe(true);
    expect(isPublicAddress('2002:7f00:1::1')).toBe(false);
    expect(isPublicAddress('2002:c0a8:101::1')).toBe(false);
  });

  it('blocks the deprecated IPv4-compatible form', () => {
    expect(isPublicAddress('::8.8.8.8')).toBe(false);
    expect(isPublicAddress('::127.0.0.1')).toBe(false);
  });

  it('never throws on malformed input', () => {
    for (const v of ['::::', '1::2::3', 'g::1', '12345::1', ':1', '1:', '::ffff:999.1.1.1', '[::1]', '::1/128']) {
      expect(isPublicAddress(v)).toBe(false);
    }
  });
});

describe('ipv6ToBytes', () => {
  it('expands compression and embedded dotted IPv4', () => {
    expect(Array.from(ipv6ToBytes('::1') as Uint8Array)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(ipv6ToBytes('::ffff:1.2.3.4') as Uint8Array).slice(10)).toEqual([0xff, 0xff, 1, 2, 3, 4]);
    expect(Array.from(ipv6ToBytes('2001:db8::ff00:42:8329') as Uint8Array)).toEqual([
      0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0xff, 0x00, 0x00, 0x42, 0x83, 0x29,
    ]);
  });
  it('rejects invalid text', () => {
    expect(ipv6ToBytes('nope')).toBeNull();
    expect(ipv6ToBytes('1.2.3.4')).toBeNull();
  });
});
