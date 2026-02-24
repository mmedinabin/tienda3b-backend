import pool from '../../db/pool.js'

export const obtenerDashboardd = async (req, res) => {
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

export const obtenerDashboard = async (req, res) => {
  try {
    const sucursalId = req.sucursalActiva;

    const esGlobal = sucursalId == null;

    const filtroSucursal = esGlobal ? '' : 'AND sucursal_id = ?';
    const paramsSucursal = esGlobal ? [] : [sucursalId];

    /* ===============================
       RANGO HOY BOLIVIA (UTC-4)
       00:00 Bolivia = 04:00 UTC
    =============================== */

    const rangoHoyInicio = 'CURDATE() + INTERVAL 4 HOUR';
    const rangoHoyFin = 'CURDATE() + INTERVAL 1 DAY + INTERVAL 4 HOUR';

    /* ===============================
       RANGO MES ACTUAL (UTC-4)
    =============================== */

    const rangoMesInicio =
      "DATE_FORMAT(CURDATE(), '%Y-%m-01') + INTERVAL 4 HOUR";

    const rangoMesFin =
      "DATE_FORMAT(CURDATE() + INTERVAL 1 MONTH, '%Y-%m-01') + INTERVAL 4 HOUR";

    /* ===============================
       RANGO MES ANTERIOR (UTC-4)
    =============================== */

    const rangoMesAnteriorInicio =
      "DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01') + INTERVAL 4 HOUR";

    const rangoMesAnteriorFin =
      "DATE_FORMAT(CURDATE(), '%Y-%m-01') + INTERVAL 4 HOUR";

    /* ===============================
       VENTA HOY
    =============================== */

    const [[ventaHoyRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(total),0) AS venta_hoy
      FROM ventas
      WHERE estado = 'ACTIVA'
      ${filtroSucursal}
      AND created_at >= ${rangoHoyInicio}
      AND created_at < ${rangoHoyFin}
      `,
      paramsSucursal
    );

    /* ===============================
       UTILIDAD HOY
    =============================== */

    const [[utilidadHoyRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(utilidad_total),0) AS utilidad_hoy
      FROM ventas
      WHERE estado = 'ACTIVA'
      ${filtroSucursal}
      AND created_at >= ${rangoHoyInicio}
      AND created_at < ${rangoHoyFin}
      `,
      paramsSucursal
    );

    /* ===============================
       VENTA MES ACTUAL
    =============================== */

    const [[ventaMesRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(total),0) AS venta_mes
      FROM ventas
      WHERE estado = 'ACTIVA'
      ${filtroSucursal}
      AND created_at >= ${rangoMesInicio}
      AND created_at < ${rangoMesFin}
      `,
      paramsSucursal
    );

    /* ===============================
       VENTA MES ANTERIOR
    =============================== */

    const [[ventaMesAnteriorRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(total),0) AS venta_mes_anterior
      FROM ventas
      WHERE estado = 'ACTIVA'
      ${filtroSucursal}
      AND created_at >= ${rangoMesAnteriorInicio}
      AND created_at < ${rangoMesAnteriorFin}
      `,
      paramsSucursal
    );

    /* ===============================
       INVENTARIO VALORIZADO
    =============================== */

    const [[inventarioRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(l.cantidad_actual * l.costo_unitario),0) AS inventario_valorizado
      FROM lotes l
      ${esGlobal ? '' : 'WHERE l.sucursal_id = ? AND l.cantidad_actual > 0'}
      `,
      esGlobal ? [] : [sucursalId]
    );

    /* ===============================
       TICKETS HOY
    =============================== */

    const [[ticketsHoyRes]] = await pool.query(
      `
      SELECT COUNT(*) AS tickets_hoy
      FROM ventas
      WHERE estado = 'ACTIVA'
      ${filtroSucursal}
      AND created_at >= ${rangoHoyInicio}
      AND created_at < ${rangoHoyFin}
      `,
      paramsSucursal
    );

    /* ===============================
       PRODUCTOS BAJO STOCK
    =============================== */

    const [[bajoStockRes]] = await pool.query(
      `
      SELECT COUNT(*) AS productos_bajo_stock
      FROM stock
      ${esGlobal ? '' : 'WHERE sucursal_id = ?'}
      ${esGlobal ? 'WHERE' : 'AND'} cantidad <= 5
      `,
      esGlobal ? [] : [sucursalId]
    );

    /* ===============================
       PRODUCTOS ACTIVOS
    =============================== */

    const [[productosRes]] = await pool.query(`
      SELECT COUNT(*) AS total_productos
      FROM productos
      WHERE estado = 1
    `);

    /* ===============================
       TOTAL UNIDADES
    =============================== */

    const [[unidadesRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(cantidad),0) AS total_unidades
      FROM stock
      ${esGlobal ? '' : 'WHERE sucursal_id = ?'}
      `,
      esGlobal ? [] : [sucursalId]
    );

    /* ===============================
       CRECIMIENTO %
    =============================== */

    const ventaMesActual = ventaMesRes.venta_mes;
    const ventaMesAnterior = ventaMesAnteriorRes.venta_mes_anterior;

    let crecimientoMes = 0;

    if (ventaMesAnterior > 0) {
      crecimientoMes =
        ((ventaMesActual - ventaMesAnterior) / ventaMesAnterior) * 100;
    } else if (ventaMesActual > 0) {
      crecimientoMes = 100;
    }

    /* ===============================
       RESPONSE
    =============================== */

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
    });

  } catch (error) {
    console.error('Error dashboard:', error);
    res.status(500).json({ message: 'Error obteniendo dashboard' });
  }
};