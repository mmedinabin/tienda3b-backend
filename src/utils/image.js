import sharp from 'sharp'
import fs from 'fs'
import path from 'path'

export const guardarImagenProducto = async (buffer) => {
  const filename = `prod_${Date.now()}.png`
  const outputPath = path.join('uploads/productos', filename)

  await sharp(buffer)
    .resize(300, 300)
    .png({ quality: 80 })
    .toFile(outputPath)

  return filename
}
