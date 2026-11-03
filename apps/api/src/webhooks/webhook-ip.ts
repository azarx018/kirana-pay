import { isIP } from 'node:net';

/**
 * Is this address safe to connect to from the server (i.e. a normal public internet host)?
 * Everything private, loopback, link-local (cloud metadata 169.254.169.254), CGNAT / Tailscale
 * (100.64.0.0/10), documentation, multicast and reserved is refused. IPv6 is an ALLOWLIST
 * (global unicast 2000::/3) minus special blocks; addresses that embed an IPv4 (mapped, NAT64,
 * 6to4) are judged by the embedded IPv4.
 */
type V4Range = [string, number];

const BLOCKED_V4: V4Range[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function v4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function inRange(ip: number, [base, prefix]: V4Range): boolean {
  const b = v4ToInt(base) as number;
  const size = 2 ** (32 - prefix);
  return ip >= b && ip < b + size;
}

function isPublicV4Int(ip: number): boolean {
  return !BLOCKED_V4.some((range) => inRange(ip, range));
}

/** 16 bytes, or null when the text is not a valid IPv6 address. */
export function ipv6ToBytes(address: string): Uint8Array | null {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (isIP(text) !== 6) return null;

  let tail: number[] = [];
  const dotted = text.lastIndexOf('.');
  if (dotted !== -1) {
    const colon = text.lastIndexOf(':');
    const v4 = v4ToInt(text.slice(colon + 1));
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 2 ** 16), v4 % 2 ** 16];
    text = text.slice(0, colon + 1) + '0:0';
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const group of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !rest) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail.length === 2) {
    groups[6] = tail[0];
    groups[7] = tail[1];
  }
  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    bytes[i * 2] = g >> 8;
    bytes[i * 2 + 1] = g & 0xff;
  });
  return bytes;
}

function embeddedV4(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 2 ** 24 + bytes[offset + 1] * 2 ** 16 + bytes[offset + 2] * 2 ** 8 + bytes[offset + 3];
}

function isPublicV6(bytes: Uint8Array): boolean {
  const zeros = (from: number, to: number): boolean => bytes.slice(from, to).every((b) => b === 0);
  // IPv4-mapped ::ffff:a.b.c.d  and  IPv4-compatible ::a.b.c.d -> judge the embedded IPv4
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPublicV4Int(embeddedV4(bytes, 12));
  if (zeros(0, 12)) return false; // ::, ::1 and the deprecated IPv4-compatible block
  // NAT64 64:ff9b::/96 -> judge the embedded IPv4
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zeros(4, 12)) {
    return isPublicV4Int(embeddedV4(bytes, 12));
  }
  // only global unicast 2000::/3 is considered routable
  if ((bytes[0] & 0xe0) !== 0x20) return false;
  // 6to4 2002::/16 -> judge the embedded IPv4
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isPublicV4Int(embeddedV4(bytes, 2));
  // IETF protocol assignments 2001::/23 (includes Teredo 2001::/32), documentation 2001:db8::/32 and 3fff::/20
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] < 0x02) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
  if (bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2] & 0xf0) === 0x00) return false;
  return true;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address.includes('%') ? address.slice(0, address.indexOf('%')) : address);
  if (family === 4) {
    const ip = v4ToInt(address);
    return ip !== null && isPublicV4Int(ip);
  }
  if (family === 6) {
    const bytes = ipv6ToBytes(address);
    return bytes !== null && isPublicV6(bytes);
  }
  return false;
}
