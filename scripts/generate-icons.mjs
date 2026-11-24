#!/usr/bin/env node
/**
 * Generates the PWA / home-screen icons in web/public/icons from the same
 * design as web/public/favicon.svg (emerald tile, white dumbbell).
 * No dependencies: shapes are rasterised with 4×4 supersampling and written
 * as PNG with node:zlib. Re-run after changing the design:
 *
 *   node scripts/generate-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'icons')

const BRAND = [16, 185, 129] // #10b981
const DARK = [11, 17, 32] // #0b1120
const WHITE = [255, 255, 255]

/** Dumbbell strokes in the favicon's 32×32 design space: [x1, y1, x2, y2]. */
const STROKES = [
  [9, 11, 9, 21],
  [23, 11, 23, 21],
  [6, 14, 6, 18],
  [26, 14, 26, 18],
  [9, 16, 23, 16],
]
const STROKE_RADIUS = 1.25

function distToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function insideRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius)
  const cy = Math.min(Math.max(y, radius), size - radius)
  return Math.hypot(x - cx, y - cy) <= radius
}

/**
 * @param size     output pixels
 * @param variant  'rounded' (favicon-like tile on transparent) | 'full' (edge-to-edge, for
 *                 maskable/iOS which apply their own mask)
 * @param logoScale fraction of the tile used by the 32-unit design (maskable keeps a safe zone)
 */
function render(size, variant, logoScale) {
  const S = 4
  const pixels = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = ((px + (sx + 0.5) / S) / size) * 32
          const y = ((py + (sy + 0.5) / S) / size) * 32
          const inTile = variant === 'full' || insideRoundedSquare(x, y, 32, 8)
          if (!inTile) continue
          // Map into the (possibly shrunk) logo space centred in the tile.
          const lx = (x - 16) / logoScale + 16
          const ly = (y - 16) / logoScale + 16
          const onStroke = STROKES.some((s) => distToSegment(lx, ly, s) <= STROKE_RADIUS)
          const bg = variant === 'full' ? DARK : BRAND
          const fg = variant === 'full' ? BRAND : WHITE
          const c = onStroke ? fg : bg
          r += c[0]
          g += c[1]
          b += c[2]
          a += 255
        }
      }
      const n = S * S
      const i = (py * size + px) * 4
      if (a === 0) continue
      // Un-premultiply colour by coverage so edges blend correctly.
      const cov = a / 255
      pixels[i] = Math.round(r / cov)
      pixels[i + 1] = Math.round(g / cov)
      pixels[i + 2] = Math.round(b / cov)
      pixels[i + 3] = Math.round(a / n)
    }
  }
  return encodePng(size, size, pixels)
}

/* ---------- Minimal PNG encoder (RGBA, 8-bit, no interlace) ---------- */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT, { recursive: true })
const icons = [
  ['icon-192.png', 192, 'rounded', 1],
  ['icon-512.png', 512, 'rounded', 1],
  ['maskable-512.png', 512, 'full', 0.7], // logo inside the 80% safe zone
  ['apple-touch-icon.png', 180, 'full', 0.8], // iOS rounds the corners itself
]
for (const [name, size, variant, scale] of icons) {
  writeFileSync(join(OUT, name), render(size, variant, scale))
  console.log('wrote', join('web/public/icons', name))
}
