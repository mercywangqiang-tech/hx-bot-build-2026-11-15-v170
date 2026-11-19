// HXBot v1.7.4: test-only builder of zip archives the way other tools write them, odd parts included.
import { deflateRawSync } from "node:zlib";
import { concat, crc32 } from "./zip";

export interface RawEntry {
  name: string | Uint8Array;
  content: Uint8Array;
  method?: number;
  flags?: number;
  /** Writes a data descriptor after the data (with its signature unless `bareDescriptor`). */
  descriptor?: boolean;
  bareDescriptor?: boolean;
  /** Writes sizes as 0xFFFFFFFF with a ZIP64 record in both headers. */
  zip64?: boolean;
  /** A size that the central directory states instead of the true one. */
  statedSize?: number;
  centralExtra?: Uint8Array;
  versionMadeBy?: number;
  externalAttrs?: number;
}

export const encoder = new TextEncoder();

export function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}
export function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
function u64(value: number): number[] {
  return [...u32(value), ...u32(Math.floor(value / 0x100000000))];
}

/** Builds an archive the way other tools write them, with the odd parts that HXBot must read. */
export function rawZip(
  entries: RawEntry[],
  options: { prefix?: Uint8Array; comment?: string; overlap?: boolean } = {},
): Uint8Array {
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = options.prefix?.length ?? 0;
  if (options.prefix) parts.push(options.prefix);
  let firstOffset = offset;
  for (const [index, entry] of entries.entries()) {
    const name = typeof entry.name === "string" ? encoder.encode(entry.name) : entry.name;
    const method = entry.method ?? 8;
    const data = method === 8 ? deflateRawSync(entry.content) : entry.content;
    const crc = crc32(entry.content);
    const flags = (entry.flags ?? 0) | (entry.descriptor ? 8 : 0);
    const size = entry.statedSize ?? entry.content.length;
    const zip64Extra = entry.zip64 ? [...u16(1), ...u16(16), ...u64(size), ...u64(data.length)] : [];
    const localSizes = entry.descriptor
      ? [...u32(0), ...u32(0), ...u32(0)]
      : entry.zip64
        ? [...u32(crc), ...u32(0xffffffff), ...u32(0xffffffff)]
        : [...u32(crc), ...u32(data.length), ...u32(size)];
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(flags),
      ...u16(method),
      ...u16(0),
      ...u16(0x5821),
      ...localSizes,
      ...u16(name.length),
      ...u16(zip64Extra.length),
      ...name,
      ...zip64Extra,
    ]);
    const descriptor = entry.descriptor
      ? new Uint8Array([
          ...(entry.bareDescriptor ? [] : u32(0x08074b50)),
          ...u32(crc),
          ...u32(data.length),
          ...u32(size),
        ])
      : new Uint8Array(0);
    const entryOffset = options.overlap && index > 0 ? firstOffset : offset;
    if (index === 0) firstOffset = offset;
    if (!(options.overlap && index > 0)) {
      parts.push(local, data, descriptor);
      offset += local.length + data.length + descriptor.length;
    }
    const centralZip64 = entry.zip64 ? [...u16(1), ...u16(16), ...u64(size), ...u64(data.length)] : [];
    const extra = new Uint8Array([...centralZip64, ...(entry.centralExtra ?? [])]);
    centrals.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(entry.versionMadeBy ?? 20),
        ...u16(20),
        ...u16(flags),
        ...u16(method),
        ...u16(0),
        ...u16(0x5821),
        ...u32(crc),
        ...u32(entry.zip64 ? 0xffffffff : data.length),
        ...u32(entry.zip64 ? 0xffffffff : size),
        ...u16(name.length),
        ...u16(extra.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(entry.externalAttrs ?? 0),
        ...u32(entryOffset - (options.prefix?.length ?? 0)),
        ...name,
        ...extra,
      ]),
    );
  }
  const cd = concat(centrals);
  const comment = encoder.encode(options.comment ?? "");
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(cd.length),
    ...u32(offset - (options.prefix?.length ?? 0)),
    ...u16(comment.length),
    ...comment,
  ]);
  return concat([...parts, cd, end]);
}
