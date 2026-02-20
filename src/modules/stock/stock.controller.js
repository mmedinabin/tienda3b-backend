import pool from "../../db/pool.js";

export const listarStock = async (req, res) => {
  try {
    const { sucursal_id } = req.query;

    if (!sucursal_id) {
      return res.status(400).json({
        message: "Sucursal requerida",
      });
    }

    const [rows] = await pool.query(
      `
      SELECT 
        p.id,
        p.codigo,

        CONCAT(
          IFNULL(m.nombre, ''),
          IF(m.nombre IS NOT NULL, ' ', ''),
          p.nombre,
          IF(p.descripcion IS NOT NULL AND p.descripcion != '', CONCAT(' ', p.descripcion), '')
        ) AS nombre,

        s.cantidad,

        -- SOLO COSTO TOTAL REAL DESDE LOTES
        IFNULL(SUM(l.cantidad_actual * l.costo_unitario), 0) AS costo_total,

        p.precio_venta,

        (p.precio_venta * s.cantidad) AS total_venta_realizable

      FROM stock s
      JOIN productos p ON p.id = s.producto_id
      LEFT JOIN marcas m ON m.id = p.marca_id
      LEFT JOIN lotes l 
        ON l.producto_id = s.producto_id
        AND l.sucursal_id = s.sucursal_id
        AND l.cantidad_actual > 0

      WHERE s.sucursal_id = ?
      GROUP BY p.id, s.cantidad
      ORDER BY p.nombre
      `,
      [sucursal_id]
    );

    res.json(rows);
  } catch (error) {
    console.error("ERROR LISTAR STOCK:", error);
    res.status(500).json({ message: "Error al listar stock" });
  }
};
