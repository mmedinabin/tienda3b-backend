import './config/env.js';
import app from './app.js';
import routes from './routes.js';
import 'dotenv/config';


const PORT = process.env.PORT || 5000;
routes(app);

app.listen(PORT, '0.0.0.0',() => {
  console.log(`✅ API corriendo en:${PORT}`);
});



// import pool from './db/pool.js';

// (async () => {
//   try {
//     const conn = await pool.getConnection();
//     console.log("✅ Conectado a MySQL Railway");
//     conn.release();
//   } catch (err) {
//     console.error("❌ Error conectando a MySQL:", err.message);
//   }
// })();