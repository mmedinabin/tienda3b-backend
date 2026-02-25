import pool from "../../db/pool.js";

export const obtenerDashboard = async (req, res) => {
  try {
    const sucursalId = req.sucursalActiva;
    const esGlobal = sucursalId == null;

    /* =====================================================
       RANGO HOY BOLIVIA (UTC-4 REAL)
    ====================================================== */

    const ahora = new Date();
    const boliviaNow = new Date(ahora.getTime() - 4 * 60 * 60 * 1000);

    const inicioBolivia = new Date(
      boliviaNow.getFullYear(),
      boliviaNow.getMonth(),
      boliviaNow.getDate(),
      0, 0, 0
    );

    const finBolivia = new Date(
      boliviaNow.getFullYear(),
      boliviaNow.getMonth(),
      boliviaNow.getDate() + 1,
      0, 0, 0
    );

    const inicioUTC = new Date(inicioBolivia.getTime() + 4 * 60 * 60 * 1000);
    const finUTC = new Date(finBolivia.getTime() + 4 * 60 * 60 * 1000);

    const formatSQLDate = (date) =>
      date.toISOString().slice(0, 19).replace("T", " ");

    const inicioSQL = formatSQLDate(inicioUTC);
    const finSQL = formatSQLDate(finUTC);

    /* =====================================================
       RANGO SEMANA
    ====================================================== */

    let day = boliviaNow.getDay();
    let diffToMonday = day === 0 ? 6 : day - 1;

    const inicioSemanaBolivia = new Date(
      boliviaNow.getFullYear(),
      boliviaNow.getMonth(),
      boliviaNow.getDate() - diffToMonday,
      0, 0, 0
    );

    const inicioSemanaUTC = new Date(
      inicioSemanaBolivia.getTime() + 4 * 60 * 60 * 1000
    );

    const inicioSemanaSQL = formatSQLDate(inicioSemanaUTC);
    const finSemanaSQL = finSQL;

    /* =====================================================
       RANGO MES ACTUAL
    ====================================================== */

    const inicioMesBolivia = new Date(
      boliviaNow.getFullYear(),
      boliviaNow.getMonth(),
      1, 0, 0, 0
    );

    const finMesBolivia = new Date(
      boliviaNow.getFullYear(),
      boliviaNow.getMonth() + 1,
      1, 0, 0, 0
    );

    const inicioMesUTC = new Date(
      inicioMesBolivia.getTime() + 4 * 60 * 60 * 1000
    );

    const finMesUTC = new Date(
      finMesBolivia.getTime() + 4 * 60 * 60 * 1000
    );

    const inicioMesSQL = formatSQLDate(inicioMesUTC);
    const finMesSQL = formatSQLDate(finMesUTC);

    /* =====================================================
       RANGO MES ANTERIOR
    ====================================================== */

    const inicioMesAnteriorBolivia = new Date(
      boliviaNow.getFullYear(),
      boliviaNow.getMonth() - 1,
      1, 0, 0, 0
    );

    const finMesAnteriorBolivia = new Date(
      boliviaNow.getFullYear(),
      boliviaNow.getMonth(),
      1, 0, 0, 0
    );

    const inicioMesAnteriorUTC = new Date(
      inicioMesAnteriorBolivia.getTime() + 4 * 60 * 60 * 1000
    );

    const finMesAnteriorUTC = new Date(
      finMesAnteriorBolivia.getTime() + 4 * 60 * 60 * 1000
    );

    const inicioMesAnteriorSQL = formatSQLDate(inicioMesAnteriorUTC);
    const finMesAnteriorSQL = formatSQLDate(finMesAnteriorUTC);

    /* =====================================================
       HELPERS GLOBAL / SUCURSAL
    ====================================================== */

    const filtroSucursal = esGlobal ? "" : "AND sucursal_id = ?";
    const buildParams = (extraParams = []) =>
      esGlobal ? [...extraParams] : [sucursalId, ...extraParams];

    /* =====================================================
       VENTAS HOY
    ====================================================== */

    const [[ventaHoyRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(total),0) AS venta_hoy
      FROM ventas
      WHERE estado = 'ACTIVA'
      ${filtroSucursal}
      AND created_at >= ?
      AND created_at < ?
      `,
      buildParams([inicioSQL, finSQL])
    );

    const [[utilidadHoyRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(utilidad_total),0) AS utilidad_hoy
      FROM ventas
      WHERE estado = 'ACTIVA'
      ${filtroSucursal}
      AND created_at >= ?
      AND created_at < ?
      `,
      buildParams([inicioSQL, finSQL])
    );

    const [[ventaSemanaRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(total),0) AS venta_semana
      FROM ventas
      WHERE estado = 'ACTIVA'
      ${filtroSucursal}
      AND created_at >= ?
      AND created_at < ?
      `,
      buildParams([inicioSemanaSQL, finSemanaSQL])
    );

    const [[ventaMesRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(total),0) AS venta_mes
      FROM ventas
      WHERE estado = 'ACTIVA'
      ${filtroSucursal}
      AND created_at >= ?
      AND created_at < ?
      `,
      buildParams([inicioMesSQL, finMesSQL])
    );

    const [[ventaMesAnteriorRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(total),0) AS venta_mes_anterior
      FROM ventas
      WHERE estado = 'ACTIVA'
      ${filtroSucursal}
      AND created_at >= ?
      AND created_at < ?
      `,
      buildParams([inicioMesAnteriorSQL, finMesAnteriorSQL])
    );

    /* =====================================================
       INVENTARIO
    ====================================================== */

    const [[inventarioRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(l.cantidad_actual * l.costo_unitario),0) AS inventario_valorizado
      FROM lotes l
      WHERE l.cantidad_actual > 0
      ${esGlobal ? "" : "AND l.sucursal_id = ?"}
      `,
      esGlobal ? [] : [sucursalId]
    );

    /* =====================================================
       TICKETS HOY
    ====================================================== */

    const [[ticketsHoyRes]] = await pool.query(
      `
      SELECT COUNT(*) AS tickets_hoy
      FROM ventas
      WHERE estado = 'ACTIVA'
      ${filtroSucursal}
      AND created_at >= ?
      AND created_at < ?
      `,
      buildParams([inicioSQL, finSQL])
    );

    /* =====================================================
       BAJO STOCK
    ====================================================== */

    const [[bajoStockRes]] = await pool.query(
      `
      SELECT COUNT(*) AS productos_bajo_stock
      FROM stock
      WHERE cantidad <= 5
      ${esGlobal ? "" : "AND sucursal_id = ?"}
      `,
      esGlobal ? [] : [sucursalId]
    );

    /* =====================================================
       PRODUCTOS
    ====================================================== */

    const [[productosRes]] = await pool.query(`
      SELECT COUNT(*) AS total_productos
      FROM productos
      WHERE estado = 1
    `);

    /* =====================================================
       TOTAL UNIDADES
    ====================================================== */

    const [[unidadesRes]] = await pool.query(
      `
      SELECT IFNULL(SUM(cantidad),0) AS total_unidades
      FROM stock
      ${esGlobal ? "" : "WHERE sucursal_id = ?"}
      `,
      esGlobal ? [] : [sucursalId]
    );

    /* =====================================================
       CRECIMIENTO %
    ====================================================== */

    const ventaMesActual = ventaMesRes.venta_mes;
    const ventaMesAnterior = ventaMesAnteriorRes.venta_mes_anterior;

    let crecimientoMes = 0;

    if (ventaMesAnterior > 0) {
      crecimientoMes =
        ((ventaMesActual - ventaMesAnterior) / ventaMesAnterior) * 100;
    } else if (ventaMesActual > 0) {
      crecimientoMes = 100;
    }

    /* =====================================================
       RESPONSE
    ====================================================== */

    res.json({
      esGlobal,
      ventaHoy: ventaHoyRes.venta_hoy,
      ventaSemana: ventaSemanaRes.venta_semana,
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
    console.error("Error dashboard:", error);
    res.status(500).json({ message: "Error obteniendo dashboard" });
  }
};
