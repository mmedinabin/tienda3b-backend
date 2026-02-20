import pool from '../../db/pool.js';

export const listarCiudades = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, nombre, codigo
    FROM ciudades
    WHERE estado = 1
    ORDER BY nombre
  `);
  res.json(rows);
};

export const crearCiudad = async (req, res) => {
  const { nombre, codigo } = req.body;

  await pool.query(
    `INSERT INTO ciudades (nombre, codigo)
     VALUES (?, ?)`,
    [nombre, codigo.toUpperCase()]
  );

  res.status(201).json({ message: 'Ciudad creada' });
};
