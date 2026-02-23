import pool from "../../db/pool.js";
import { generarDocumentoPDF } from "../../services/documento.service.js";
import { getUTCDateTime } from "../../utils/date.js";

export const crearCompraaa = async (req, res) => {
  const sucursalId = req.sucursalActiva;

  /* =====================================================
     1️⃣ VALIDAR SUCURSAL ANTES DE ABRIR CONEXIÓN
  ====================================================== */

  if (sucursalId === null || sucursalId === undefined) {
    return res.status(400).json({
      message:
        "Debe seleccionar una sucursal específica para registrar la compra",
    });
  }

  const {
    proveedor_id,
    fecha,
    tipo_pago,
    abono_inicial,
    actualizar_precio,
    productos,
  } = req.body;

  if (!proveedor_id) {
    return res.status(400).json({
      message: "Proveedor es obligatorio",
    });
  }

  if (!productos || productos.length === 0) {
    return res.status(400).json({
      message: "No hay productos en la compra",
    });
  }

  /* =====================================================
     2️⃣ AHORA SÍ ABRIMOS CONEXIÓN
  ====================================================== */

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    /* =====================================================
       3️⃣ GENERAR CODIGO DESDE SECUENCIA (SIN SALTOS)
    ====================================================== */
    // 1. Obtener datos de la sucursal
    const [[sucursal]] = await conn.query(
      `SELECT codigo_sucursal FROM sucursales WHERE id = ?`,
      [sucursalId],
    );

    if (!sucursal) {
      throw new Error("Sucursal no válida");
    }

    let [[row]] = await conn.query(
      `SELECT ultimo_numero 
   FROM secuencias 
   WHERE tipo = 'COMPRA' AND sucursal_id = ? 
   FOR UPDATE`,
      [sucursalId],
    );

    if (!row) {
      await conn.query(
        `INSERT INTO secuencias (tipo, sucursal_id, ultimo_numero)
     VALUES ('COMPRA', ?, 0)`,
        [sucursalId],
      );

      row = { ultimo_numero: 0 };
    }
    const siguienteNumero = row.ultimo_numero + 1;

    await conn.query(
      `UPDATE secuencias 
   SET ultimo_numero = ? 
   WHERE tipo = 'COMPRA' AND sucursal_id = ?`,
      [siguienteNumero, sucursalId],
    );
    const codigo = `C-${sucursal.codigo_sucursal}-${String(siguienteNumero).padStart(5, "0")}`;

    /* =====================================================
       4️⃣ CALCULAR TOTAL Y SALDO
    ====================================================== */

    const total = productos.reduce(
      (acc, p) => acc + Number(p.cantidad) * Number(p.costo_unitario),
      0,
    );

    if (total <= 0) {
      throw new Error("Total de compra inválido");
    }

    const saldo =
      tipo_pago === "CREDITO" ? total - Number(abono_inicial || 0) : 0;

    /* =====================================================
       5️⃣ INSERTAR COMPRA
    ====================================================== */
    const createdAt = getUTCDateTime();
    const [compraRes] = await conn.query(
      `
  INSERT INTO compras
  (codigo, fecha_compra, proveedor_id, sucursal_id,
   tipo_pago, total, saldo, estado,
   created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
      [
        codigo,
        fecha, // 👈 viene YYYY-MM-DD del front
        Number(proveedor_id),
        Number(sucursalId),
        tipo_pago,
        total,
        saldo,
        tipo_pago === "CONTADO" ? "PAGADA" : "PENDIENTE",
        req.user?.id || null,
        createdAt,
      ],
    );

    const compraId = compraRes.insertId;

    /* =====================================================
       6️⃣ DETALLE + LOTES + STOCK + KARDEX
    ====================================================== */

    for (const p of productos) {
      const cantidad = Number(p.cantidad);
      const costo = Number(p.costo_unitario);
      const subtotal = cantidad * costo;

      if (cantidad <= 0 || costo <= 0) {
        throw new Error("Cantidad o costo inválido en productos");
      }

      const [detalleRes] = await conn.query(
        `
        INSERT INTO compra_detalle
        (compra_id, producto_id,
         cantidad, costo_unitario,
         costo_subtotal)
        VALUES (?, ?, ?, ?, ?)
        `,
        [compraId, Number(p.producto_id), cantidad, costo, subtotal],
      );

      const detalleId = detalleRes.insertId;

      await conn.query(
        `
        INSERT INTO lotes (
          producto_id,
          sucursal_id,
          compra_detalle_id,
          origen,
          fecha_vencimiento,
          costo_unitario,
          cantidad_inicial,
          cantidad_actual
        ) VALUES (?, ?, ?, 'COMPRA', ?, ?, ?, ?)
        `,
        [
          Number(p.producto_id),
          sucursalId,
          detalleId,
          p.fecha_vencimiento || null,
          costo,
          cantidad,
          cantidad,
        ],
      );

      await conn.query(
        `
  INSERT INTO stock
  (producto_id, sucursal_id, cantidad)
  VALUES (?, ?, ?)
  ON DUPLICATE KEY UPDATE
    cantidad = cantidad + VALUES(cantidad),
    updated_at = CURRENT_TIMESTAMP
  `,
        [Number(p.producto_id), sucursalId, cantidad],
      );
      await conn.query(
        `
        INSERT INTO kardex
        (producto_id, sucursal_id,
         tipo, referencia,
         cantidad, costo_unitario, total)
        VALUES (?, ?, 'ENTRADA', ?, ?, ?, ?)
        `,
        [Number(p.producto_id), sucursalId, codigo, cantidad, costo, subtotal],
      );

      // Obtener precio actual
      const [[productoActual]] = await conn.query(
        `SELECT precio_venta FROM productos WHERE id = ?`,
        [Number(p.producto_id)],
      );

      const nuevoPrecio = Number(p.precio_venta);
      const costoUnitario = Number(p.costo_unitario);

      if (nuevoPrecio <= 0) {
        throw new Error("Precio de venta inválido");
      }

      if (nuevoPrecio <= costoUnitario) {
        throw new Error("El precio de venta debe ser mayor al costo");
      }

      // Solo actualizar si cambió
      if (productoActual.precio_venta !== nuevoPrecio) {
        await conn.query(
          `
    UPDATE productos
    SET precio_venta = ?, updated_at = ?
    WHERE id = ?
    `,
          [nuevoPrecio, new Date(), Number(p.producto_id)],
        );
      }
    }

    /* =====================================================
       7️⃣ REGISTRAR ABONO SI ES CREDITO
    ====================================================== */

    if (tipo_pago === "CREDITO" && Number(abono_inicial) > 0) {
      await conn.query(
        `
        INSERT INTO compra_pagos
        (compra_id, monto, fecha)
        VALUES (?, ?, CURDATE())
        `,
        [compraId, Number(abono_inicial)],
      );
    }

    await conn.commit();

    res.status(201).json({
      message: "Compra registrada correctamente",
      codigo,
    });
  } catch (error) {
    await conn.rollback();

    console.error("ERROR CREAR COMPRA:", error);

    res.status(400).json({
      message: error.message || "Error al registrar compra",
    });
  } finally {
    conn.release();
  }
};

export const crearCompra = async (req, res) => {
  const sucursalId = req.sucursalActiva;

  if (sucursalId === null || sucursalId === undefined) {
    return res.status(400).json({
      message:
        "Debe seleccionar una sucursal específica para registrar la compra",
    });
  }

  const {
    proveedor_id,
    fecha, // YYYY-MM-DD
    tipo_pago,
    abono_inicial,
    productos,
  } = req.body;

  if (!proveedor_id) {
    return res.status(400).json({ message: "Proveedor obligatorio" });
  }

  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ message: "Fecha inválida" });
  }

  if (!productos || productos.length === 0) {
    return res.status(400).json({ message: "No hay productos en la compra" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const nowUTC = getUTCDateTime();

    /* ==============================
       1️⃣ GENERAR CÓDIGO
    ============================== */

    const [[sucursal]] = await conn.query(
      `SELECT codigo_sucursal FROM sucursales WHERE id = ?`,
      [sucursalId]
    );

    if (!sucursal) throw new Error("Sucursal inválida");

    let [[row]] = await conn.query(
      `SELECT ultimo_numero 
       FROM secuencias 
       WHERE tipo = 'COMPRA' AND sucursal_id = ?
       FOR UPDATE`,
      [sucursalId]
    );

    if (!row) {
      await conn.query(
        `INSERT INTO secuencias (tipo, sucursal_id, ultimo_numero)
         VALUES ('COMPRA', ?, 0)`,
        [sucursalId]
      );
      row = { ultimo_numero: 0 };
    }

    const siguienteNumero = row.ultimo_numero + 1;

    await conn.query(
      `UPDATE secuencias 
       SET ultimo_numero = ?
       WHERE tipo = 'COMPRA' AND sucursal_id = ?`,
      [siguienteNumero, sucursalId]
    );

    const codigo = `C-${sucursal.codigo_sucursal}-${String(
      siguienteNumero
    ).padStart(5, "0")}`;

    /* ==============================
       2️⃣ CALCULAR TOTAL / SALDO / ESTADO
    ============================== */

    const total = productos.reduce(
      (acc, p) =>
        acc + Number(p.cantidad) * Number(p.costo_unitario),
      0
    );

    if (total <= 0) throw new Error("Total inválido");

    const abono = Number(abono_inicial || 0);

    if (abono < 0) throw new Error("Abono inválido");
    if (abono > total) throw new Error("El abono no puede ser mayor al total");

    let saldo =
      tipo_pago === "CONTADO" ? 0 : total - abono;

    let estado;

    if (saldo <= 0) estado = "PAGADA";
    else if (saldo === total) estado = "PENDIENTE";
    else estado = "PARCIAL";

    /* ==============================
       3️⃣ INSERTAR COMPRA
    ============================== */

    const [compraRes] = await conn.query(
      `INSERT INTO compras
       (codigo, fecha_compra, proveedor_id, sucursal_id,
        tipo_pago, total, saldo, estado,
        created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        codigo,
        fecha,
        proveedor_id,
        sucursalId,
        tipo_pago,
        total,
        saldo,
        estado,
        req.user?.id,
        nowUTC,
      ]
    );

    const compraId = compraRes.insertId;

    /* ==============================
       4️⃣ DETALLE + LOTES + STOCK + KARDEX
    ============================== */

    for (const p of productos) {
      const cantidad = Number(p.cantidad);
      const costo = Number(p.costo_unitario);
      const subtotal = cantidad * costo;

      if (cantidad <= 0 || costo <= 0) {
        throw new Error("Cantidad o costo inválido");
      }

      const [detalleRes] = await conn.query(
        `INSERT INTO compra_detalle
         (compra_id, producto_id, cantidad,
          costo_unitario, costo_subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [compraId, p.producto_id, cantidad, costo, subtotal]
      );

      const detalleId = detalleRes.insertId;

      await conn.query(
        `INSERT INTO lotes
         (producto_id, sucursal_id, compra_detalle_id,
          origen, fecha_vencimiento,
          costo_unitario, cantidad_inicial,
          cantidad_actual, created_at)
         VALUES (?, ?, ?, 'COMPRA', ?, ?, ?, ?, ?)`,
        [
          p.producto_id,
          sucursalId,
          detalleId,
          p.fecha_vencimiento || null,
          costo,
          cantidad,
          cantidad,
          nowUTC,
        ]
      );

      await conn.query(
        `INSERT INTO stock
         (producto_id, sucursal_id, cantidad, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cantidad = cantidad + VALUES(cantidad),
           updated_at = ?`,
        [
          p.producto_id,
          sucursalId,
          cantidad,
          nowUTC,
          nowUTC,
          nowUTC,
        ]
      );

      await conn.query(
        `INSERT INTO kardex
         (producto_id, sucursal_id,
          tipo, referencia,
          cantidad, costo_unitario,
          total, created_at)
         VALUES (?, ?, 'ENTRADA', ?, ?, ?, ?, ?)`,
        [
          p.producto_id,
          sucursalId,
          codigo,
          cantidad,
          costo,
          subtotal,
          nowUTC,
        ]
      );
    }

    /* ==============================
       5️⃣ INSERTAR ABONO SI EXISTE
    ============================== */

    if (tipo_pago === "CREDITO" && abono > 0) {
      await conn.query(
        `INSERT INTO compra_pagos
         (compra_id, monto, fecha,
          created_at, created_by, estado)
         VALUES (?, ?, ?, ?, ?, 'ACTIVO')`,
        [
          compraId,
          abono,
          fecha,
          nowUTC,
          req.user?.id,
        ]
      );
    }

    /* ==============================
       6️⃣ AUDITORÍA
    ============================== */

    await conn.query(
      `INSERT INTO auditoria
       (tabla, registro_id, accion,
        detalle, usuario_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        "compras",
        compraId,
        "INSERT",
        JSON.stringify({
          codigo,
          proveedor_id,
          total,
          saldo,
          estado,
        }),
        req.user?.id,
        nowUTC,
      ]
    );

    await conn.commit();

    res.status(201).json({
      message: "Compra registrada correctamente",
      codigo,
    });
  } catch (error) {
    await conn.rollback();
    res.status(400).json({
      message: error.message || "Error al registrar compra",
    });
  } finally {
    conn.release();
  }
};

export const listarCompras = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        c.id,
        c.codigo,
        c.created_at AS fecha,
        c.tipo_pago,
        c.total,
        c.saldo,
        p.nombre AS proveedor
      FROM compras c
      JOIN proveedores p ON p.id = c.proveedor_id
      ORDER BY c.id DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error("ERROR LISTAR COMPRAS:", error);
    res.status(500).json({ message: "Error al listar compras" });
  }
};

export const descargarCompraPDF = async (req, res) => {
  const { id } = req.params;

  const esMovil = req.headers["user-agent"]?.includes("Mobile");

  try {
    const { buffer, codigo } = await generarDocumentoPDF("COMPRA", id);

    res.setHeader("Content-Type", "application/pdf");

    if (esMovil) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=compra-${codigo}.pdf`,
      );
    } else {
      res.setHeader(
        "Content-Disposition",
        `inline; filename=compra-${codigo}.pdf`,
      );
    }

    res.send(buffer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
