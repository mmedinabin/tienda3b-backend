import pool from '../../db/pool.js';

export const listarClientes = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, tipo, nombre, documento, telefono, email, direccion, estado
    FROM clientes
    ORDER BY nombre
  `);
  res.json(rows);
};

export const crearCliente = async (req, res) => {
  const {
    tipo,
    nombre,
    documento,
    telefono,
    email,
    direccion,
  } = req.body;

  await pool.query(
    `INSERT INTO clientes
     (tipo, nombre, documento, telefono, email, direccion, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      tipo,
      nombre,
      documento,
      telefono,
      email,
      direccion,
      req.user.id,
    ]
  );

  res.status(201).json({ message: 'Cliente creado correctamente' });
};

export const actualizarCliente = async (req, res) => {
  const { id } = req.params;
  const {
    tipo,
    nombre,
    documento,
    telefono,
    email,
    direccion,
    estado,
  } = req.body;

  await pool.query(
    `UPDATE clientes SET
      tipo=?,
      nombre=?,
      documento=?,
      telefono=?,
      email=?,
      direccion=?,
      estado=?,
      updated_at=NOW()
     WHERE id=?`,
    [
      tipo,
      nombre,
      documento,
      telefono,
      email,
      direccion,
      estado ?? 1,
      id,
    ]
  );

  res.json({ message: 'Cliente actualizado correctamente' });
};
