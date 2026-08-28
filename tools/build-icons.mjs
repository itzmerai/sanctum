/**
 * Builds the installer icon set from the brand artwork.
 *
 * Deliberately separate from `gen-icons.mjs`, which draws a simplified
 * arch-and-keyhole geometrically and stays dependency-free. This one starts
 * from the finished artwork instead, and is only worth running at sizes where
 * that artwork survives.
 *
 * It does not: the vault door, its rivets and the woven S turn to noise below
 * about 48px. So the two live side by side — the drawn silhouette owns the
 * small sizes, the artwork owns the large ones — which is how icon families
 * normally work rather than a compromise.
 *
 * sharp is resolved from the site workspace rather than added to the app's
 * dependency tree - the app ships no image library and has no reason to.
 *
 *   node tools/build-icons.mjs <artwork.png> <outDir>
 */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Node resolves bare specifiers from this file's directory upward, and the app
// has no node_modules of its own worth adding sharp to. Point at the site's.
const require = createRequire(new URL('../site/package.json', import.meta.url))
const sharp = require('sharp')

const [artwork, outDir, simplified] = process.argv.slice(2)
if (!artwork || !outDir) {
  throw new Error('usage: node build-icons.mjs <artwork.png> <outDir> [simplified.svg]')
}
mkdirSync(outDir, { recursive: true })

/** Matches --bg-titlebar, so the icon sits on the app's own ground. */
const GROUND = '#121316'

/**
 * Below this the artwork is replaced by the simplified silhouette.
 *
 * Set to 20 deliberately: the artwork does go soft under about 64px, but it is
 * the brand and showing it is the point, so it owns every size Windows
 * actually displays. Only the 16px entry falls back, where the vault door and
 * the woven S resolve to a single grey square rather than a logo.
 */
const ARTWORK_FLOOR = 20

/**
 * Renders the mark centred on a rounded square.
 *
 * The inset keeps the arch clear of the corner radius. Windows crops nothing,
 * but a mark flush to the edge reads as cramped next to icons that breathe.
 */
async function tile(source, size, { transparent = false } = {}) {
  const inset = Math.round(size * 0.14)
  const mark = await sharp(source)
    .resize(size - inset * 2, size - inset * 2, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer()

  const radius = Math.round(size * 0.22)
  const rounded = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${GROUND}"/></svg>`,
  )

  const base = transparent
    ? sharp({
        create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
    : sharp(rounded)

  return base
    .composite([{ input: mark, left: inset, top: inset }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/**
 * Writes a multi-size .ico.
 *
 * Every entry is a PNG payload, which Windows has accepted since Vista and
 * which keeps this to a header plus the images sharp already produced.
 */
function ico(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(16 * entries.length)
  let offset = header.length + directory.length

  entries.forEach(({ size, data }, index) => {
    const at = index * 16
    // 256 is encoded as 0 in the directory; the field is one byte.
    directory.writeUInt8(size >= 256 ? 0 : size, at)
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1)
    directory.writeUInt8(0, at + 2) // palette
    directory.writeUInt8(0, at + 3) // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(data.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += data.length
  })

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)])
}

// Trim the transparent margin so the mark fills its box rather than floating.
const trimmed = await sharp(artwork).trim().png().toBuffer()

// The simplified silhouette, rendered white to sit on the dark tile. Used for
// every size the artwork cannot survive.
const small = simplified
  ? await sharp(Buffer.from(readFileSync(simplified, 'utf8').replace(/currentColor/g, '#ffffff')), {
      density: 600,
    })
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
  : null

const pngs = {
  '32x32.png': 32,
  '128x128.png': 128,
  '128x128@2x.png': 256,
  'icon.png': 512,
  'Square107x107Logo.png': 107,
  'Square142x142Logo.png': 142,
  'Square150x150Logo.png': 150,
  'Square284x284Logo.png': 284,
  'Square30x30Logo.png': 30,
  'Square44x44Logo.png': 44,
  'Square71x71Logo.png': 71,
  'Square89x89Logo.png': 89,
  'Square310x310Logo.png': 310,
  'StoreLogo.png': 50,
}

/** Picks the source that will actually read at this size. */
function sourceFor(size) {
  return size < ARTWORK_FLOOR && small ? small : trimmed
}

for (const [name, size] of Object.entries(pngs)) {
  writeFileSync(join(outDir, name), await tile(sourceFor(size), size))
}

const icoSizes = [16, 32, 48, 64, 128, 256]
writeFileSync(
  join(outDir, 'icon.ico'),
  ico(
    await Promise.all(
      icoSizes.map(async (size) => ({ size, data: await tile(sourceFor(size), size) })),
    ),
  ),
)

console.log(`wrote ${Object.keys(pngs).length} PNGs and icon.ico to ${outDir}`)
