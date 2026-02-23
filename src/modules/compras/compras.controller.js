import pool from "../../db/pool.js";
import { generarDocumentoPDF } from "../../services/documento.service.js";
import { getUTCDateTime } from "../../utils/date.js";
import PDFDocument from "pdfkit";

/* ====== FORMATEADORES ====== */

function formatearFechaBO(fechaISO) {
  const fecha = new Date(fechaISO);
  return fecha.toLocaleDateString("es-BO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

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
        c.fecha_compra AS fecha,
        c.tipo_pago,
        c.total,
        c.saldo,
        p.nombre AS proveedor,
        CONCAT(s.codigo_sucursal, ' - ', ci.nombre) AS sucursal
      FROM compras c
      JOIN proveedores p ON p.id = c.proveedor_id
      JOIN sucursales s ON s.id = c.sucursal_id
      JOIN ciudades ci ON ci.id = s.ciudad_id
      ORDER BY c.id DESC
      LIMIT 150
    `);

    res.json(rows);

  } catch (error) {
    console.error("ERROR LISTAR COMPRAS:", error);
    res.status(500).json({ message: "Error al listar compras" });
  }
};


export const descargarCompraPDFaaa = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(`
      SELECT 
        c.codigo,
        c.fecha_compra,
        c.total,
        c.saldo,
        p.nombre AS proveedor
      FROM compras c
      JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.id = ?
    `, [id]);

    if (!rows.length) {
      return res.status(404).json({ message: "Compra no encontrada" });
    }

    const compra = rows[0];

    const [detalle] = await pool.query(`
      SELECT 
        d.cantidad,
        d.costo_unitario,
        d.costo_subtotal,
        pr.nombre
      FROM compra_detalle d
      JOIN productos pr ON pr.id = d.producto_id
      WHERE d.compra_id = ?
    `, [id]);

    // Configurar respuesta
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=compra-${compra.codigo}.pdf`
    );

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    // ===== TÍTULO =====
    doc.fontSize(16).text("RECIBO DE COMPRA", { align: "center" });
    doc.moveDown();

    // ===== DATOS GENERALES =====
    doc.fontSize(10);
    doc.text(`Código: ${compra.codigo}`);
    doc.text(`Fecha: ${compra.fecha_compra}`);
    doc.text(`Proveedor: ${compra.proveedor}`);
    doc.moveDown();

    // ===== TABLA =====
    doc.fontSize(10);

    const startX = 40;
    let y = doc.y;

    // Encabezado
    doc.text("Producto", startX, y);
    doc.text("Cant.", 300, y);
    doc.text("Costo", 350, y);
    doc.text("Subtotal", 420, y);

    y += 15;

    doc.moveTo(40, y - 5)
       .lineTo(550, y - 5)
       .stroke();

    // Filas
    detalle.forEach(item => {
      doc.text(item.nombre, startX, y);
      doc.text(item.cantidad.toString(), 300, y);
      doc.text(`Bs ${Number(item.costo_unitario).toFixed(2)}`, 350, y);
      doc.text(`Bs ${Number(item.costo_subtotal).toFixed(2)}`, 420, y);
      y += 15;
    });

    y += 10;

    doc.moveTo(40, y)
       .lineTo(550, y)
       .stroke();

    y += 10;

    // Totales
    doc.fontSize(12);
    doc.text(`TOTAL: Bs ${Number(compra.total).toFixed(2)}`, 350, y);
    y += 15;
    doc.text(`SALDO: Bs ${Number(compra.saldo).toFixed(2)}`, 350, y);

    doc.moveDown();
    doc.moveDown();

    doc.fontSize(9)
       .text(`Generado: ${getUTCDateTime()} UTC`, { align: "right" });

    doc.end();

  } catch (error) {
    console.error("ERROR PDF COMPRA:", error);
    res.status(500).json({ message: "Error al generar PDF" });
  }
};

export const descargarCompraPDF = async (req, res) => {
  try {
    const { id } = req.params;

    const [[compra]] = await pool.query(`
      SELECT 
        c.codigo,
        c.fecha_compra,
        c.total,
        c.saldo,
        p.nombre AS proveedor
      FROM compras c
      JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.id = ?
    `, [id]);

    if (!compra) {
      return res.status(404).json({ message: "Compra no encontrada" });
    }

    const [detalle] = await pool.query(`
      SELECT 
        d.cantidad,
        d.costo_unitario,
        d.costo_subtotal,
        pr.nombre
      FROM compra_detalle d
      JOIN productos pr ON pr.id = d.producto_id
      WHERE d.compra_id = ?
    `, [id]);

    /* ====== CONFIG RESPUESTA ====== */

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=compra-${compra.codigo}.pdf`
    );

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    /* ====== ENCABEZADO EMPRESA ====== */

    doc
      .font("Helvetica-Bold")
      .fontSize(22)
      .text("TIENDA 3B", { align: "center" });

    doc
      .font("Helvetica")
      .fontSize(12)
      .text("VallesCruceños", { align: "center" });

    doc.moveDown(0.5);

    doc.moveTo(50, doc.y)
       .lineTo(545, doc.y)
       .stroke();

    doc.moveDown();

    /* ====== TÍTULO DOCUMENTO ====== */

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("RECIBO DE COMPRA", { align: "center" });

    doc.moveDown();

    /* ====== DATOS GENERALES ====== */

    doc.font("Helvetica").fontSize(11);

    doc.text(`Código: ${compra.codigo}`);
    doc.text(`Fecha de compra: ${formatearFechaBO(compra.fecha_compra)}`);
    doc.text(`Proveedor: ${compra.proveedor}`);

    doc.moveDown();

    /* ====== TABLA ====== */

    const startX = 50;
    let y = doc.y;

    const colNro = startX;
    const colDesc = 80;
    const colCant = 350;
    const colCosto = 400;
    const colSub = 470;

    doc.font("Helvetica-Bold").fontSize(10);

    doc.text("#", colNro, y);
    doc.text("Producto", colDesc, y);
    doc.text("Cant.", colCant, y);
    doc.text("Costo", colCosto, y);
    doc.text("Subtotal", colSub, y);

    y += 15;

    doc.moveTo(50, y - 5)
       .lineTo(545, y - 5)
       .stroke();

    doc.font("Helvetica").fontSize(10);

    detalle.forEach((item, index) => {
      doc.text(index + 1, colNro, y);
      doc.text(item.nombre, colDesc, y, { width: 250 });
      doc.text(item.cantidad.toString(), colCant, y);
      doc.text(formatearMoneda(item.costo_unitario), colCosto, y);
      doc.text(formatearMoneda(item.costo_subtotal), colSub, y);
      y += 18;
    });

    y += 10;

    doc.moveTo(300, y)
       .lineTo(545, y)
       .stroke();

    y += 15;

    /* ====== TOTALES DERECHA ====== */

    doc.font("Helvetica-Bold").fontSize(12);

    doc.text(`TOTAL: ${formatearMoneda(compra.total)}`, 350, y, {
      align: "right",
      width: 195,
    });

    y += 20;

    doc.text(`SALDO: ${formatearMoneda(compra.saldo)}`, 350, y, {
      align: "right",
      width: 195,
    });

    doc.moveDown(3);

    /* ====== PIE CON HORA LOCAL ====== */

    const fechaImpresion = formatearFechaHoraBO(new Date());

    doc
      .font("Helvetica")
      .fontSize(9)
      .text(`Impreso el: ${fechaImpresion} (UTC-4)`, {
        align: "right",
      });

    doc.moveDown();

    doc
      .fontSize(9)
      .text("Documento generado electrónicamente", {
        align: "center",
      });

    doc.end();

  } catch (error) {
    console.error("ERROR PDF COMPRA:", error);
    res.status(500).json({ message: "Error al generar PDF" });
  }
};