/**
 * Generates the Sanctum brand mark (R2: a keyhole set in an arch/doorway) as
 * PNGs + a multi-size .ico, with no image dependencies.
 *
 * Geometry is defined in normalised [0,1] space and rasterised with 4x4
 * supersampling, so every size is rendered from the same source shape rather
 * than downscaled from one bitmap.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2]
if (!OUT) throw new Error('usage: node gen-icons.mjs <outDir>')
mkdirSync(OUT, { recursive: true })

// --- palette -----------------------------------------------------------------
const BG = [0x12, 0x13, 0x16, 0xff] // near-black, matches --bg-titlebar
const FG = [0xff, 0xff, 0xff, 0xff] // white arch

// --- geometry (normalised) ---------------------------------------------------
const ARCH = { left: 0.20, right: 0.80, bottom: 0.855, shoulder: 0.505 }
const ARCH_R = (ARCH.right - ARCH.left) / 2
const ARCH_CX = (ARCH.left + ARCH.right) / 2

const KEY = { cx: 0.5, cy: 0.435, r: 0.108 }
const STEM = { top: 0.435, bottom: 0.715, halfTop: 0.042, halfBottom: 0.082 }

const SQUIRCLE_R = 0.22 // background rounded-square corner radius

/** Rounded-square (icon plate) coverage test. */
function inPlate(x, y) {
  const r = SQUIRCLE_R
  const dx = Math.max(r - x, 0, x - (1 - r))
  const dy = Math.max(r - y, 0, y - (1 - r))
  return dx * dx + dy * dy <= r * r
}

/** Solid arch: semicircular head over a rectangular body. */
function inArch(x, y) {
  if (x < ARCH.left || x > ARCH.right || y > ARCH.bottom) return false
  if (y >= ARCH.shoulder) return true
  const dx = x - ARCH_CX
  const dy = y - ARCH.shoulder
  return dx * dx + dy * dy <= ARCH_R * ARCH_R
}

/** Keyhole: bore circle plus a tapered stem, subtracted from the arch. */
function inKeyhole(x, y) {
  const dx = x - KEY.cx
  const dy = y - KEY.cy
  if (dx * dx + dy * dy <= KEY.r * KEY.r) return true
  if (y < STEM.top || y > STEM.bottom) return false
  const t = (y - STEM.top) / (STEM.bottom - STEM.top)
  const half = STEM.halfTop + (STEM.halfBottom - STEM.halfTop) * t
  return Math.abs(dx) <= half
}

const SS = 4 // supersampling factor per axis

function render(size) {
  const px = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let plate = 0
      let arch = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxi + (sx + 0.5) / SS) / size
          const y = (py + (sy + 0.5) / SS) / size
          if (inPlate(x, y)) plate++
          if (inArch(x, y) && !inKeyhole(x, y)) arch++
        }
      }
      const n = SS * SS
      const plateA = plate / n
      const archA = arch / n
      const o = (py * size + pxi) * 4
      // arch over plate, plate over transparency
      const a = plateA
      if (a === 0) continue
      for (let c = 0; c < 3; c++) {
        px[o + c] = Math.round(BG[c] * (1 - archA) + FG[c] * archA)
      }
      px[o + 3] = Math.round(255 * a)
    }
  }
  return px
}

// --- PNG encoder -------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- ICO container (Vista+ PNG entries) --------------------------------------
function encodeIco(entries) {
  const dir = Buffer.alloc(6 + entries.length * 16)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2) // type: icon
  dir.writeUInt16LE(entries.length, 4)

  let offset = dir.length
  entries.forEach((e, i) => {
    const o = 6 + i * 16
    dir[o] = e.size >= 256 ? 0 : e.size
    dir[o + 1] = e.size >= 256 ? 0 : e.size
    dir[o + 2] = 0
    dir[o + 3] = 0
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(e.png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += e.png.length
  })

  return Buffer.concat([dir, ...entries.map((e) => e.png)])
}

// --- emit --------------------------------------------------------------------
const png = (size) => encodePng(size, render(size))

const files = {
  '32x32.png': png(32),
  '128x128.png': png(128),
  '128x128@2x.png': png(256),
  'icon.png': png(512),
  'Square30x30Logo.png': png(30),
  'Square44x44Logo.png': png(44),
  'Square71x71Logo.png': png(71),
  'Square89x89Logo.png': png(89),
  'Square107x107Logo.png': png(107),
  'Square142x142Logo.png': png(142),
  'Square150x150Logo.png': png(150),
  'Square284x284Logo.png': png(284),
  'Square310x310Logo.png': png(310),
  'StoreLogo.png': png(50),
}

for (const [name, buf] of Object.entries(files)) {
  writeFileSync(join(OUT, name), buf)
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
writeFileSync(
  join(OUT, 'icon.ico'),
  encodeIco(icoSizes.map((size) => ({ size, png: png(size) }))),
)

// Vector source for in-app use (sidebar wordmark, lock screen).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Sanctum">
  <path fill="currentColor" fill-rule="evenodd" d="
    M ${ARCH.left * 100} ${ARCH.bottom * 100}
    L ${ARCH.left * 100} ${ARCH.shoulder * 100}
    A ${ARCH_R * 100} ${ARCH_R * 100} 0 0 1 ${ARCH.right * 100} ${ARCH.shoulder * 100}
    L ${ARCH.right * 100} ${ARCH.bottom * 100}
    Z
    M ${KEY.cx * 100} ${(KEY.cy - KEY.r) * 100}
    A ${KEY.r * 100} ${KEY.r * 100} 0 1 0 ${KEY.cx * 100} ${(KEY.cy + KEY.r) * 100}
    A ${KEY.r * 100} ${KEY.r * 100} 0 1 0 ${KEY.cx * 100} ${(KEY.cy - KEY.r) * 100}
    Z
    M ${(KEY.cx - STEM.halfTop) * 100} ${STEM.top * 100}
    L ${(KEY.cx + STEM.halfTop) * 100} ${STEM.top * 100}
    L ${(KEY.cx + STEM.halfBottom) * 100} ${STEM.bottom * 100}
    L ${(KEY.cx - STEM.halfBottom) * 100} ${STEM.bottom * 100}
    Z" />
</svg>
`
writeFileSync(join(OUT, 'sanctum-mark.svg'), svg)

console.log(`wrote ${Object.keys(files).length + 2} files to ${OUT}`)
