import pool from "../../db/pool.js";
import bcrypt from "bcryptjs";

export const listarUsuarios = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT 
      u.id,
      u.username,
      u.email,
      u.nombre,
      u.estado,
      r.nombre AS rol,
      u.sucursal_id,
      s.codigo_sucursal,
      s.nombre AS sucursal_nombre,
      c.nombre AS ciudad
    FROM usuarios u
    INNER JOIN roles r ON r.id = u.rol_id
    LEFT JOIN sucursales s ON s.id = u.sucursal_id
    LEFT JOIN ciudades c ON c.id = s.ciudad_id
    ORDER BY u.id DESC
  `);

  res.json(rows);
};

export const obtenerUsuario = async (req, res) => {
  const [rows] = await pool.query(
    `
    SELECT id, username, email, nombre, rol_id, 
           sucursal_id, estado
    FROM usuarios 
    WHERE id = ?
    `,
    [req.params.id],
  )

  res.json(rows[0])
}

export const crearUsuario = async (req, res, next) => {
  try {
    const { username, email, password, nombre, rol_id, sucursal_id } = req.body;

    const [[rol]] = await pool.query(
      `SELECT nombre FROM roles WHERE id = ?`,
      [rol_id]
    );

    if (!rol) {
      return res.status(400).json({ message: 'Rol inválido' });
    }

    const esAdmin = rol.nombre === 'ADMIN';

    if (!esAdmin && !sucursal_id) {
      return res.status(400).json({
        message: 'Debe asignar una sucursal a este usuario'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    await pool.query(`
      INSERT INTO usuarios (username, email, password, nombre, rol_id, sucursal_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      username,
      email,
      hash,
      nombre,
      rol_id,
      esAdmin ? (sucursal_id || null) : sucursal_id
    ]);

    res.status(201).json({ message: 'Usuario creado' });

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Username o Email ya existe' });
    }
    next(error);
  }
};


export const actualizarUsuario = async (req, res) => {
  const { nombre, rol_id, estado, sucursal_id } = req.body;

  await pool.query(
    `
    UPDATE usuarios 
    SET nombre=?, rol_id=?, estado=?, sucursal_id=?
    WHERE id=?
    `,
    [nombre, rol_id, estado, sucursal_id || null, req.params.id],
  );

  res.json({ message: "Usuario actualizado" });
};

export const eliminarUsuario = async (req, res) => {
  await pool.query(`UPDATE usuarios SET estado=0 WHERE id=?`, [req.params.id]);
  res.json({ message: "Usuario desactivado" });
};
