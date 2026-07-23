import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'assets', 'icon.png')
const destination = path.join(
  root,
  'android',
  'app',
  'src',
  'main',
  'res',
  'drawable-nodpi',
  'widget_app_icon.png'
)
const size = 128

await mkdir(path.dirname(destination), { recursive: true })

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

console.log(`已生成圆形小组件图标：${destination}`)
