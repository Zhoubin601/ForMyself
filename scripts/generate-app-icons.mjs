import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'newicon.png')
const metadata = await sharp(source).metadata()

if (!metadata.width || !metadata.height || metadata.width !== metadata.height || metadata.width < 1024) {
  throw new Error('newicon.png 必须是至少 1024×1024 的正方形图片')
}

const pixel = await sharp(source)
  .extract({ left: 0, top: 0, width: 1, height: 1 })
  .removeAlpha()
  .raw()
  .toBuffer()
const background = { r: pixel[0], g: pixel[1], b: pixel[2], alpha: 1 }

const ensureParent = async destination => mkdir(path.dirname(destination), { recursive: true })

const writeSquare = async (destination, size, format = 'png') => {
  await ensureParent(destination)
  let pipeline = sharp(source).resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  pipeline = format === 'webp' ? pipeline.webp({ quality: 95 }) : pipeline.png({ compressionLevel: 9 })
  await pipeline.toFile(destination)
}

const writeRound = async (destination, size) => {
  await ensureParent(destination)
  const image = await sharp(source)
    .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  )
  await sharp(image)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toFile(destination)
}

const writeBackground = async (destination, size) => {
  await ensureParent(destination)
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .png({ compressionLevel: 9 })
    .toFile(destination)
}

await writeSquare(path.join(root, 'assets', 'icon.png'), 1024)
await writeSquare(path.join(root, 'android', 'icon.png'), 1024)
await writeSquare(path.join(root, 'public', 'icon.png'), 192)

const densities = {
  mdpi: { legacy: 48, adaptive: 108 },
  hdpi: { legacy: 72, adaptive: 162 },
  xhdpi: { legacy: 96, adaptive: 216 },
  xxhdpi: { legacy: 144, adaptive: 324 },
  xxxhdpi: { legacy: 192, adaptive: 432 }
}

for (const [density, sizes] of Object.entries(densities)) {
  const dir = path.join(root, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`)
  await writeSquare(path.join(dir, 'ic_launcher.png'), sizes.legacy)
  await writeRound(path.join(dir, 'ic_launcher_round.png'), sizes.legacy)
  await writeSquare(path.join(dir, 'ic_launcher_foreground.png'), sizes.adaptive)
  await writeBackground(path.join(dir, 'ic_launcher_background.png'), sizes.adaptive)
}

for (const size of [48, 72, 96, 128, 192, 256, 512]) {
  await writeSquare(path.join(root, 'icons', `icon-${size}.webp`), size, 'webp')
}

console.log(`已从 ${metadata.width}×${metadata.height} 原图生成应用图标，背景色 rgb(${background.r}, ${background.g}, ${background.b})`)
