import pool from '../../db/pool.js';

export const listarMarcas = async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM marcas WHERE estado = 1 ORDER BY nombre"
  );
  res.json(rows);
};

export const crearMarca = async (req, res) => {
  const { nombre } = req.body;

  const [result] = await pool.query(
    "INSERT INTO marcas (nombre) VALUES (?)",
    [nombre]
  );

  res.status(201).json({
    id: result.insertId,
    nombre
  });
};
