import pool from "../../db/pool.js";
import { getUTCDateTime } from "../../utils/date.js";
import PDFDocument from "pdfkit";

export const crearVenta = async (req, res) => {
  const sucursalId = req.sucursalActiva;

  if (sucursalId === null || sucursalId === undefined) {
    return res.status(400).json({
      message:
        "Debe seleccionar una sucursal específica para registrar la venta",
    });
  }

  const { cliente_id, tipo_pago, abono_inicial, productos } = req.body;

  if (!productos || productos.length === 0) {
    return res.status(400).json({
      message: "No hay productos en la venta",
    });
  }

  const tiposValidos = ["EFECTIVO", "TRANSFERENCIA", "CREDITO"];
  if (!tiposValidos.includes(tipo_pago)) {
    return res.status(400).json({ message: "Tipo de pago inválido" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const nowUTC = getUTCDateTime();

    /* =====================================================
       1️⃣ GENERAR CÓDIGO
    ====================================================== */

    const [[sucursal]] = await conn.query(
      `SELECT codigo_sucursal FROM sucursales WHERE id = ?`,
      [sucursalId],
    );

    if (!sucursal) throw new Error("Sucursal no válida");

    let [[row]] = await conn.query(
      `SELECT ultimo_numero
       FROM secuencias
       WHERE tipo = 'VENTA'
       AND sucursal_id = ?
       FOR UPDATE`,
      [sucursalId],
    );

    if (!row) {
      await conn.query(
        `INSERT INTO secuencias (tipo, sucursal_id, ultimo_numero)
         VALUES ('VENTA', ?, 0)`,
        [sucursalId],
      );
      row = { ultimo_numero: 0 };
    }

    const siguienteNumero = row.ultimo_numero + 1;

    await conn.query(
      `UPDATE secuencias
       SET ultimo_numero = ?
       WHERE tipo = 'VENTA'
       AND sucursal_id = ?`,
      [siguienteNumero, sucursalId],
    );

    const codigo = `V-${sucursal.codigo_sucursal}-${String(
      siguienteNumero,
    ).padStart(5, "0")}`;

    /* =====================================================
       2️⃣ TOTAL / SALDO / ESTADO PAGO
    ====================================================== */

    const totalVenta = productos.reduce(
      (acc, p) => acc + Number(p.cantidad) * Number(p.precio_venta),
      0,
    );

    if (totalVenta <= 0) throw new Error("Total de venta inválido");

    let abono = Number(abono_inicial || 0);

    if (tipo_pago !== "CREDITO") {
      abono = totalVenta; // contado o transferencia = pagado completo
    }

    if (abono < 0) throw new Error("Abono inválido");
    if (abono > totalVenta)
      throw new Error("Abono no puede ser mayor al total");

    const saldo = totalVenta - abono;
    const estado_pago = saldo > 0 ? "PENDIENTE" : "PAGADO";

    /* =====================================================
       3️⃣ INSERTAR VENTA
    ====================================================== */

    const [ventaRes] = await conn.query(
      `INSERT INTO ventas
       (codigo, sucursal_id, cliente_id,
        tipo_pago, estado_pago,
        total, saldo,
        created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        codigo,
        sucursalId,
        cliente_id || null,
        tipo_pago,
        estado_pago,
        totalVenta,
        saldo,
        req.user?.id || null,
        nowUTC,
      ],
    );

    const ventaId = ventaRes.insertId;

    let utilidadTotal = 0;

    /* =====================================================
       4️⃣ DETALLE + FIFO
    ====================================================== */

    for (const p of productos) {
      const productoId = Number(p.producto_id);
      const cantidadVenta = Number(p.cantidad);
      const precioVenta = Number(p.precio_venta);

      if (cantidadVenta <= 0 || precioVenta <= 0)
        throw new Error("Cantidad o precio inválido");

      // 🔒 bloquear stock
      const [[stockRow]] = await conn.query(
        `SELECT cantidad
         FROM stock
         WHERE producto_id = ?
         AND sucursal_id = ?
         FOR UPDATE`,
        [productoId, sucursalId],
      );

      if (!stockRow)
        throw new Error(`Stock no configurado para producto ${productoId}`);

      if (Number(stockRow.cantidad) < cantidadVenta)
        throw new Error(`Stock insuficiente para producto ${productoId}`);

      /* ---- Insertar detalle comercial ---- */

      const [detalleRes] = await conn.query(
        `INSERT INTO venta_detalle
         (venta_id, producto_id, cantidad,
          precio_unitario, precio_subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [
          ventaId,
          productoId,
          cantidadVenta,
          precioVenta,
          cantidadVenta * precioVenta,
        ],
      );

      const detalleId = detalleRes.insertId;

      let cantidadRestante = cantidadVenta;
      let costoTotalProducto = 0;

      /* ---- FIFO ---- */

      const [lotes] = await conn.query(
        `SELECT *
         FROM lotes
         WHERE producto_id = ?
         AND sucursal_id = ?
         AND cantidad_actual > 0
         ORDER BY created_at ASC
         FOR UPDATE`,
        [productoId, sucursalId],
      );

      for (const lote of lotes) {
        if (cantidadRestante <= 0) break;

        const disponible = Number(lote.cantidad_actual);
        const consumir = Math.min(disponible, cantidadRestante);

        const subtotalCosto = consumir * Number(lote.costo_unitario);

        await conn.query(
          `INSERT INTO venta_lotes
           (venta_detalle_id, lote_id,
            cantidad, costo_unitario,
            subtotal_costo, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            detalleId,
            lote.id,
            consumir,
            lote.costo_unitario,
            subtotalCosto,
            nowUTC,
          ],
        );

        await conn.query(
          `UPDATE lotes
           SET cantidad_actual = cantidad_actual - ?
           WHERE id = ?`,
          [consumir, lote.id],
        );

        cantidadRestante -= consumir;
        costoTotalProducto += subtotalCosto;
      }

      if (cantidadRestante > 0)
        throw new Error(`Stock insuficiente para producto ${productoId}`);

      /* ---- Actualizar stock general ---- */

      await conn.query(
        `UPDATE stock
         SET cantidad = cantidad - ?,
             updated_at = ?
         WHERE producto_id = ?
         AND sucursal_id = ?`,
        [cantidadVenta, nowUTC, productoId, sucursalId],
      );

      /* ---- Kardex SALIDA con saldo acumulado ---- */

      const [[ultimo]] = await conn.query(
        `SELECT saldo_cantidad, saldo_total
         FROM kardex
         WHERE producto_id = ?
         AND sucursal_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [productoId, sucursalId],
      );

      const saldoAnteriorCantidad = ultimo?.saldo_cantidad || 0;
      const saldoAnteriorTotal = Number(ultimo?.saldo_total || 0);

      const nuevoSaldoCantidad = saldoAnteriorCantidad - cantidadVenta;
      const nuevoSaldoTotal = saldoAnteriorTotal - costoTotalProducto;

      if (nuevoSaldoCantidad < 0) throw new Error("Saldo negativo en kardex");

      const costoUnitarioPromedio =
        cantidadVenta > 0 ? costoTotalProducto / cantidadVenta : 0;

      await conn.query(
        `INSERT INTO kardex
         (producto_id, sucursal_id,
          tipo, referencia,
          cantidad, costo_unitario,
          total, saldo_cantidad,
          saldo_total, created_at)
         VALUES (?, ?, 'SALIDA', ?, ?, ?, ?, ?, ?, ?)`,
        [
          productoId,
          sucursalId,
          codigo,
          cantidadVenta,
          costoUnitarioPromedio,
          costoTotalProducto,
          nuevoSaldoCantidad,
          nuevoSaldoTotal,
          nowUTC,
        ],
      );

      /* ---- Utilidad ---- */

      const ingresoProducto = cantidadVenta * precioVenta;
      utilidadTotal += ingresoProducto - costoTotalProducto;
    }

    /* =====================================================
       5️⃣ PAGOS CLIENTE
    ====================================================== */

    if (abono > 0) {
      await conn.query(
        `INSERT INTO cliente_pagos
         (venta_id, monto, fecha, created_at)
         VALUES (?, ?, ?, ?)`,
        [ventaId, abono, nowUTC.split(" ")[0], nowUTC],
      );
    }

    /* =====================================================
       6️⃣ ACTUALIZAR UTILIDAD TOTAL
    ====================================================== */

    await conn.query(
      `UPDATE ventas
       SET utilidad_total = ?,
           updated_at = ?
       WHERE id = ?`,
      [utilidadTotal, nowUTC, ventaId],
    );

    /* =====================================================
       7️⃣ AUDITORÍA
    ====================================================== */

    await conn.query(
      `INSERT INTO auditoria
       (tabla, registro_id, accion,
        detalle, usuario_id, created_at)
       VALUES (?, ?, 'INSERT', ?, ?, ?)`,
      [
        "ventas",
        ventaId,
        JSON.stringify({
          codigo,
          total: totalVenta,
          saldo,
          utilidad: utilidadTotal,
        }),
        req.user?.id || null,
        nowUTC,
      ],
    );

    await conn.commit();

    res.status(201).json({
      message: "Venta registrada correctamente",
      codigo,
      utilidad: utilidadTotal,
    });
  } catch (error) {
    await conn.rollback();

    if (error.code === "ER_LOCK_DEADLOCK") {
      return res.status(409).json({
        message: "Conflicto de concurrencia. Intente nuevamente.",
      });
    }

    console.error("ERROR CREAR VENTA:", error);

    res.status(400).json({
      message: error.message || "Error al registrar venta",
    });
  } finally {
    conn.release();
  }
};



export const listarVentas = async (req, res) => {
  const sucursalId = req.sucursalActiva;

if (sucursalId === null || sucursalId === undefined) {
  return res.status(400).json({
    message: "Debe seleccionar una sucursal para ver las ventas",
  });
}

  try {
    /* ==============================
       1️⃣ Últimas 25 ventas
    =============================== */

    const [ventas] = await pool.query(
      `
      SELECT 
        v.id,
        v.codigo,
        DATE_SUB(v.created_at, INTERVAL 4 HOUR) AS fecha,
        IFNULL(c.nombre, 'SIN NOMBRE') AS cliente,
        v.cliente_id,
        v.tipo_pago,
        v.total,
        v.saldo,
        v.estado,
        v.estado_pago
      FROM ventas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.sucursal_id = ?
      ORDER BY v.created_at DESC
      LIMIT 25
      `,
      [sucursalId],
    );

    if (ventas.length === 0) {
      return res.json([]);
    }

    /* ==============================
       2️⃣ Obtener IDs
    =============================== */

    const ventaIds = ventas.map((v) => v.id);

    /* ==============================
       3️⃣ Traer detalle correcto
    =============================== */

    const placeholders = ventaIds.map(() => "?").join(",");

    const [detalles] = await pool.query(
      `
      SELECT 
        vd.venta_id,

        TRIM(
          CONCAT(
            IFNULL(m.nombre, ''),
            IF(m.nombre IS NOT NULL AND m.nombre <> '', ' ', ''),
            p.nombre,
            IF(p.descripcion IS NOT NULL AND p.descripcion <> '', ' ', ''),
            IFNULL(p.descripcion, '')
          )
        ) AS producto,

        vd.cantidad,
        vd.precio_unitario,
        vd.precio_subtotal

      FROM venta_detalle vd
      INNER JOIN productos p ON p.id = vd.producto_id
      LEFT JOIN marcas m ON m.id = p.marca_id
      WHERE vd.venta_id IN (${placeholders})
      `,
      ventaIds,
    );

    /* ==============================
       4️⃣ Agrupar
    =============================== */

    const ventasMap = {};

    ventas.forEach((v) => {
      ventasMap[v.id] = {
        ...v,
        productos: [],
      };
    });

    detalles.forEach((d) => {
      if (ventasMap[d.venta_id]) {
        ventasMap[d.venta_id].productos.push({
          producto: d.producto,
          cantidad: d.cantidad,
          precio_unitario: d.precio_unitario,
          subtotal: d.precio_subtotal,
        });
      }
    });

    const resultado = ventas.map(v => ventasMap[v.id]);

    res.json(resultado);
  } catch (error) {
    console.error("ERROR LISTAR VENTAS:", error);
    res.status(500).json({
      message: "Error al listar ventas",
    });
  }
};

export const descargarVentaPDF = async (req, res) => {
  try {
    const { id } = req.params;

    /* =============================
       1️⃣ CABECERA VENTA
    ============================== */

    const [[venta]] = await pool.query(
      `
      SELECT 
        v.codigo,
        v.created_at,
        v.total,
        v.saldo,
        v.tipo_pago,
        v.estado,
        IFNULL(c.nombre, 'SIN NOMBRE') AS cliente
      FROM ventas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id = ?
      `,
      [id],
    );

    if (!venta) {
      return res.status(404).json({ message: "Venta no encontrada" });
    }

    /* =============================
       2️⃣ DETALLE VENTA
    ============================== */

    const [detalle] = await pool.query(
      `
      SELECT 
        d.cantidad,
        d.precio_unitario,
        d.precio_subtotal,
        p.nombre
      FROM venta_detalle d
      JOIN productos p ON p.id = d.producto_id
      WHERE d.venta_id = ?
      `,
      [id],
    );

    /* =============================
       CONFIG PDF
    ============================== */

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=venta-${venta.codigo}.pdf`,
    );

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    /* =============================
       ENCABEZADO EMPRESA
    ============================== */

    doc
      .font("Helvetica-Bold")
      .fontSize(22)
      .text("TIENDA 3B", { align: "center" });

    doc
      .font("Helvetica")
      .fontSize(12)
      .text("VallesCruceños", { align: "center" });

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    /* =============================
       TITULO
    ============================== */

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("RECIBO DE VENTA", { align: "center" });

    doc.moveDown();

    /* =============================
       DATOS GENERALES
    ============================== */

    doc.font("Helvetica").fontSize(11);

    doc.text(`Código: ${venta.codigo}`);
    doc.text(`Fecha: ${formatearFechaHoraBO(venta.created_at)}`);
    doc.text(`Cliente: ${venta.cliente}`);
    doc.text(`Tipo pago: ${venta.tipo_pago}`);

    doc.moveDown();

    /* =============================
       TABLA DETALLE
    ============================== */

    const startX = 50;
    let y = doc.y;

    const colNro = startX;
    const colDesc = 80;
    const colCant = 330;
    const colPrecio = 380;
    const colSub = 460;

    doc.font("Helvetica-Bold").fontSize(10);

    doc.text("#", colNro, y);
    doc.text("Producto", colDesc, y);
    doc.text("Cant.", colCant, y);
    doc.text("Precio", colPrecio, y);
    doc.text("Subtotal", colSub, y);

    y += 15;
    doc
      .moveTo(50, y - 5)
      .lineTo(545, y - 5)
      .stroke();

    doc.font("Helvetica").fontSize(10);

    detalle.forEach((item, index) => {
      doc.text(index + 1, colNro, y);
      doc.text(item.nombre, colDesc, y, { width: 230 });
      doc.text(item.cantidad.toString(), colCant, y);
      doc.text(formatearMoneda(item.precio_unitario), colPrecio, y);
      doc.text(formatearMoneda(item.precio_subtotal), colSub, y);
      y += 18;
    });

    y += 10;
    doc.moveTo(300, y).lineTo(545, y).stroke();
    y += 15;

    /* =============================
       TOTALES
    ============================== */

    doc.font("Helvetica-Bold").fontSize(12);

    doc.text(`TOTAL: ${formatearMoneda(venta.total)}`, 350, y, {
      align: "right",
      width: 195,
    });

    y += 18;

    if (Number(venta.saldo) > 0) {
      doc.text(`SALDO PENDIENTE: ${formatearMoneda(venta.saldo)}`, 350, y, {
        align: "right",
        width: 195,
      });
    }

    doc.moveDown(3);

    /* =============================
       PIE
    ============================== */

    const fechaImpresion = formatearFechaHoraBO(new Date());

    doc
      .font("Helvetica")
      .fontSize(9)
      .text(`Impreso el: ${fechaImpresion} (UTC-4)`, {
        align: "right",
      });

    doc.moveDown();

    doc.fontSize(9).text("Documento generado electrónicamente", {
      align: "center",
    });

    doc.end();
  } catch (error) {
    console.error("ERROR PDF VENTA:", error);
    res.status(500).json({ message: "Error al generar PDF" });
  }
};

/* =============================
   FUNCIONES AUXILIARES
============================= */

function formatearFechaHoraBO(fechaISO) {
  const fecha = new Date(fechaISO);
  return fecha.toLocaleString("es-BO", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatearMoneda(valor) {
  return `Bs ${Number(valor).toFixed(2)}`;
}
