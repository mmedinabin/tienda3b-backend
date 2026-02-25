import pool from "../../db/pool.js";


export const reporteVentasDetalle = async (req, res) => {
  try {
    const {
      sucursalId,
      periodo,
      fechaInicio,
      fechaFin,
      clienteId,
      productoId,
      marcaId,
      categoriaId,
      estado,
    } = req.query;

    let filtros = [];
    let valores = [];

    /* =====================================================
       HELPER RANGO BOLIVIA → UTC (para created_at)
    ====================================================== */

    const getRangoBolivia = (tipo, fechaInicio, fechaFin) => {
      const ahora = new Date();
      const boliviaNow = new Date(ahora.getTime() - 4 * 60 * 60 * 1000);

      const formatSQLDate = (date) =>
        date.toISOString().slice(0, 19).replace("T", " ");

      let inicioBolivia, finBolivia;

      if (tipo === "HOY") {
        inicioBolivia = new Date(
          boliviaNow.getFullYear(),
          boliviaNow.getMonth(),
          boliviaNow.getDate(),
          0,
          0,
          0,
        );

        finBolivia = new Date(
          boliviaNow.getFullYear(),
          boliviaNow.getMonth(),
          boliviaNow.getDate() + 1,
          0,
          0,
          0,
        );
      }

      if (tipo === "SEMANA") {
        let day = boliviaNow.getDay();
        let diffToMonday = day === 0 ? 6 : day - 1;

        inicioBolivia = new Date(
          boliviaNow.getFullYear(),
          boliviaNow.getMonth(),
          boliviaNow.getDate() - diffToMonday,
          0,
          0,
          0,
        );

        finBolivia = new Date(
          boliviaNow.getFullYear(),
          boliviaNow.getMonth(),
          boliviaNow.getDate() + 1,
          0,
          0,
          0,
        );
      }

      if (tipo === "MES") {
        inicioBolivia = new Date(
          boliviaNow.getFullYear(),
          boliviaNow.getMonth(),
          1,
          0,
          0,
          0,
        );

        finBolivia = new Date(
          boliviaNow.getFullYear(),
          boliviaNow.getMonth() + 1,
          1,
          0,
          0,
          0,
        );
      }

      if (tipo === "RANGO" && fechaInicio && fechaFin) {
        inicioBolivia = new Date(fechaInicio + "T00:00:00");
        finBolivia = new Date(fechaFin + "T23:59:59");
      }

      const inicioUTC = new Date(inicioBolivia.getTime() + 4 * 60 * 60 * 1000);
      const finUTC = new Date(finBolivia.getTime() + 4 * 60 * 60 * 1000);

      return {
        inicioSQL: formatSQLDate(inicioUTC),
        finSQL: formatSQLDate(finUTC),
      };
    };

    /* =====================================================
       SUCURSAL
    ====================================================== */

    if (sucursalId && sucursalId !== "TODAS") {
      filtros.push("v.sucursal_id = ?");
      valores.push(sucursalId);
    }

    /* =====================================================
       PERIODO
    ====================================================== */

    if (periodo && periodo !== "TODO") {
      const { inicioSQL, finSQL } = getRangoBolivia(
        periodo,
        fechaInicio,
        fechaFin,
      );

      filtros.push("v.created_at >= ?");
      filtros.push("v.created_at < ?");
      valores.push(inicioSQL, finSQL);
    }

    /* =====================================================
       FILTROS EXTRA
    ====================================================== */

    if (clienteId) {
      filtros.push("v.cliente_id = ?");
      valores.push(clienteId);
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
      filtros.push("v.estado = ?");
      valores.push(estado);
    }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    /* =====================================================
       QUERY DETALLE (INCLUYE ANULADAS)
    ====================================================== */

    const query = `
      SELECT 
          v.id AS venta_id,
          v.codigo,
          v.created_at AS fecha_venta,
          v.total,
          v.tipo_pago,
          v.estado,

          v.sucursal_id,
          s.codigo_sucursal,

          v.cliente_id,
          IFNULL(c.nombre, 'SIN CLIENTE') AS cliente,

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
          d.precio_unitario,
          d.precio_subtotal AS subtotal

      FROM ventas v
      JOIN sucursales s ON s.id = v.sucursal_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      JOIN venta_detalle d ON d.venta_id = v.id
      JOIN productos pr ON pr.id = d.producto_id
      LEFT JOIN marcas m ON m.id = pr.marca_id
      LEFT JOIN categorias cat ON cat.id = pr.categoria_id

      ${where}

      ORDER BY v.created_at DESC, v.codigo DESC
    `;

    const [data] = await pool.query(query, valores);

    /* =====================================================
       CONVERTIR FECHA A HORA BOLIVIA PARA RESPUESTA
    ====================================================== */

    data.forEach((row) => {
      const fechaUTC = new Date(row.fecha_venta);
      const fechaBolivia = new Date(fechaUTC.getTime() - 4 * 60 * 60 * 1000);
      row.fecha_venta = fechaBolivia;
    });

    /* =====================================================
       RESUMEN (SIN EXCLUIR EN LISTA)
    ====================================================== */

    const whereResumen = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    const [resumenData] = await pool.query(
      `
  SELECT 
    IFNULL(SUM(v.total),0) AS total_general,
    IFNULL(SUM(CASE WHEN v.estado = 'ANULADA' THEN v.total ELSE 0 END),0) AS total_anulado,
    IFNULL(SUM(CASE WHEN v.estado != 'ANULADA' THEN v.total ELSE 0 END),0) AS total_neto
  FROM ventas v
  ${whereResumen}
  `,
      valores,
    );

    const totalGeneral = resumenData[0].total_general;
    const totalAnulado = resumenData[0].total_anulado;
    const totalNeto = resumenData[0].total_neto;

    /* =====================================================
       RESPONSE
    ====================================================== */

    res.json({
      detalle: data,
      resumen: {
        totalGeneral,
        totalAnulado,
        totalNeto,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error generando reporte de ventas" });
  }
};
