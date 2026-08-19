/**
 * Generates the PWA icon set without any image dependencies: raw RGBA pixels
 * encoded straight into PNG with Node's built-in zlib.
 *
 * Run with `node scripts/make-icons.mjs`.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

/* ---------- PNG encoding ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------- drawing ---------- */

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]

/** Signed coverage of a rounded rectangle at a point, 0..1, anti-aliased. */
function inRoundedRect(px, py, x, y, w, h, r) {
  const cx = Math.max(x + r, Math.min(px, x + w - r))
  const cy = Math.max(y + r, Math.min(py, y + h - r))
  const dx = px - cx
  const dy = py - cy
  if (px < x || px > x + w || py < y || py > y + h) return false
  return dx * dx + dy * dy <= r * r
}

const inRect = (px, py, x, y, w, h) => px >= x && px <= x + w && py >= y && py <= y + h

/**
 * The ENAB mark: a solid rounded tile with a geometric "E" cut into it —
 * three bars and a stem, which reads clearly even at 48px on a home screen.
 */
function drawIcon(size, { bg, fg, cornerRadius, inset }) {
  const rgba = Buffer.alloc(size * size * 4)
  const [br, bgc, bb] = hex(bg)
  const [fr, fgc, fb] = hex(fg)

  const tile = { x: inset, y: inset, w: size - inset * 2, h: size - inset * 2 }
  const radius = cornerRadius * tile.w

  // Glyph box, centred in the tile.
  const gw = tile.w * 0.46
  const gh = tile.h * 0.52
  const gx = tile.x + (tile.w - gw) / 2
  const gy = tile.y + (tile.h - gh) / 2
  const bar = gh * 0.2
  const stem = gw * 0.26

  const SAMPLES = 3 // supersample for smooth edges

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tileHits = 0
      let glyphHits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES
          const py = y + (sy + 0.5) / SAMPLES
          if (inRoundedRect(px, py, tile.x, tile.y, tile.w, tile.h, radius)) tileHits++
          const inGlyph =
            inRect(px, py, gx, gy, stem, gh) ||
            inRect(px, py, gx, gy, gw, bar) ||
            inRect(px, py, gx, gy + (gh - bar) / 2, gw * 0.8, bar) ||
            inRect(px, py, gx, gy + gh - bar, gw, bar)
          if (inGlyph) glyphHits++
        }
      }
      const total = SAMPLES * SAMPLES
      const tileA = tileHits / total
      const glyphA = glyphHits / total

      const i = (y * size + x) * 4
      rgba[i] = Math.round(br + (fr - br) * glyphA)
      rgba[i + 1] = Math.round(bgc + (fgc - bgc) * glyphA)
      rgba[i + 2] = Math.round(bb + (fb - bb) * glyphA)
      rgba[i + 3] = Math.round(255 * tileA)
    }
  }
  return encodePng(size, size, rgba)
}

/* ---------- outputs ---------- */

const BG = '#0a0a0a'
const FG = '#ff6a00'

mkdirSync(OUT_DIR, { recursive: true })

const files = [
  ['icon-192.png', drawIcon(192, { bg: BG, fg: FG, cornerRadius: 0.22, inset: 0 })],
  ['icon-512.png', drawIcon(512, { bg: BG, fg: FG, cornerRadius: 0.22, inset: 0 })],
  // Maskable icons are cropped to a circle by some launchers, so the tile is
  // full-bleed and the glyph sits well inside the safe zone.
  ['icon-maskable-512.png', drawIcon(512, { bg: BG, fg: FG, cornerRadius: 0, inset: 0 })],
  ['apple-touch-icon.png', drawIcon(180, { bg: BG, fg: FG, cornerRadius: 0.22, inset: 0 })],
]

for (const [name, buffer] of files) {
  writeFileSync(join(OUT_DIR, name), buffer)
  console.log(`wrote ${name} (${buffer.length} bytes)`)
}
