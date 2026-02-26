import 'dotenv/config'
import app from "./app.js";
import routes from "./routes.js";

const PORT = process.env.PORT || 5000;
routes(app);

console.log("===== DEBUG TIMEZONE =====");
console.log("Date now:", new Date().toString());
console.log("ISO:", new Date().toISOString());
console.log(
  "Timezone detectada:",
  Intl.DateTimeFormat().resolvedOptions().timeZone,
);
console.log("Offset minutos:", new Date().getTimezoneOffset());
console.log("==========================");

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ API corriendo en:${PORT}`);
});
