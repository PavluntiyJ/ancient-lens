// Crop a PNG screenshot to a rectangle. WebKitWebDriver's element screenshot grows to every
// descendant, even rows hidden in a scrolled list, so Linux captures crop a window shot to
// the element's own box instead. Handles the 8-bit RGB and RGBA images WebDriver returns.
import { unzlibSync, zlibSync } from 'fflate';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Width, height, bytes per pixel and the unfiltered rows of an 8-bit RGB or RGBA PNG. */
export function decodePng(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG image');
  let offset = 8;
  let header;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG header missing');
  const [width, height] = [header.readUInt32BE(0), header.readUInt32BE(4)];
  const [depth, colour, interlace] = [header[8], header[9], header[12]];
  const channels = { 2: 3, 6: 4 }[colour];
  if (depth !== 8 || !channels || interlace !== 0)
    throw new Error(`Unsupported PNG: depth ${depth}, colour type ${colour}, interlace ${interlace}`);
  const raw = unzlibSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new Error('PNG image data has the wrong size');
  const rows = [];
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      if (filter === 1) line[i] += left;
      else if (filter === 2) line[i] += up;
      else if (filter === 3) line[i] += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
        line[i] += a <= b && a <= c ? left : b <= c ? up : upLeft;
      } else if (filter !== 0) throw new Error(`Unknown PNG filter ${filter}`);
    }
    rows.push(line);
    previous = line;
  }
  return { width, height, colour, channels, rows };
}

/** Encode rows of 8-bit RGB (colour 2) or RGBA (colour 6) pixels without filtering. */
export function encodePng({ width, height, colour, rows }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, colour, 0, 0, 0], 8);
  const raw = Buffer.concat(rows.flatMap((row) => [Buffer.from([0]), Buffer.from(row)]));
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', Buffer.from(zlibSync(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The part of `png` inside the rectangle, in image pixels; rounded and kept inside the image. */
export function cropPng(png, { x, y, width, height }) {
  const image = decodePng(png);
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const right = Math.min(image.width, Math.round(x + width));
  const bottom = Math.min(image.height, Math.round(y + height));
  if (right <= left || bottom <= top) throw new Error('Crop rectangle is outside the image');
  return encodePng({
    width: right - left,
    height: bottom - top,
    colour: image.colour,
    rows: image.rows.slice(top, bottom).map((row) => row.subarray(left * image.channels, right * image.channels)),
  });
}
