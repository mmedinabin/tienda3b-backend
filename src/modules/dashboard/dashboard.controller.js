import pool from '../../db/pool.js'

export const obtenerDashboard = async (req, res) => {
  try {
    const sucursalId = req.sucursalActiva

    // 🔒 Si está en modo global
    if (!sucursalId) {
      return res.json({
        requiereSeleccionSucursal: true,
      })
    }

    /* ===========================
       VENTA HOY
    ============================ */
    const [[ventaHoyRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(total),0) AS venta_hoy
      FROM ventas
      WHERE sucursal_id = ?
      AND DATE(created_at) = CURDATE()
      `,
      [sucursalId]
    )

    /* ===========================
       UTILIDAD HOY
    ============================ */
    const [[utilidadHoyRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(utilidad_total),0) AS utilidad_hoy
      FROM ventas
      WHERE sucursal_id = ?
      AND DATE(created_at) = CURDATE()
      `,
      [sucursalId]
    )

    /* ===========================
       VENTA MES ACTUAL
    ============================ */
    const [[ventaMesRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(total),0) AS venta_mes
      FROM ventas
      WHERE sucursal_id = ?
      AND YEAR(created_at) = YEAR(CURDATE())
      AND MONTH(created_at) = MONTH(CURDATE())
      `,
      [sucursalId]
    )

    /* ===========================
       VENTA MES ANTERIOR
    ============================ */
    const [[ventaMesAnteriorRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(total),0) AS venta_mes_anterior
      FROM ventas
      WHERE sucursal_id = ?
      AND YEAR(created_at) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
      AND MONTH(created_at) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
      `,
      [sucursalId]
    )

    /* ===========================
       INVENTARIO VALORIZADO
    ============================ */
    const [[inventarioRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(l.cantidad_actual * l.costo_unitario),0) AS inventario_valorizado
      FROM lotes l
      WHERE l.sucursal_id = ?
      AND l.cantidad_actual > 0
      `,
      [sucursalId]
    )

    /* ===========================
       TICKETS HOY
    ============================ */
    const [[ticketsHoyRes]] = await pool.query(
      `
      SELECT COUNT(*) AS tickets_hoy
      FROM ventas
      WHERE sucursal_id = ?
      AND DATE(created_at) = CURDATE()
      `,
      [sucursalId]
    )

    /* ===========================
       PRODUCTOS BAJO STOCK
    ============================ */
    const [[bajoStockRes]] = await pool.query(
      `
      SELECT COUNT(*) AS productos_bajo_stock
      FROM stock
      WHERE sucursal_id = ?
      AND cantidad <= 5
      `,
      [sucursalId]
    )

    /* ===========================
       PRODUCTOS EN CATÁLOGO (SKU)
    ============================ */
    const [[productosRes]] = await pool.query(
      `
      SELECT COUNT(*) AS total_productos
      FROM productos
      WHERE estado = 1
      `
    )

    /* ===========================
       TOTAL PIEZAS FÍSICAS
    ============================ */
    const [[unidadesRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(cantidad),0) AS total_unidades
      FROM stock
      WHERE sucursal_id = ?
      `,
      [sucursalId]
    )

    /* ===========================
       CRECIMIENTO MES %
    ============================ */
    const ventaMesActual = ventaMesRes.venta_mes
    const ventaMesAnterior = ventaMesAnteriorRes.venta_mes_anterior

    let crecimientoMes = 0

    if (ventaMesAnterior > 0) {
      crecimientoMes =
        ((ventaMesActual - ventaMesAnterior) / ventaMesAnterior) * 100
    }

    /* ===========================
       RESPONSE FINAL
    ============================ */
    res.json({
      ventaHoy: ventaHoyRes.venta_hoy,
      utilidadHoy: utilidadHoyRes.utilidad_hoy,
      ventaMes: ventaMesActual,
      crecimientoMes,
      inventarioValorizado: inventarioRes.inventario_valorizado,
      ticketsHoy: ticketsHoyRes.tickets_hoy,
      productosBajoStock: bajoStockRes.productos_bajo_stock,
      totalProductos: productosRes.total_productos,
      totalUnidades: unidadesRes.total_unidades,
    })

  } catch (error) {
    console.error('Error dashboard:', error)
    res.status(500).json({ message: 'Error obteniendo dashboard' })
  }
}
