import pool from "../../db/pool.js";

export const listarProveedores = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, nombre, nit, ci, contacto, telefono, email, estado
    FROM proveedores
    ORDER BY nombre
  `);
  res.json(rows);
};

// export const crearProveedor = async (req, res) => {
//   const {
//     nombre,
//     nit,
//     ci,
//     contacto,
//     telefono,
//     email,
//   } = req.body;

//   await pool.query(
//     `INSERT INTO proveedores
//      (nombre, nit, ci, contacto, telefono, email)
//      VALUES (?, ?, ?, ?, ?, ?)`,
//     [nombre, nit, ci, contacto, telefono, email]
//   );

//   res.status(201).json({ message: 'Proveedor creado correctamente' });
// };

export const crearProveedor = async (req, res) => {
  const { nombre, nit, ci, contacto, telefono, email } = req.body;

  const [result] = await pool.query(
    `INSERT INTO proveedores
     (nombre, nit, ci, contacto, telefono, email)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nombre, nit, ci, contacto, telefono, email],
  );

  res.status(201).json({
    message: "Proveedor creado correctamente",
    proveedor: {
      id: result.insertId,
      nombre,
      nit,
      ci,
      contacto,
      telefono,
      email,
    },
  });
};

export const actualizarProveedor = async (req, res) => {
  const { id } = req.params;
  const { nombre, nit, ci, contacto, telefono, email, estado } = req.body;

  await pool.query(
    `UPDATE proveedores SET
      nombre=?,
      nit=?,
      ci=?,
      contacto=?,
      telefono=?,
      email=?,
      estado=?
     WHERE id=?`,
    [nombre, nit, ci, contacto, telefono, email, estado ?? 1, id],
  );

  res.json({ message: "Proveedor actualizado correctamente" });
};
