import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const result = await Bun.build({ entrypoints: ["./index.html"], outdir: "./dist", minify: true, target: "browser" });
if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });

// Portable PNG app icons, generated without platform-specific image libraries.
// This is a small geometric P monogram, also supplied as SVG in public/.
function pngIcon(size: number) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const stem = u > .28 && u < .4 && v > .24 && v < .77;
    const outer = ((u - .47) / .23) ** 2 + ((v - .42) / .19) ** 2 < 1;
    const inner = ((u - .47) / .11) ** 2 + ((v - .42) / .085) ** 2 < 1;
    const ink = stem || (outer && !inner);
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set(ink ? [216, 239, 152, 255] : [23, 63, 52, 255], offset);
  }
  function crc32(buffer: Buffer) {
    let c = 0xffffffff;
    for (const byte of buffer) { c ^= byte; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
for (const size of [192, 512]) await writeFile(`dist/icon-${size}.png`, pngIcon(size));
const html = await readFile("dist/index.html", "utf8");
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const path = match[1]!;
  if (/^(https?:|#)/.test(path) || ["/", "/david", "/elisabeth"].includes(path)) continue;
  if (!await Bun.file("dist/" + path.replace(/^\.?\//, "")).exists()) throw new Error(`Missing built asset: ${path}`);
}
console.log("Production assets:", (await readdir("dist")).filter(file => file !== ".DS_Store").join(", "));
