import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs'
import path from 'path'

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
//app.use('/uploads', express.static('uploads'))


/* ===============================
   🔥 INICIALIZAR STORAGE PERSISTENTE
================================ */

const uploadDir = '/data/uploads/productos'
const defaultImagePath = path.join(uploadDir, 'default.png')

// Crear carpeta si no existe
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

// Copiar default.png si no existe en volume
if (!fs.existsSync(defaultImagePath)) {
  const source = path.join(process.cwd(), 'assets/default.png')

  if (fs.existsSync(source)) {
    fs.copyFileSync(source, defaultImagePath)
    console.log('✅ default.png copiado al volume')
  } else {
    console.log('⚠ No se encontró assets/default.png')
  }
}






app.use('/uploads', express.static('/data/uploads'))

// app.get('/', (req, res) => {
//   res.json({ message: 'API Minimarket POS funcionando 🚀' });
// });

app.use((err, req, res, next) => {
  console.error("🔥 ERROR GLOBAL:", err);

  res.status(500).json({
    message: err.message,
    code: err.code,
    errno: err.errno,
    sqlMessage: err.sqlMessage,
  });
});


export default app;
