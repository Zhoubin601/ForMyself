export const MAX_AVATAR_FILE_BYTES = 5 * 1024 * 1024
export const AVATAR_OUTPUT_SIZE = 512

export function getSquareImageCrop(width, height) {
  const safeWidth = Math.max(1, Number(width) || 1)
  const safeHeight = Math.max(1, Number(height) || 1)
  const size = Math.min(safeWidth, safeHeight)
  return {
    sx: (safeWidth - size) / 2,
    sy: (safeHeight - size) / 2,
    size
  }
}

const readAsDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error('AVATAR_READ_FAILED'))
  reader.readAsDataURL(file)
})

const loadImage = source => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('AVATAR_DECODE_FAILED'))
  image.src = source
})

export async function prepareCompanionAvatar(file, {
  outputSize = AVATAR_OUTPUT_SIZE,
  quality = 0.88
} = {}) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('AVATAR_INVALID_TYPE')
  if (Number(file.size) > MAX_AVATAR_FILE_BYTES) throw new Error('AVATAR_FILE_TOO_LARGE')

  const source = await readAsDataUrl(file)
  const image = await loadImage(source)
  const crop = getSquareImageCrop(image.naturalWidth || image.width, image.naturalHeight || image.height)
  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const context = canvas.getContext('2d')
  if (!context) throw new Error('AVATAR_CANVAS_UNAVAILABLE')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, outputSize, outputSize)
  context.drawImage(
    image,
    crop.sx,
    crop.sy,
    crop.size,
    crop.size,
    0,
    0,
    outputSize,
    outputSize
  )
  return canvas.toDataURL('image/jpeg', quality)
}
