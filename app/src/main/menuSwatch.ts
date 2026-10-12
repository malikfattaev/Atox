import { nativeImage, type NativeImage } from 'electron'

/** Размер кружка в пунктах — как у иконок SF Symbols в меню. */
const SWATCH_SIZE = 12

/** Кружок рисуется с удвоенным разрешением для Retina-экранов. */
const SCALE_FACTOR = 2

/** Цветной кружок для пункта меню, например для выбора цвета папки. */
export function createColorSwatch(hex: string): NativeImage {
  const size = SWATCH_SIZE * SCALE_FACTOR
  const [red, green, blue] = parseHexColor(hex)
  const radius = size / 2
  // Битмап в формате BGRA с premultiplied alpha — его ждёт nativeImage.createFromBitmap.
  const bitmap = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Сглаживание края: доля пикселя внутри круга по расстоянию от его центра.
      const distance = Math.hypot(x + 0.5 - radius, y + 0.5 - radius)
      const coverage = Math.min(1, Math.max(0, radius - distance + 0.5))
      const offset = (y * size + x) * 4
      bitmap[offset] = Math.round(blue * coverage)
      bitmap[offset + 1] = Math.round(green * coverage)
      bitmap[offset + 2] = Math.round(red * coverage)
      bitmap[offset + 3] = Math.round(255 * coverage)
    }
  }
  return nativeImage.createFromBitmap(bitmap, {
    width: size,
    height: size,
    scaleFactor: SCALE_FACTOR
  })
}

function parseHexColor(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) {
    throw new Error(`Expected a #RRGGBB color, got ${hex}`)
  }
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)]
}
