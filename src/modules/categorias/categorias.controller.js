import pool from '../../db/pool.js';

export const listarCategorias = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, nombre, estado
    FROM categorias
    ORDER BY nombre
  `);
  res.json(rows);
};

export const listarCategoriasActivas = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, nombre
    FROM categorias
    WHERE estado = 1
    ORDER BY nombre
  `);
  return res.json(rows) // 🔴 ESTE return ES IMPORTANTE
  //res.json(rows);
};

export const crearCategoria = async (req, res) => {
  const { nombre } = req.body;

  await pool.query(
    `INSERT INTO categorias (nombre) VALUES (?)`,
    [nombre]
  );

  res.status(201).json({ message: 'Categoría creada' });
};

export const actualizarCategoria = async (req, res) => {
  const { id } = req.params;
  const { nombre, estado } = req.body;

  await pool.query(
    `UPDATE categorias SET nombre=?, estado=? WHERE id=?`,
    [nombre, estado ?? 1, id]
  );

  res.json({ message: 'Categoría actualizada' });
};
