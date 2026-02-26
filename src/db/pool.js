import mysql from 'mysql2/promise';

//LOCAL + BD LOCAL
// const pool = mysql.createPool({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD || '',
//   database: process.env.DB_NAME,
//   waitForConnections: true,
//   connectionLimit: 10,
// });
// export default pool;

//LOCAL + BD NUBE
// const pool = mysql.createPool({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   port: Number(process.env.DB_PORT),
//   waitForConnections: true,
//   connectionLimit: 10,
// });

// export default pool;


//para nube
// import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
  waitForConnections: true,
  connectionLimit: 10,
});

export default pool;