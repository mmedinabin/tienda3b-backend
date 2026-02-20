import './config/env.js';
import app from './app.js';
import routes from './routes.js';
import 'dotenv/config';


const PORT = process.env.PORT || 5000;
routes(app);

app.listen(PORT, () => {
  console.log(`✅ API corriendo en http://localhost:${PORT}`);
});
