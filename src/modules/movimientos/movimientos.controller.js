import pool from "../../db/pool.js";
import { getUTCDateTime } from "../../utils/date.js";

export const cargaInicialMovimiento = async (req, res) => {
  const sucursalId = req.sucursalActiva;

  if (sucursalId === null || sucursalId === undefined) {
    return res.status(400).json({
      message:
        "Debe seleccionar una sucursal específica para ingresar el stock inicial",
    });
  }

  const { detalles } = req.body;

  if (!detalles || !Array.isArray(detalles) || detalles.length === 0) {
    return res.status(400).json({
      message: "Debe enviar al menos un producto",
    });
  }

  const nowUTC = getUTCDateTime();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    /* =========================
       1️⃣ SECUENCIA MOVIMIENTO
    ========================= */

    let [[seqMov]] = await conn.query(
      `
      SELECT ultimo_numero
      FROM secuencias
      WHERE tipo = 'MOVIMIENTO' AND sucursal_id = 0
      FOR UPDATE
      `,
    );

    if (!seqMov) {
      await conn.query(
        `INSERT INTO secuencias (tipo, sucursal_id, ultimo_numero)
         VALUES ('MOVIMIENTO', 0, 0)`,
      );
      seqMov = { ultimo_numero: 0 };
    }

    const siguienteMov = seqMov.ultimo_numero + 1;

    await conn.query(
      `
      UPDATE secuencias
      SET ultimo_numero = ?
      WHERE tipo = 'MOVIMIENTO' AND sucursal_id = 0
      `,
      [siguienteMov],
    );

    const codigoMovimiento = `MI-${String(siguienteMov).padStart(4, "0")}`;

    /* =========================
       2️⃣ CREAR MOVIMIENTO (CABECERA)
    ========================= */

    const [movRes] = await conn.query(
      `
      INSERT INTO movimientos
      (tipo_movimiento, codigo, sucursal_destino, motivo, created_by, created_at)
      VALUES ('ENTRADA_INICIAL', ?, ?, 'STOCK INICIAL', ?, ?)
      `,
      [codigoMovimiento, sucursalId, req.user?.id || null, nowUTC],
    );

    const movimientoId = movRes.insertId;

    /* =========================
       3️⃣ PROCESAR CADA PRODUCTO
    ========================= */

    for (const item of detalles) {
      const {
        producto_id,
        cantidad,
        costo_unitario,
        precio_venta,
        fecha_vencimiento,
      } = item;

      const cantidadNum = Number(cantidad);
      const costoNum = Number(costo_unitario);
      const precioNum = Number(precio_venta);

      /* VALIDACIONES */
      if (!producto_id) throw new Error("Producto es obligatorio");

      if (!Number.isInteger(cantidadNum) || cantidadNum <= 0)
        throw new Error("Cantidad inválida");

      if (costoNum <= 0) throw new Error("Costo unitario inválido");

      if (precioNum <= 0 || precioNum <= costoNum)
        throw new Error("El precio de venta debe ser mayor al costo unitario");

      /* 🔒 VALIDAR MÁXIMO 3 CARGAS */
      const [[countRow]] = await conn.query(
        `
        SELECT COUNT(*) as total
        FROM movimientos m
        JOIN movimientos_detalle md ON md.movimiento_id = m.id
        WHERE md.producto_id = ?
        AND m.sucursal_destino = ?
        AND m.tipo_movimiento = 'ENTRADA_INICIAL'
        `,
        [producto_id, sucursalId],
      );

      if (countRow.total >= 3)
        throw new Error(
          "Ya se realizaron 3 cargas iniciales para este producto. Use Ajuste.",
        );

      /* 1️⃣ CREAR LOTE */
      const fechaVencimientoPlano = fecha_vencimiento
        ? new Date(fecha_vencimiento).toISOString().split("T")[0]
        : null;

      const [loteRes] = await conn.query(
        `
        INSERT INTO lotes (
          producto_id,
          sucursal_id,
          origen,
          fecha_vencimiento,
          costo_unitario,
          cantidad_inicial,
          cantidad_actual,
          created_at
        )
        VALUES (?, ?, 'ENTRADA_INICIAL', ?, ?, ?, ?, ?)
        `,
        [
          producto_id,
          sucursalId,
          fechaVencimientoPlano,
          costoNum,
          cantidadNum,
          cantidadNum,
          nowUTC,
        ],
      );

      const loteId = loteRes.insertId;

      /* 2️⃣ INSERTAR DETALLE */
      await conn.query(
        `
        INSERT INTO movimientos_detalle
        (movimiento_id, producto_id, lote_id, cantidad, costo_unitario)
        VALUES (?, ?, ?, ?, ?)
        `,
        [movimientoId, producto_id, loteId, cantidadNum, costoNum],
      );

      /* 3️⃣ ACTUALIZAR STOCK */
      await conn.query(
        `
        INSERT INTO stock (producto_id, sucursal_id, cantidad, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          cantidad = cantidad + VALUES(cantidad),
          updated_at = VALUES(updated_at)
        `,
        [producto_id, sucursalId, cantidadNum, nowUTC, nowUTC],
      );

      /* 4️⃣ INSERTAR KARDEX */
      const totalMovimiento = Number((cantidadNum * costoNum).toFixed(4));

      const [[ultimoSaldo]] = await conn.query(
        `
        SELECT saldo_cantidad, saldo_total
        FROM kardex
        WHERE producto_id = ?
        AND sucursal_id = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [producto_id, sucursalId],
      );

      const saldoCantidadAnterior = ultimoSaldo?.saldo_cantidad || 0;
      const saldoTotalAnterior = ultimoSaldo?.saldo_total || 0;

      const nuevoSaldoCantidad = saldoCantidadAnterior + cantidadNum;

      const nuevoSaldoTotal = saldoTotalAnterior + totalMovimiento;

      await conn.query(
        `
        INSERT INTO kardex
        (producto_id, sucursal_id, tipo, referencia,
         cantidad, costo_unitario, total,
         saldo_cantidad, saldo_total,
         created_at)
        VALUES (?, ?, 'ENTRADA', ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          producto_id,
          sucursalId,
          codigoMovimiento,
          cantidadNum,
          costoNum,
          totalMovimiento,
          nuevoSaldoCantidad,
          nuevoSaldoTotal,
          nowUTC,
        ],
      );

      /* 5️⃣ ACTUALIZAR PRECIO VENTA */
      await conn.query(`UPDATE productos SET precio_venta = ? WHERE id = ?`, [
        precioNum,
        producto_id,
      ]);
    }

    await conn.commit();

    return res.status(201).json({
      message: "Carga inicial registrada correctamente",
      codigo_movimiento: codigoMovimiento,
    });
  } catch (error) {
    await conn.rollback();
    console.error("ERROR CARGA INICIAL:", error);

    return res.status(400).json({
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
    });
  } finally {
    conn.release();
  }
};

export const listarMovimientoooos = async (req, res) => {
  const { tipo_movimiento, fecha_inicio, fecha_fin } = req.query;
  const sucursalId = req.sucursalActiva;

  try {
    let query = `
      SELECT 
        m.id,
        m.codigo,
        m.tipo_movimiento,
        m.estado,
        m.created_at,
        m.motivo,
        m.motivo_anulacion,

        CONCAT(s.codigo_sucursal, ' - ', c.nombre) AS label_sucursal,
        u.username AS creado_por,

        COUNT(md.id) AS total_items,
        SUM(md.cantidad) AS total_cantidad,
MAX(md.cantidad) AS cantidad_unica,

        MAX(
          TRIM(
            CONCAT(
              SUBSTRING_INDEX(p.nombre, ' ', 1),
              IF(ma.nombre IS NOT NULL AND ma.nombre != '', 
                 CONCAT(' ', ma.nombre), 
                 ''
              ),
              IF(
                LENGTH(p.nombre) > LENGTH(SUBSTRING_INDEX(p.nombre, ' ', 1)),
                CONCAT(
                  ' ',
                  SUBSTRING(
                    p.nombre,
                    LENGTH(SUBSTRING_INDEX(p.nombre, ' ', 1)) + 2
                  )
                ),
                ''
              ),
              IF(p.descripcion IS NOT NULL AND p.descripcion != '',
                 CONCAT(' - ', p.descripcion),
                 ''
              )
            )
          )
        ) AS producto_unico

      FROM movimientos m
      LEFT JOIN movimientos_detalle md ON md.movimiento_id = m.id
      LEFT JOIN productos p ON md.producto_id = p.id
      LEFT JOIN marcas ma ON p.marca_id = ma.id
      LEFT JOIN sucursales s ON m.sucursal_destino = s.id
      LEFT JOIN ciudades c ON s.ciudad_id = c.id
      LEFT JOIN usuarios u ON m.created_by = u.id
      WHERE 1=1
    `;

    const params = [];

    if (sucursalId) {
      query += ` AND m.sucursal_destino = ?`;
      params.push(sucursalId);
    }

    if (tipo_movimiento) {
      query += ` AND m.tipo_movimiento = ?`;
      params.push(tipo_movimiento);
    }

    if (fecha_inicio && fecha_fin) {
      query += ` AND DATE(m.created_at) BETWEEN ? AND ?`;
      params.push(fecha_inicio, fecha_fin);
    }

    query += `
      GROUP BY m.id
      ORDER BY m.id DESC
    `;

    const [rows] = await pool.query(query, params);

    return res.json({
      total: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("ERROR LISTAR MOVIMIENTOS:", error);
    return res.status(500).json({
      message: "Error al listar movimientos",
    });
  }
};
export const listarMovimientos = async (req, res) => {
  const { tipo_movimiento, fecha_inicio, fecha_fin } = req.query;
  const sucursalId = req.sucursalActiva;

  try {
    let query = `
      SELECT 
        m.id,
        m.codigo,
        m.tipo_movimiento,
        m.estado,
        m.created_at,
        m.motivo,
        m.motivo_anulacion,

        CONCAT(s.codigo_sucursal, ' - ', c.nombre) AS label_sucursal,
        u.username AS creado_por,

        COUNT(md.id) AS total_items,
        COALESCE(SUM(md.cantidad), 0) AS total_cantidad,

        CASE 
          WHEN COUNT(md.id) = 1 
          THEN MAX(md.cantidad)
          ELSE NULL
        END AS cantidad_unica,
        CASE 
  WHEN COUNT(md.id) = 1 
  THEN MAX(md.costo_unitario)
  ELSE NULL
END AS costo_unitario_unico,

        MAX(
          TRIM(
            CONCAT(
              SUBSTRING_INDEX(p.nombre, ' ', 1),
              IF(ma.nombre IS NOT NULL AND ma.nombre != '', 
                 CONCAT(' ', ma.nombre), 
                 ''
              ),
              IF(
                LENGTH(p.nombre) > LENGTH(SUBSTRING_INDEX(p.nombre, ' ', 1)),
                CONCAT(
                  ' ',
                  SUBSTRING(
                    p.nombre,
                    LENGTH(SUBSTRING_INDEX(p.nombre, ' ', 1)) + 2
                  )
                ),
                ''
              ),
              IF(p.descripcion IS NOT NULL AND p.descripcion != '',
                 CONCAT(' - ', p.descripcion),
                 ''
              )
            )
          )
        ) AS producto_unico

      FROM movimientos m
      LEFT JOIN movimientos_detalle md ON md.movimiento_id = m.id
      LEFT JOIN productos p ON md.producto_id = p.id
      LEFT JOIN marcas ma ON p.marca_id = ma.id
      LEFT JOIN sucursales s ON m.sucursal_destino = s.id
      LEFT JOIN ciudades c ON s.ciudad_id = c.id
      LEFT JOIN usuarios u ON m.created_by = u.id
      WHERE 1=1
    `;

    const params = [];

    if (sucursalId) {
      query += ` AND m.sucursal_destino = ?`;
      params.push(sucursalId);
    }

    if (tipo_movimiento) {
      query += ` AND m.tipo_movimiento = ?`;
      params.push(tipo_movimiento);
    }

    if (fecha_inicio && fecha_fin) {
      query += ` AND DATE(m.created_at) BETWEEN ? AND ?`;
      params.push(fecha_inicio, fecha_fin);
    }

    query += `
      GROUP BY m.id
      ORDER BY m.id DESC
    `;

    const [rows] = await pool.query(query, params);

    return res.json({
      total: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("ERROR LISTAR MOVIMIENTOS:", error);
    return res.status(500).json({
      message: "Error al listar movimientos",
    });
  }
};

export const obtenerMovimientoPorId = async (req, res) => {
  const { id } = req.params;

  try {
    // ================= CABECERA =================
    const [[movimiento]] = await pool.query(
      `
      SELECT 
        m.*,
        CONCAT(s.codigo_sucursal, ' - ', c.nombre) AS label_sucursal,
        u.username AS creado_por
      FROM movimientos m
      LEFT JOIN sucursales s ON m.sucursal_destino = s.id
      LEFT JOIN ciudades c ON s.ciudad_id = c.id
      LEFT JOIN usuarios u ON m.created_by = u.id
      WHERE m.id = ?
      `,
      [id],
    );

    if (!movimiento) {
      return res.status(404).json({ message: "Movimiento no encontrado" });
    }

    // ================= DETALLE =================
    const [detalles] = await pool.query(
      `
      SELECT 
        md.id,
        md.cantidad,
        md.costo_unitario,
        md.subtotal,

        TRIM(
          CONCAT(
            SUBSTRING_INDEX(p.nombre, ' ', 1),
            IF(ma.nombre IS NOT NULL AND ma.nombre != '', 
               CONCAT(' ', ma.nombre), 
               ''
            ),
            IF(
              LENGTH(p.nombre) > LENGTH(SUBSTRING_INDEX(p.nombre, ' ', 1)),
              CONCAT(
                ' ',
                SUBSTRING(
                  p.nombre,
                  LENGTH(SUBSTRING_INDEX(p.nombre, ' ', 1)) + 2
                )
              ),
              ''
            ),
            IF(p.descripcion IS NOT NULL AND p.descripcion != '',
               CONCAT(' - ', p.descripcion),
               ''
            )
          )
        ) AS label_producto

      FROM movimientos_detalle md
      JOIN productos p ON md.producto_id = p.id
      LEFT JOIN marcas ma ON p.marca_id = ma.id
      WHERE md.movimiento_id = ?
      `,
      [id],
    );

    return res.json({
      movimiento,
      detalles,
    });
  } catch (error) {
    console.error("ERROR OBTENER MOVIMIENTO:", error);
    return res.status(500).json({
      message: "Error al obtener movimiento",
    });
  }
};

// catch (error) {
//     console.error("ERROR OBTENER MOVIMIENTO:", error);
//     return res.status(500).json({
//       message: "Error al obtener movimiento",
//     });
//   }

export const anularMovimiento = async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body;

  const usuarioId = req.user?.id || null;
  const sucursalId = req.sucursalActiva;
  const nowUTC = getUTCDateTime();

  if (sucursalId === null || sucursalId === undefined) {
    return res.status(400).json({
      message: "Debe seleccionar una sucursal específica para anular la venta",
    });
  }
  if (!usuarioId) {
    return res.status(401).json({
      message: "Usuario no autenticado",
    });
  }

  if (!motivo || motivo.trim() === "") {
    return res.status(400).json({
      message: "Debe ingresar un motivo de anulación",
    });
  }

  if (!id) {
    return res.status(400).json({ message: "ID inválido" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    /* =========================
       1️⃣ OBTENER MOVIMIENTO
    ========================= */

    const [[movimiento]] = await conn.query(
      `
      SELECT *
      FROM movimientos
      WHERE id = ?
      FOR UPDATE
      `,
      [id],
    );

    if (!movimiento) {
      await conn.rollback();
      return res.status(404).json({ message: "Movimiento no encontrado" });
    }

    if (movimiento.estado === "ANULADO") {
      await conn.rollback();
      return res.status(400).json({ message: "Movimiento ya anulado" });
    }

    if (movimiento.sucursal_destino !== sucursalId) {
      await conn.rollback();
      return res.status(403).json({ message: "Sucursal inválida" });
    }

    /* =========================
       2️⃣ OBTENER DETALLES
    ========================= */

    const [detalles] = await conn.query(
      `
      SELECT *
      FROM movimientos_detalle
      WHERE movimiento_id = ?
      `,
      [id],
    );

    /* =========================
       3️⃣ REVERTIR CADA DETALLE
    ========================= */

    for (const detalle of detalles) {
      const { producto_id, cantidad, costo_unitario, lote_id } = detalle;

      // 🔹 Restar stock
      await conn.query(
        `
        UPDATE stock
        SET cantidad = cantidad - ?
        WHERE producto_id = ?
        AND sucursal_id = ?
        `,
        [cantidad, producto_id, sucursalId],
      );

      // 🔹 Restar lote
      await conn.query(
        `
        UPDATE lotes
        SET cantidad_actual = cantidad_actual - ?
        WHERE id = ?
        `,
        [cantidad, lote_id],
      );

      /* =========================
         4️⃣ INSERTAR KARDEX REVERSIÓN
      ========================= */

      const totalMovimiento = cantidad * costo_unitario;

      const [[ultimoSaldo]] = await conn.query(
        `
        SELECT saldo_cantidad, saldo_total
        FROM kardex
        WHERE producto_id = ?
        AND sucursal_id = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [producto_id, sucursalId],
      );

      const saldoCantidadAnterior = ultimoSaldo?.saldo_cantidad || 0;
      const saldoTotalAnterior = ultimoSaldo?.saldo_total || 0;

      const nuevoSaldoCantidad = saldoCantidadAnterior - cantidad;
      const nuevoSaldoTotal = saldoTotalAnterior - totalMovimiento;

      await conn.query(
        `
        INSERT INTO kardex
        (producto_id, sucursal_id, tipo, referencia,
         cantidad, costo_unitario, total,
         saldo_cantidad, saldo_total,
         created_at)
        VALUES (?, ?, 'SALIDA', ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          producto_id,
          sucursalId,
          `ANULACION ${movimiento.codigo}`,
          cantidad,
          costo_unitario,
          totalMovimiento,
          nuevoSaldoCantidad,
          nuevoSaldoTotal,
          nowUTC,
        ],
      );
    }

    /* =========================
       5️⃣ MARCAR COMO ANULADO
    ========================= */

    await conn.query(
      `
  UPDATE movimientos
  SET estado = 'ANULADO',
      anulada_at = ?,
      anulada_by = ?,
      motivo_anulacion = ?
  WHERE id = ?
  `,
      [nowUTC, usuarioId, motivo, id],
    );

    await conn.commit();

    return res.json({
      message: "Movimiento anulado correctamente",
    });
  } catch (error) {
    await conn.rollback();
    console.error("ERROR ANULAR MOVIMIENTO:", error);

    return res.status(500).json({
      message: "Error al anular movimiento",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};
