import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'))

// app.get('/', (req, res) => {
//   res.json({ message: 'API Minimarket POS funcionando 🚀' });
// });

// 🔥 Middleware global de errores
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
