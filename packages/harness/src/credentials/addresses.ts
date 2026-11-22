/**
 * Which network addresses an egress proxy may connect to. It refuses every address that isn't a public one: loopback,
 * link-local (which holds the cloud metadata address 169.254.169.254), private, carrier-grade NAT, unspecified,
 * multicast and reserved ranges, for both IPv4 and IPv6, and an IPv6 address that wraps one of the refused IPv4 ones.
 * Names resolve to addresses in the proxy, and each address is checked here, so a name that points at the host's own
 * network is refused even when its name is allowed. It parses addresses itself and imports no Node module.
 */

/** The IPv4 ranges a proxy refuses, as `[address, prefix length]`. */
const IPV4_REFUSED: readonly (readonly [number, number])[] = [
  [0x00000000, 8], // this network
  [0x0a000000, 8], // private
  [0x64400000, 10], // carrier-grade NAT, 100.64.0.0/10
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local, which holds the metadata address
  [0xac100000, 12], // private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // documentation
  [0xc0a80000, 16], // private
  [0xc6120000, 15], // benchmarking, 198.18.0.0/15
  [0xc6336400, 24], // documentation
  [0xcb007100, 24], // documentation
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved, and the broadcast address
];

/** The four parts of an IPv4 address as one number, or `undefined` when `text` is not a dotted quad. */
function parseIpv4(text: string): number | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

/** The 16-bit groups in one side of an IPv6 address, where the last piece may be a dotted IPv4 address. */
function readGroups(side: string): number[] | undefined {
  if (side === "") return [];
  const groups: number[] = [];
  const pieces = side.split(":");
  for (const [index, piece] of pieces.entries()) {
    const v4 = index === pieces.length - 1 && piece.includes(".") ? parseIpv4(piece) : undefined;
    if (v4 !== undefined) {
      groups.push(Math.floor(v4 / 65536), v4 % 65536);
    } else if (/^[0-9a-fA-F]{1,4}$/.test(piece)) {
      groups.push(Number.parseInt(piece, 16));
    } else {
      return undefined;
    }
  }
  return groups;
}

/** The eight 16-bit groups of an IPv6 address, or `undefined` when `text` is not one. */
function parseIpv6(text: string): number[] | undefined {
  const whole = text.split("%")[0] ?? text;
  const doubles = whole.split("::");
  if (doubles.length > 2) return undefined;
  const head = readGroups(doubles[0] ?? "");
  const tail = doubles.length === 2 ? readGroups(doubles[1] ?? "") : [];
  if (head === undefined || tail === undefined) return undefined;
  if (doubles.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  return missing >= 1 ? [...head, ...new Array<number>(missing).fill(0), ...tail] : undefined;
}

/** Whether `value` falls in one of `ranges`, each an `[address, prefix length]` pair. */
function inIpv4Ranges(value: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return Math.floor(value / size) === Math.floor(base / size);
  });
}

const ipv4Refused = (value: number): boolean => inIpv4Ranges(value, IPV4_REFUSED);

/** The IPv6 prefixes a proxy refuses, as the leading groups and the prefix length in bits. */
const IPV6_REFUSED: readonly (readonly [readonly number[], number])[] = [
  [[0, 0, 0, 0, 0, 0, 0, 0], 128], // ::, unspecified
  [[0, 0, 0, 0, 0, 0, 0, 1], 128], // ::1, loopback
  [[0x64, 0xff9b, 1], 48], // 64:ff9b:1::/48, local-use NAT64
  [[0x100], 64], // 100::/64, discard-only
  [[0x2001, 0], 23], // 2001::/23: Teredo, benchmarking, ORCHID and protocol assignments
  [[0x2001, 0x0db8], 32], // documentation
  [[0x3fff], 20], // 3fff::/20, documentation
  [[0x5f00], 16], // segment routing SIDs
  [[0xfc00], 7], // unique local
  [[0xfe80], 10], // link-local
  [[0xfec0], 10], // site-local, deprecated
  [[0xff00], 8], // multicast
];

/** Whether the first `bits` bits of `groups` equal those of `prefix`. */
function inPrefix(groups: readonly number[], prefix: readonly number[], bits: number): boolean {
  for (let index = 0; index * 16 < bits; index += 1) {
    const take = Math.min(16, bits - index * 16);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if (((groups[index] ?? 0) & mask) !== ((prefix[index] ?? 0) & mask)) return false;
  }
  return true;
}

/** The IPv4 address an IPv6 one carries, as a number: mapped, compatible, translated, NAT64 and 6to4 forms. */
function wrappedIpv4(groups: readonly number[]): number | undefined {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = groups;
  const zeroHigh = a === 0 && b === 0 && c === 0 && d === 0;
  const low = g * 65536 + h;
  if (zeroHigh && e === 0 && (f === 0xffff || f === 0)) return low; // ::ffff:a.b.c.d and ::a.b.c.d
  if (zeroHigh && e === 0xffff && f === 0) return low; // ::ffff:0:a.b.c.d, IPv4-translated
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return low; // 64:ff9b::/96
  return a === 0x2002 ? b * 65536 + c : undefined; // 6to4 wraps the address in its next two groups
}

/** Whether an IPv6 address, as eight groups, is one a proxy refuses. */
function ipv6Refused(groups: readonly number[]): boolean {
  const wrapped = wrappedIpv4(groups);
  if (wrapped !== undefined && ipv4Refused(wrapped)) return true;
  return IPV6_REFUSED.some(([prefix, bits]) => inPrefix(groups, prefix, bits));
}

/**
 * Whether `address` is a public one a proxy may connect to. Text that isn't an IPv4 or IPv6 address is not public, so a
 * resolver's odd answer is refused instead of passed on.
 */
export function isPublicAddress(address: string): boolean {
  const bare = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const v4 = parseIpv4(bare);
  if (v4 !== undefined) return !ipv4Refused(v4);
  const v6 = parseIpv6(bare);
  return v6 !== undefined && !ipv6Refused(v6);
}

/** Whether `text` is an IPv4 or IPv6 address, as a host name that must not be looked up. */
export function isAddressLiteral(text: string): boolean {
  const bare = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  return parseIpv4(bare) !== undefined || parseIpv6(bare) !== undefined;
}

/**
 * The address as eight 16-bit groups, with an IPv4 address in its mapped form `::ffff:a.b.c.d`, or `undefined` when
 * `text` is not an address.
 */
function groupsOf(text: string): number[] | undefined {
  const bare = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  const v4 = parseIpv4(bare);
  if (v4 !== undefined) return [0, 0, 0, 0, 0, 0xffff, Math.floor(v4 / 65536), v4 % 65536];
  return parseIpv6(bare);
}

/** The prefix length of a range in mapped form: an IPv4 prefix counts from bit 96. */
function rangeOf(range: string): { readonly groups: number[]; readonly bits: number } | undefined {
  const [address = "", prefix, extra] = range.split("/");
  if (extra !== undefined) return undefined;
  const groups = groupsOf(address);
  if (groups === undefined) return undefined;
  const v4 = parseIpv4(address) !== undefined;
  const max = v4 ? 32 : 128;
  if (prefix !== undefined && !/^(0|[1-9][0-9]{0,2})$/.test(prefix)) return undefined;
  const length = prefix === undefined ? max : Number(prefix);
  if (length > max) return undefined;
  return { groups, bits: v4 ? length + 96 : length };
}

/** Whether `range` is an address or a CIDR range such as `10.0.0.0/8` or `fd00::/8`. */
export function isAddressRange(range: string): boolean {
  return rangeOf(range) !== undefined;
}

/**
 * Whether `address` lies in `range`, an address or a CIDR range. An IPv4 address and its mapped IPv6 form are the same
 * address here. Text that is not an address, or a range that can't be read, matches nothing.
 */
export function inAddressRange(address: string, range: string): boolean {
  const groups = groupsOf(address);
  const parsed = rangeOf(range);
  return groups !== undefined && parsed !== undefined && inPrefix(groups, parsed.groups, parsed.bits);
}

/** Whether `address` is a loopback address: `127.0.0.0/8`, `::1`, or an IPv6 form that wraps a `127` address. */
export function isLoopbackAddress(address: string): boolean {
  const groups = groupsOf(address);
  if (groups === undefined) return false;
  if (inPrefix(groups, [0, 0, 0, 0, 0, 0, 0, 1], 128)) return true;
  const wrapped = wrappedIpv4(groups);
  return wrapped !== undefined && Math.floor(wrapped / 2 ** 24) === 127;
}

const bareOf = (text: string): string => (text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text);

/**
 * The IPv4 address `address` names, as a number: a dotted quad in its canonical form, or an IPv6 address that wraps
 * one (the mapped, compatible, translated, NAT64 and 6to4 forms). `undefined` for anything else.
 */
export function ipv4Of(address: string): number | undefined {
  const bare = bareOf(address);
  const v4 = parseIpv4(bare);
  if (v4 !== undefined) return v4;
  const v6 = parseIpv6(bare);
  return v6 === undefined ? undefined : wrappedIpv4(v6);
}

/** The IPv4 ranges that reach the host itself or its link: this network, loopback and link-local. */
const IPV4_LOCAL: readonly (readonly [number, number])[] = [
  [0x00000000, 8],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
];

/** The IPv6 prefixes that reach the host itself or its link: unspecified, loopback and link-local. */
const IPV6_LOCAL: readonly (readonly [readonly number[], number])[] = [
  [[0, 0, 0, 0, 0, 0, 0, 0], 128],
  [[0, 0, 0, 0, 0, 0, 0, 1], 128],
  [[0xfe80], 10],
];

/**
 * Whether `address` reaches the host itself or its link: unspecified, loopback or link-local (which holds the cloud
 * metadata address 169.254.169.254), for IPv4 and IPv6, and an IPv6 address that wraps one of those IPv4 ones. Text
 * that isn't an address literal is not one.
 */
export function isLocalAddress(address: string): boolean {
  const v4 = ipv4Of(address);
  if (v4 !== undefined && inIpv4Ranges(v4, IPV4_LOCAL)) return true;
  const v6 = parseIpv6(bareOf(address));
  return v6 !== undefined && IPV6_LOCAL.some(([prefix, bits]) => inPrefix(v6, prefix, bits));
}
