// PWA 아이콘 PNG 생성 (의존성 없음). 실행: node scripts/gen-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [63, 125, 58]; // #3f7d3a
const SOIL = [247, 246, 241];
const LEAF = [63, 125, 58];

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function inEllipse(x, y, cx, cy, rx, ry, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  const u = (dx * cos + dy * sin) / rx;
  const v = (-dx * sin + dy * cos) / ry;
  return u * u + v * v <= 1;
}

// 좌표는 0~1 정규화. 마스커블 안전영역(중앙 80%) 안에 새싹을 그린다.
function pixel(x, y) {
  const inCircle = (x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.3 ** 2;
  if (!inCircle) return BG;
  const stem = Math.abs(x - 0.5) < 0.018 && y > 0.45 && y < 0.72;
  const leftLeaf = inEllipse(x, y, 0.42, 0.44, 0.1, 0.05, Math.PI / 6);
  const rightLeaf = inEllipse(x, y, 0.58, 0.4, 0.12, 0.055, -Math.PI / 5);
  return stem || leftLeaf || rightLeaf ? LEAF : SOIL;
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel((x + 0.5) / size, (y + 0.5) / size);
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) writeFileSync(`public/icons/icon-${size}.png`, png(size));
writeFileSync("public/icons/apple-touch-icon.png", png(180));
console.log("icons written to public/icons");
