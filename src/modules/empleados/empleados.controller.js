import pool from '../../db/pool.js'

export const crearEmpleado = async (req, res, next) => {
  try {
    const {
      nombres,
      apellidos,
      ci_doc,
      sueldo,
      telf_cel,
      sucursal_id,
      usuario_id,
      en_planilla,
      estado,
    } = req.body

    // 🔒 Validaciones básicas
    if (!nombres || !apellidos || !ci_doc || !sucursal_id) {
      return res.status(400).json({
        message: 'Datos obligatorios faltantes',
      })
    }

    // Validar usuario si viene
    if (usuario_id) {
      const [[usuario]] = await pool.query(
        `SELECT id FROM usuarios WHERE id = ? AND estado = 1`,
        [usuario_id]
      )

      if (!usuario) {
        return res.status(400).json({
          message: 'Usuario no válido',
        })
      }
    }

    await pool.query(
      `
      INSERT INTO empleados (
        usuario_id,
        sucursal_id,
        nombres,
        apellidos,
        ci_doc,
        sueldo,
        telf_cel,
        en_planilla,
        estado
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        usuario_id || null,
        sucursal_id,
        nombres,
        apellidos,
        ci_doc,
        sueldo || null,
        telf_cel || null,
        en_planilla ?? 1,
        estado ?? 1,
      ]
    )

    res.status(201).json({
      message: 'Empleado registrado correctamente',
    })
  } catch (error) {
    next(error)
  }
}

export const listarUsuariosDisponibles = async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.email, u.nombre
      FROM usuarios u
      LEFT JOIN empleados e ON e.usuario_id = u.id
      WHERE e.id IS NULL
        AND u.estado = 1
    `)

    res.json(rows)
  } catch (error) {
    next(error)
  }
}

// export const listarEmpleados = async (req, res, next) => {
//   try {
//     const [rows] = await pool.query(`
//       SELECT
//         e.id,
//         e.nombres,
//         e.apellidos,
//         e.ci_doc,
//         e.telf_cel,
//         e.sueldo,
//         e.en_planilla,
//         e.estado,
//         s.nombre AS sucursal,
//         u.email AS usuario
//       FROM empleados e
//       JOIN sucursales s ON s.id = e.sucursal_id
//       LEFT JOIN usuarios u ON u.id = e.usuario_id
//       ORDER BY e.created_at DESC
//     `)

//     res.json(rows)
//   } catch (error) {
//     next(error)
//   }
// }

// export const listarEmpleados = async (req, res, next) => {
//   try {
//     const [rows] = await pool.query(`
//       SELECT
//         e.id,
//         e.nombres,
//         e.apellidos,
//         e.ci_doc,
//         e.telf_cel,
//         e.sueldo,
//         e.en_planilla,
//         e.estado,
//         s.nombre AS sucursal,
//         u.email AS usuario

//       FROM empleados e
//       INNER JOIN sucursales s ON s.id = e.sucursal_id
//       LEFT JOIN usuarios u ON u.id = e.usuario_id

//       ORDER BY e.created_at DESC
//     `)

//     res.json(rows)
//   } catch (error) {
//     next(error)
//   }
// }

export const listarEmpleados = async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        e.id,
        e.nombres,
        e.apellidos,
        e.ci_doc,
        e.telf_cel,
        e.sueldo,
        e.en_planilla,
        e.estado,

        s.nombre AS sucursal_nombre,
        s.codigo_sucursal,
        c.nombre AS ciudad,

        u.email AS usuario

      FROM empleados e
      INNER JOIN sucursales s ON s.id = e.sucursal_id
      INNER JOIN ciudades c ON c.id = s.ciudad_id
      LEFT JOIN usuarios u ON u.id = e.usuario_id

      ORDER BY e.created_at DESC
    `)

    res.json(rows)
  } catch (error) {
    next(error)
  }
}


export const cambiarEstadoEmpleado = async (req, res, next) => {
  try {
    const { id } = req.params

    await pool.query(`
      UPDATE empleados
      SET estado = IF(estado = 1, 0, 1),
          updated_at = NOW()
      WHERE id = ?
    `, [id])

    res.json({ message: 'Estado actualizado' })
  } catch (error) {
    next(error)
  }
}

export const obtenerEmpleado = async (req, res, next) => {
  try {
    const { id } = req.params

    const [[empleado]] = await pool.query(`
      SELECT
        e.id,
        e.nombres,
        e.apellidos,
        e.ci_doc,
        e.telf_cel,
        e.sueldo,
        e.sucursal_id,
        e.usuario_id,
        e.en_planilla,
        e.estado
      FROM empleados e
      WHERE e.id = ?
    `, [id])

    if (!empleado) {
      return res.status(404).json({ message: 'Empleado no encontrado' })
    }

    res.json(empleado)
  } catch (error) {
    next(error)
  }
}

export const actualizarEmpleado = async (req, res, next) => {
  try {
    const { id } = req.params
    const {
      nombres,
      apellidos,
      ci_doc,
      telf_cel,
      sueldo,
      sucursal_id,
      usuario_id,
      en_planilla,
      estado,
    } = req.body

    await pool.query(`
      UPDATE empleados SET
        nombres = ?,
        apellidos = ?,
        ci_doc = ?,
        telf_cel = ?,
        sueldo = ?,
        sucursal_id = ?,
        usuario_id = ?,
        en_planilla = ?,
        estado = ?,
        updated_at = NOW()
      WHERE id = ?
    `, [
      nombres,
      apellidos,
      ci_doc,
      telf_cel,
      sueldo,
      sucursal_id,
      usuario_id,
      en_planilla,
      estado,
      id,
    ])

    res.json({ message: 'Empleado actualizado' })
  } catch (error) {
    next(error)
  }
}
