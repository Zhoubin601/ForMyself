const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export function backgroundCropRect(width, height, aspect, zoom = 1, x = 50, y = 50) {
  if (![width, height, aspect].every(value => Number.isFinite(value) && value > 0)) throw new Error('INVALID_IMAGE_SIZE')
  const scale = Number.isFinite(zoom) ? clamp(zoom, 1, 3) : 1
  const cropWidth = Math.min(width, height * aspect) / scale
  const cropHeight = cropWidth / aspect
  return {
    x: (width - cropWidth) * clamp(x, 0, 100) / 100,
    y: (height - cropHeight) * clamp(y, 0, 100) / 100,
    width: cropWidth,
    height: cropHeight
  }
}

export function cropOutputSize(rect, maxEdge = 2560) {
  const scale = Math.min(1, maxEdge / Math.max(rect.width, rect.height))
  return { width: Math.max(1, Math.round(rect.width * scale)), height: Math.max(1, Math.round(rect.height * scale)) }
}

export function backgroundCropAroundPoint(width, height, aspect, zoom, anchor, center) {
  const scale = clamp(zoom, 1, 3)
  const rect = backgroundCropRect(width, height, aspect, scale)
  return {
    zoom: scale,
    x: width - rect.width > 1e-7 ? clamp((anchor.x - center.x * rect.width) / (width - rect.width) * 100, 0, 100) : 50,
    y: height - rect.height > 1e-7 ? clamp((anchor.y - center.y * rect.height) / (height - rect.height) * 100, 0, 100) : 50
  }
}
