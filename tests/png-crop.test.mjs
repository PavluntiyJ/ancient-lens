import { describe, expect, it } from 'vitest';
import { zlibSync } from 'fflate';
import { cropPng, decodePng, encodePng } from '../scripts/png-crop.mjs';

/** Distinct, deterministic pixels: each channel encodes its position. */
const pixels = (width, height, channels) =>
  Array.from({ length: height }, (_, y) =>
    Uint8Array.from({ length: width * channels }, (_, i) => (y * 37 + i * 11 + (i % channels) * 5) & 0xff),
  );

/** A PNG whose row y uses filter y % 5, written independently of the encoder under test. */
function filteredPng(width, height, channels, rows) {
  const plain = encodePng({ width, height, colour: channels === 4 ? 6 : 2, rows });
  const stride = width * channels;
  const lines = rows.map((row, y) => {
    const filter = y % 5;
    const previous = y ? rows[y - 1] : new Uint8Array(stride);
    const out = new Uint8Array(stride + 1);
    out[0] = filter;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      const estimate = left + up - upLeft;
      const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
      const paeth = a <= b && a <= c ? left : b <= c ? up : upLeft;
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter];
      out[i + 1] = (row[i] - predictor) & 0xff;
    }
    return out;
  });
  // Swap the unfiltered image data of the plain encoding for the filtered one.
  const header = plain.subarray(0, 33);
  const data = Buffer.from(zlibSync(Buffer.concat(lines)));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const type = Buffer.from('IDAT');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([header, length, type, data, crc, plain.subarray(plain.length - 12)]);
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

describe('PNG crop for Linux element captures', () => {
  for (const channels of [3, 4]) {
    it(`decodes every row filter (${channels} channels)`, () => {
      const rows = pixels(7, 10, channels);
      const image = decodePng(filteredPng(7, 10, channels, rows));
      expect([image.width, image.height, image.channels]).toEqual([7, 10, channels]);
      expect(image.rows.map((row) => [...row])).toEqual(rows.map((row) => [...row]));
    });
  }

  it('crops to the rounded rectangle and keeps the pixels', () => {
    const rows = pixels(20, 12, 4);
    const cropped = decodePng(cropPng(filteredPng(20, 12, 4, rows), { x: 2.4, y: 3.6, width: 5.2, height: 4 }));
    expect([cropped.width, cropped.height]).toEqual([6, 4]);
    expect(cropped.rows.map((row) => [...row])).toEqual(rows.slice(4, 8).map((row) => [...row.subarray(8, 32)]));
  });

  it('keeps the crop inside the image and refuses an empty one', () => {
    const png = encodePng({ width: 4, height: 4, colour: 2, rows: pixels(4, 4, 3) });
    const inside = decodePng(cropPng(png, { x: -3, y: 2, width: 10, height: 10 }));
    expect([inside.width, inside.height]).toEqual([4, 2]);
    expect(() => cropPng(png, { x: 5, y: 0, width: 2, height: 2 })).toThrow('outside the image');
  });

  it('refuses images it cannot read', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow('Not a PNG');
  });
});
