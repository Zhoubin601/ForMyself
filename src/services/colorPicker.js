export const clampColorValue = (value, min = 0, max = 100) =>
    Math.min(max, Math.max(min, Number(value) || 0))

export const hsvToHex = (hue, saturation, value) => {
    const h = ((Number(hue) % 360) + 360) % 360
    const s = clampColorValue(saturation) / 100
    const v = clampColorValue(value) / 100
    const chroma = v * s
    const section = h / 60
    const intermediate = chroma * (1 - Math.abs((section % 2) - 1))
    const offset = v - chroma
    let red = 0
    let green = 0
    let blue = 0

    if (section < 1) [red, green, blue] = [chroma, intermediate, 0]
    else if (section < 2) [red, green, blue] = [intermediate, chroma, 0]
    else if (section < 3) [red, green, blue] = [0, chroma, intermediate]
    else if (section < 4) [red, green, blue] = [0, intermediate, chroma]
    else if (section < 5) [red, green, blue] = [intermediate, 0, chroma]
    else [red, green, blue] = [chroma, 0, intermediate]

    const toHex = channel => Math.round((channel + offset) * 255)
      .toString(16)
      .padStart(2, '0')
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
  }

export const hexToHsv = hex => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return null
    const red = parseInt(hex.slice(1, 3), 16) / 255
    const green = parseInt(hex.slice(3, 5), 16) / 255
    const blue = parseInt(hex.slice(5, 7), 16) / 255
    const max = Math.max(red, green, blue)
    const min = Math.min(red, green, blue)
    const delta = max - min
    let hue = 0

    if (delta) {
      if (max === red) hue = 60 * (((green - blue) / delta) % 6)
      else if (max === green) hue = 60 * ((blue - red) / delta + 2)
      else hue = 60 * ((red - green) / delta + 4)
    }

    return {
      hue: Math.round((hue + 360) % 360),
      saturation: Math.round(max ? (delta / max) * 100 : 0),
      value: Math.round(max * 100)
    }
  }

