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

export default app;
