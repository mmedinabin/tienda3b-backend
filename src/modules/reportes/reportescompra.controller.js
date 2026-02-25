import pool from "../../db/pool.js";

export const reporteComprasDetalleee = async (req, res) => {
  try {
    const {
      sucursalId,
      periodo,
      fechaInicio,
      fechaFin,
      proveedorId,
      productoId,
      marcaId,
      categoriaId,
      estado,
    } = req.query;

    let filtros = [];
    let valores = [];

    /* =====================================================
       FECHA HOY BOLIVIA (solo DATE)
    ====================================================== */

    const hoyBolivia = new Date(new Date().getTime() - 4 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10); // YYYY-MM-DD

    /* =====================================================
       SUCURSAL
    ====================================================== */

    if (sucursalId && sucursalId !== "TODAS") {
      filtros.push("c.sucursal_id = ?");
      valores.push(sucursalId);
    }

    /* =====================================================
       PERIODO (DATE SIMPLE)
    ====================================================== */

    if (periodo === "HOY") {
      filtros.push("c.fecha_compra = ?");
      valores.push(hoyBolivia);
    }

    if (periodo === "SEMANA") {
      filtros.push("YEARWEEK(c.fecha_compra, 1) = YEARWEEK(?, 1)");
      valores.push(hoyBolivia);
    }

    if (periodo === "MES") {
      filtros.push("YEAR(c.fecha_compra) = YEAR(?)");
      filtros.push("MONTH(c.fecha_compra) = MONTH(?)");
      valores.push(hoyBolivia, hoyBolivia);
    }

    if (periodo === "RANGO" && fechaInicio && fechaFin) {
      filtros.push("c.fecha_compra BETWEEN ? AND ?");
      valores.push(fechaInicio, fechaFin);
    }

    /* =====================================================
       FILTROS EXTRA
    ====================================================== */

    if (proveedorId) {
      filtros.push("c.proveedor_id = ?");
      valores.push(proveedorId);
    }

    if (productoId) {
      filtros.push("d.producto_id = ?");
      valores.push(productoId);
    }

    if (marcaId) {
      filtros.push("pr.marca_id = ?");
      valores.push(marcaId);
    }

    if (categoriaId) {
      filtros.push("pr.categoria_id = ?");
      valores.push(categoriaId);
    }

    if (estado) {
      filtros.push("c.estado = ?");
      valores.push(estado);
    }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    /* =====================================================
       QUERY
    ====================================================== */

    const query = `
      SELECT 
          c.id AS compra_id,
          c.codigo,
          c.fecha_compra,
          c.tipo_pago,
          c.estado,

          c.proveedor_id,
          p.nombre AS proveedor,

          c.sucursal_id,
          CONCAT(s.codigo_sucursal, ' - ', ci.nombre) AS sucursal,

          d.producto_id,
          pr.nombre AS producto_nombre,
          pr.descripcion,
          pr.categoria_id,
          pr.marca_id,

          IFNULL(cat.nombre, '-') AS categoria_nombre,
          IFNULL(m.nombre, '-') AS marca,

          TRIM(
            CONCAT(
              pr.nombre,
              IF(
                pr.descripcion IS NOT NULL AND pr.descripcion != '',
                CONCAT(' ', pr.descripcion),
                ''
              )
            )
          ) AS producto_label,

          d.cantidad,
          d.costo_unitario,
          d.costo_subtotal

      FROM compras c
      JOIN proveedores p ON p.id = c.proveedor_id
      JOIN sucursales s ON s.id = c.sucursal_id
      JOIN ciudades ci ON ci.id = s.ciudad_id
      JOIN compra_detalle d ON d.compra_id = c.id
      JOIN productos pr ON pr.id = d.producto_id
      LEFT JOIN marcas m ON m.id = pr.marca_id
      LEFT JOIN categorias cat ON cat.id = pr.categoria_id

      ${where}

      ORDER BY c.fecha_compra DESC, c.codigo DESC
    `;

    const [data] = await pool.query(query, valores);

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error generando reporte de compras" });
  }
};

export const reporteComprasDetalle = async (req, res) => {
  try {
    const {
      sucursalId,
      periodo,
      fechaInicio,
      fechaFin,
      proveedorId,
      productoId,
      marcaId,
      categoriaId,
      estado,
    } = req.query;

    let filtros = [];
    let valores = [];

    /* =====================================================
       FECHA HOY BOLIVIA (solo DATE)
    ====================================================== */

    const hoyBolivia = new Date(new Date().getTime() - 4 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    /* =====================================================
       SUCURSAL
    ====================================================== */

    if (sucursalId && sucursalId !== "TODAS") {
      filtros.push("c.sucursal_id = ?");
      valores.push(sucursalId);
    }

    /* =====================================================
       PERIODO
    ====================================================== */

    if (periodo === "HOY") {
      filtros.push("c.fecha_compra = ?");
      valores.push(hoyBolivia);
    }

    if (periodo === "SEMANA") {
      filtros.push("YEARWEEK(c.fecha_compra, 1) = YEARWEEK(?, 1)");
      valores.push(hoyBolivia);
    }

    if (periodo === "MES") {
      filtros.push("YEAR(c.fecha_compra) = YEAR(?)");
      filtros.push("MONTH(c.fecha_compra) = MONTH(?)");
      valores.push(hoyBolivia, hoyBolivia);
    }

    if (periodo === "RANGO" && fechaInicio && fechaFin) {
      filtros.push("c.fecha_compra BETWEEN ? AND ?");
      valores.push(fechaInicio, fechaFin);
    }

    /* =====================================================
       FILTROS EXTRA
    ====================================================== */

    if (proveedorId) {
      filtros.push("c.proveedor_id = ?");
      valores.push(proveedorId);
    }

    if (estado) {
      filtros.push("c.estado = ?");
      valores.push(estado);
    }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    /* =====================================================
       QUERY DETALLE (con join)
    ====================================================== */

    const query = `
      SELECT 
          c.id AS compra_id,
          c.codigo,
          c.fecha_compra,
          c.tipo_pago,
          c.estado,

          c.proveedor_id,
          p.nombre AS proveedor,

          c.sucursal_id,
          CONCAT(s.codigo_sucursal, ' - ', ci.nombre) AS sucursal,

          d.producto_id,
          pr.nombre AS producto_nombre,
          pr.descripcion,
          pr.categoria_id,
          pr.marca_id,

          IFNULL(cat.nombre, '-') AS categoria_nombre,
          IFNULL(m.nombre, '-') AS marca,

          TRIM(
            CONCAT(
              pr.nombre,
              IF(
                pr.descripcion IS NOT NULL AND pr.descripcion != '',
                CONCAT(' ', pr.descripcion),
                ''
              )
            )
          ) AS producto_label,

          d.cantidad,
          d.costo_unitario,
          d.costo_subtotal

      FROM compras c
      JOIN proveedores p ON p.id = c.proveedor_id
      JOIN sucursales s ON s.id = c.sucursal_id
      JOIN ciudades ci ON ci.id = s.ciudad_id
      JOIN compra_detalle d ON d.compra_id = c.id
      JOIN productos pr ON pr.id = d.producto_id
      LEFT JOIN marcas m ON m.id = pr.marca_id
      LEFT JOIN categorias cat ON cat.id = pr.categoria_id

      ${where}

      ORDER BY c.fecha_compra DESC, c.codigo DESC
    `;

    const [data] = await pool.query(query, valores);

    /* =====================================================
       RESUMEN (SIN JOIN A DETALLE)
    ====================================================== */

    const resumenQuery = `
  SELECT 
    IFNULL(SUM(c.total),0) AS total_general,

    IFNULL(
      SUM(CASE 
            WHEN c.estado = 'ANULADA' 
            THEN c.total 
            ELSE 0 
          END),0
    ) AS total_anulado,

    IFNULL(
      SUM(CASE 
            WHEN c.estado != 'ANULADA' 
            THEN c.total 
            ELSE 0 
          END),0
    ) AS total_neto,

    IFNULL(
      SUM(CASE 
            WHEN c.estado != 'ANULADA' 
            THEN c.saldo 
            ELSE 0 
          END),0
    ) AS saldo_pendiente

  FROM compras c
  ${where}
`;

    const [resumenData] = await pool.query(resumenQuery, valores);

    const totalGeneral = resumenData[0].total_general;
    const totalAnulado = resumenData[0].total_anulado;
    const totalNeto = resumenData[0].total_neto;
    const saldoPendiente = resumenData[0].saldo_pendiente;

    res.json({
      detalle: data,
      resumen: {
        totalGeneral,
        totalAnulado,
        totalNeto,
        saldoPendiente,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error generando reporte de compras" });
  }
};
