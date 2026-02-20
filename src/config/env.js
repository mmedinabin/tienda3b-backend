import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔥 FORZAMOS backend/.env sin depender del cwd
dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});