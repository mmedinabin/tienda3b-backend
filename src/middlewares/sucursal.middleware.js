import pool from '../db/pool.js'

export const sucursalContext = async (req, res, next) => {
  try {

    const headerSucursal = req.headers['x-sucursal-activa']
    const user = req.user

    if (!user) {
      return res.status(401).json({ message: 'Usuario no autenticado' })
    }

    const [[usuario]] = await pool.query(
      `
      SELECT u.rol_id, r.nombre AS rol
      FROM usuarios u
      JOIN roles r ON r.id = u.rol_id
      WHERE u.id = ?
      `,
      [user.id]
    )

    if (!usuario) {
      return res.status(401).json({ message: 'Usuario no válido' })
    }

    const esAdmin = usuario.rol === 'ADMIN'

    // ================= ADMIN =================
    if (esAdmin) {

      if (headerSucursal) {
        req.sucursalActiva = parseInt(headerSucursal)
      } else {
        req.sucursalActiva = null // 🔥 modo global
      }

      return next()
    }

    // ================= NO ADMIN =================
    if (!user.sucursal_id) {
      return res.status(403).json({
        message: 'Usuario sin sucursal asignada'
      })
    }

    req.sucursalActiva = user.sucursal_id
    next()

  } catch (error) {
    next(error)
  }
}
