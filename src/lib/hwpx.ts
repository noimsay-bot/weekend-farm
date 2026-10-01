// 한글 HWPX(zip + OWPML XML)에서 본문 텍스트를 꺼낸다. 표 셀도 문단 단위로 한 줄씩 나온다.
import { inflateRawSync } from "node:zlib";

type Entry = { name: string; method: number; size: number; offset: number };

function zipEntries(buf: Buffer): Entry[] {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("hwpx: zip 형식이 아님");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    out.push({
      method: buf.readUInt16LE(p + 10),
      size: buf.readUInt32LE(p + 20),
      name: buf.subarray(p + 46, p + 46 + nameLen).toString("utf8"),
      offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

function readEntry(buf: Buffer, e: Entry): Buffer {
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.size);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRawSync(data);
  throw new Error(`hwpx: 지원하지 않는 압축 방식 ${e.method}`);
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function sectionXmlToText(xml: string): string {
  return [...xml.matchAll(/<hp:t>([^<]*)<\/hp:t>|<\/hp:p>/g)]
    .map((m) => (m[1] === undefined ? "\n" : decode(m[1])))
    .join("")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function hwpxText(buf: Buffer): string {
  const sections = zipEntries(buf)
    .filter((e) => /^Contents\/section\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(a.name.match(/\d+/)![0]) - Number(b.name.match(/\d+/)![0]));
  return sections.map((e) => sectionXmlToText(readEntry(buf, e).toString("utf8"))).join("\n");
}
