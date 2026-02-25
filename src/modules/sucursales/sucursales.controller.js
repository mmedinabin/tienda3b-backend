import pool from "../../db/pool.js";

export const listarSucursales = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        s.id,
        s.codigo_sucursal,
        s.numero_sucursal,
        s.nombre,
        s.direccion,
        s.telefono,
        s.estado,
        c.nombre AS ciudad
      FROM sucursales s
      JOIN ciudades c ON c.id = s.ciudad_id
      WHERE s.estado = 1
      ORDER BY c.nombre, s.numero_sucursal
    `);

    res.json(rows);
  } catch (error) {
    console.error("ERROR LISTAR SUCURSALES:", error);
    res.status(500).json({ message: "Error al listar sucursales" });
  }
};

export const crearSucursal = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { ciudad_id, nombre, direccion, telefono } = req.body;

    const [ciudadRows] = await connection.query(
      `SELECT codigo FROM ciudades WHERE id = ? FOR UPDATE`,
      [ciudad_id],
    );

    if (!ciudadRows.length) {
      await connection.rollback();
      return res.status(400).json({ message: "Ciudad no válida" });
    }

    const codigoCiudad = ciudadRows[0].codigo;

    const [rows] = await connection.query(
      `SELECT IFNULL(MAX(numero_sucursal), 0) + 1 AS siguiente
       FROM sucursales
       WHERE ciudad_id = ?
       FOR UPDATE`,
      [ciudad_id],
    );

    const numeroSucursal = rows[0].siguiente;

    const codigoSucursal = `${codigoCiudad}-${numeroSucursal}`;

    await connection.query(
      `INSERT INTO sucursales
       (ciudad_id, numero_sucursal, codigo_sucursal, nombre, direccion, telefono)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        ciudad_id,
        numeroSucursal,
        codigoSucursal,
        nombre,
        direccion,
        telefono ?? null,
      ],
    );

    await connection.commit();

    res.status(201).json({
      message: "Sucursal creada",
      codigo_sucursal: codigoSucursal,
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ message: "Error al crear sucursal" });
  } finally {
    connection.release();
  }
};

export const actualizarSucursal = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, direccion, telefono, estado } = req.body;

    await pool.query(
      `
      UPDATE sucursales
      SET
        nombre = ?,
        direccion = ?,
        telefono = ?,
        estado = ?
      WHERE id = ?
      `,
      [nombre, direccion, telefono ?? null, estado ?? 1, id],
    );

    res.json({ message: "Sucursal actualizada" });
  } catch (error) {
    res.status(500).json({ message: "Error al actualizar sucursal" });
  }
};

export const listarSucursalesActivas = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        s.id,
        s.codigo_sucursal,
        c.nombre AS ciudad
      FROM sucursales s
      JOIN ciudades c ON c.id = s.ciudad_id
      WHERE s.estado = 1
      ORDER BY s.codigo_sucursal
    `)

    res.json(rows)
  } catch (error) {
    res.status(500).json({ message: "Error al listar sucursales" })
  }
}
