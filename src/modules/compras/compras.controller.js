import pool from "../../db/pool.js";
//import { generarDocumentoPDF } from "../../services/documento.service.js";
import { getUTCDateTime } from "../../utils/date.js";
import PDFDocument from "pdfkit";

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
      [sucursalId],
    );

    if (!sucursal) throw new Error("Sucursal inválida");

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

    const codigo = `C-${sucursal.codigo_sucursal}-${String(
      siguienteNumero,
    ).padStart(5, "0")}`;

    /* ==============================
       2️⃣ CALCULAR TOTAL / SALDO / ESTADO
    ============================== */

    const total = productos.reduce(
      (acc, p) => acc + Number(p.cantidad) * Number(p.costo_unitario),
      0,
    );

    if (total <= 0) throw new Error("Total inválido");

    //const abono = Number(abono_inicial || 0);
    let abono = Number(abono_inicial || 0);

    if (tipo_pago === "CONTADO") {
      abono = total; // automáticamente pagado completo
    }

    if (abono < 0) throw new Error("Abono inválido");
    if (abono > total) throw new Error("El abono no puede ser mayor al total");

    if (tipo_pago === "CONTADO") {
      if (abono !== total)
        throw new Error("Compra CONTADO debe pagarse completamente");
    }

    let saldo = total - abono;
    //let saldo = tipo_pago === "CONTADO" ? 0 : total - abono;

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
      ],
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
        [compraId, p.producto_id, cantidad, costo, subtotal],
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
        ],
      );

      await conn.query(
        `INSERT INTO stock
         (producto_id, sucursal_id, cantidad, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cantidad = cantidad + VALUES(cantidad),
           updated_at = ?`,
        [p.producto_id, sucursalId, cantidad, nowUTC, nowUTC, nowUTC],
      );

      // 1️⃣ Obtener último saldo
      const [[ultimo]] = await conn.query(
        `SELECT saldo_cantidad, saldo_total
   FROM kardex
   WHERE producto_id = ? AND sucursal_id = ?
   ORDER BY id DESC
   LIMIT 1`,
        [p.producto_id, sucursalId],
      );

      const saldoAnteriorCantidad = ultimo?.saldo_cantidad || 0;
      const saldoAnteriorTotal = Number(ultimo?.saldo_total || 0);

      // 2️⃣ Calcular nuevo saldo
      const nuevoSaldoCantidad = saldoAnteriorCantidad + cantidad;
      const nuevoSaldoTotal = saldoAnteriorTotal + subtotal;

      // 3️⃣ Insertar en kardex con saldo acumulado
      await conn.query(
        `INSERT INTO kardex
   (producto_id, sucursal_id,
    tipo, referencia,
    cantidad, costo_unitario,
    total, saldo_cantidad,
    saldo_total, created_at)
   VALUES (?, ?, 'ENTRADA', ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.producto_id,
          sucursalId,
          codigo,
          cantidad,
          costo,
          subtotal,
          nuevoSaldoCantidad,
          nuevoSaldoTotal,
          nowUTC,
        ],
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
        [compraId, abono, fecha, nowUTC, req.user?.id],
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
      ],
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
    const sucursalId = req.sucursalActiva;
    const esGlobal = sucursalId == null;

    let queryCompras = `
      SELECT 
        c.id,
        c.codigo,
        c.fecha_compra AS fecha,
        c.tipo_pago,
        c.total,
        c.saldo,
        c.estado,
        p.nombre AS proveedor,
        CONCAT(s.codigo_sucursal, ' - ', ci.nombre) AS sucursal
      FROM compras c
      JOIN proveedores p ON p.id = c.proveedor_id
      JOIN sucursales s ON s.id = c.sucursal_id
      JOIN ciudades ci ON ci.id = s.ciudad_id
    `;

    const params = [];

    if (!esGlobal) {
      queryCompras += ` WHERE c.sucursal_id = ?`;
      params.push(sucursalId);
    }

    queryCompras += `
      ORDER BY c.fecha_compra DESC
      LIMIT ${esGlobal ? 50 : 25}
    `;

    const [compras] = await pool.query(queryCompras, params);

    if (compras.length === 0) {
      return res.json({ esGlobal, data: [] });
    }

    const compraIds = compras.map((c) => c.id);
    const placeholders = compraIds.map(() => "?").join(",");

    const [detalles] = await pool.query(
      `
      SELECT 
        cd.compra_id,

        TRIM(
          CONCAT(
            IFNULL(m.nombre, ''),
            IF(m.nombre IS NOT NULL AND m.nombre <> '', ' ', ''),
            p.nombre,
            IF(p.descripcion IS NOT NULL AND p.descripcion <> '', ' ', ''),
            IFNULL(p.descripcion, '')
          )
        ) AS producto,

        cd.cantidad,
        cd.costo_unitario,
        cd.costo_subtotal

      FROM compra_detalle cd
      INNER JOIN productos p ON p.id = cd.producto_id
      LEFT JOIN marcas m ON m.id = p.marca_id
      WHERE cd.compra_id IN (${placeholders})
      `,
      compraIds,
    );

    const comprasMap = {};

    compras.forEach((c) => {
      comprasMap[c.id] = {
        ...c,
        productos: [],
      };
    });

    detalles.forEach((d) => {
      if (comprasMap[d.compra_id]) {
        comprasMap[d.compra_id].productos.push({
          producto: d.producto,
          cantidad: d.cantidad,
          costo_unitario: d.costo_unitario,
          subtotal: d.costo_subtotal,
        });
      }
    });

    const resultado = compras.map((c) => comprasMap[c.id]);

    res.json({ esGlobal, data: resultado });
  } catch (error) {
    console.error("ERROR LISTAR COMPRAS:", error);
    res.status(500).json({
      message: "Error al listar compras",
    });
  }
};

export const descargarCompraPDF = async (req, res) => {
  try {
    const { id } = req.params;

    const [[compra]] = await pool.query(
      `
      SELECT 
        c.codigo,
        c.fecha_compra,
        c.tipo_pago,
        c.total,
        c.saldo,
        p.nombre AS proveedor
      FROM compras c
      JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.id = ?
    `,
      [id],
    );

    if (!compra) {
      return res.status(404).json({ message: "Compra no encontrada" });
    }

    const [detalle] = await pool.query(
      `
  SELECT 
    d.cantidad,
    d.costo_unitario,
    d.costo_subtotal,

    TRIM(
      CONCAT_WS(' ',
        SUBSTRING_INDEX(pr.nombre, ' ', 1),
        NULLIF(m.nombre, ''),
        NULLIF(
          SUBSTRING(
            pr.nombre,
            LENGTH(SUBSTRING_INDEX(pr.nombre, ' ', 1)) + 2
          ),
          ''
        ),
        NULLIF(pr.descripcion, '')
      )
    ) AS producto_label

  FROM compra_detalle d
  JOIN productos pr ON pr.id = d.producto_id
  LEFT JOIN marcas m ON m.id = pr.marca_id
  WHERE d.compra_id = ?
  `,
      [id],
    );

    /* ====== CONFIG RESPUESTA ====== */

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=compra-${compra.codigo}.pdf`,
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

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();

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
    doc.text(`Fecha: ${formatearFechaBO(compra.fecha_compra)}`);
    doc.text(`Proveedor: ${compra.proveedor}`);
    doc.text(`Tipo Pago: ${compra.tipo_pago}`);

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

    doc
      .moveTo(50, y - 5)
      .lineTo(545, y - 5)
      .stroke();

    doc.font("Helvetica").fontSize(10);

    detalle.forEach((item, index) => {
      doc.text(index + 1, colNro, y);
      doc.text(item.producto_label, colDesc, y, { width: 250 });
      doc.text(item.cantidad.toString(), colCant, y);
      doc.text(formatearMoneda(item.costo_unitario), colCosto, y);
      doc.text(formatearMoneda(item.costo_subtotal), colSub, y);
      y += 18;
    });

    y += 10;

    doc.moveTo(300, y).lineTo(545, y).stroke();

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

    const fechaImpresion = formatearFechaHoraCortaBO(new Date());

    doc
      .font("Helvetica") // mismo font que antes
      .fontSize(9) // mismo tamaño
      .text(`Impreso: ${fechaImpresion}`, 350, doc.y, {
        width: 195, // mismo ancho que TOTAL/SALDO
        align: "right", // alineación igual
      });

    doc.moveDown();

    doc
      .font("Helvetica")
      .fontSize(9)
      .text("Documento generado electrónicamente", 350, doc.y, {
        width: 195,
        align: "right", // alineación igual
      });

    doc.end();
  } catch (error) {
    console.error("ERROR PDF COMPRA:", error);
    res.status(500).json({ message: "Error al generar PDF" });
  }
};

export const anularCompra = async (req, res) => {
  const sucursalId = req.sucursalActiva;
  const { id } = req.params;
  const { motivo } = req.body;
  const usuarioId = req.user?.id;

  if (sucursalId === null || sucursalId === undefined) {
    return res.status(400).json({
      message: "Debe seleccionar una sucursal específica para anular la compra",
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

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const nowUTC = getUTCDateTime();

    /* ==============================
       1️⃣ OBTENER COMPRA
    ============================== */

    const [[compra]] = await conn.query(
      `SELECT * FROM compras
       WHERE id = ? AND sucursal_id = ?
       FOR UPDATE`,
      [id, sucursalId],
    );

    if (!compra) throw new Error("Compra no encontrada");

    if (compra.estado === "ANULADA")
      throw new Error("La compra ya está anulada");

    /* ==============================
       2️⃣ OBTENER DETALLE
    ============================== */

    const [detalles] = await conn.query(
      `SELECT * FROM compra_detalle
       WHERE compra_id = ?`,
      [id],
    );

    if (detalles.length === 0) throw new Error("Compra sin detalle");

    /* ==============================
       3️⃣ VALIDAR STOCK
    ============================== */

    for (const d of detalles) {
      const [[stock]] = await conn.query(
        `SELECT cantidad FROM stock
         WHERE producto_id = ? AND sucursal_id = ?
         FOR UPDATE`,
        [d.producto_id, sucursalId],
      );

      if (!stock || stock.cantidad < d.cantidad) {
        throw new Error(
          `No se puede anular. Stock insuficiente para producto ${d.producto_id}`,
        );
      }
    }

    /* ==============================
       4️⃣ REVERSIÓN PRODUCTO POR PRODUCTO
    ============================== */

    for (const d of detalles) {
      const subtotal = Number(d.costo_subtotal);

      // 🔹 RESTAR STOCK
      await conn.query(
        `UPDATE stock
         SET cantidad = cantidad - ?, updated_at = ?
         WHERE producto_id = ? AND sucursal_id = ?`,
        [d.cantidad, nowUTC, d.producto_id, sucursalId],
      );

      // 🔹 AJUSTAR LOTE
      await conn.query(
        `UPDATE lotes
         SET cantidad_actual = cantidad_actual - ?
         WHERE compra_detalle_id = ?`,
        [d.cantidad, d.id],
      );

      // 🔹 OBTENER SALDO ANTERIOR KARDEX
      const [[ultimo]] = await conn.query(
        `SELECT saldo_cantidad, saldo_total
         FROM kardex
         WHERE producto_id = ? AND sucursal_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [d.producto_id, sucursalId],
      );

      const saldoAnteriorCantidad = ultimo?.saldo_cantidad || 0;
      const saldoAnteriorTotal = Number(ultimo?.saldo_total || 0);

      const nuevoSaldoCantidad = saldoAnteriorCantidad - d.cantidad;
      const nuevoSaldoTotal = saldoAnteriorTotal - subtotal;

      // 🔹 INSERTAR MOVIMIENTO INVERSO
      await conn.query(
        `INSERT INTO kardex
         (producto_id, sucursal_id,
          tipo, referencia,
          cantidad, costo_unitario,
          total, saldo_cantidad,
          saldo_total, created_at)
         VALUES (?, ?, 'SALIDA', ?, ?, ?, ?, ?, ?, ?)`,
        [
          d.producto_id,
          sucursalId,
          compra.codigo + " (ANULACION)",
          d.cantidad,
          d.costo_unitario,
          subtotal,
          nuevoSaldoCantidad,
          nuevoSaldoTotal,
          nowUTC,
        ],
      );
    }

    /* ==============================
       5️⃣ ANULAR PAGOS
    ============================== */

    await conn.query(
      `UPDATE compra_pagos
       SET estado = 'ANULADO'
       WHERE compra_id = ?`,
      [id],
    );

    /* ==============================
       6️⃣ ACTUALIZAR COMPRA
    ============================== */

    // await conn.query(
    //   `UPDATE compras
    //    SET estado = 'ANULADA',
    //        saldo = 0,
    //        updated_at = ?
    //    WHERE id = ?`,
    //   [nowUTC, id],
    // );

    await conn.query(
      `UPDATE compras
   SET estado = 'ANULADA',
       saldo = 0,
       anulada_at = ?,
       anulada_by = ?,
       motivo_anulacion = ?,
       updated_at = ?
   WHERE id = ?`,
      [nowUTC, usuarioId, motivo, nowUTC, id],
    );

    /* ==============================
       7️⃣ AUDITORÍA
    ============================== */

    await conn.query(
      `INSERT INTO auditoria
       (tabla, registro_id, accion,
        detalle, usuario_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        "compras",
        id,
        "ANULAR",
        JSON.stringify({
          codigo: compra.codigo,
          total: compra.total,
        }),
        req.user?.id,
        nowUTC,
      ],
    );

    await conn.commit();

    res.json({
      message: "Compra anulada correctamente",
    });
  } catch (error) {
    await conn.rollback();
    res.status(400).json({
      message: error.message || "Error al anular compra",
    });
  } finally {
    conn.release();
  }
};

function formatearFechaBO(fechaISO) {
  const fecha = new Date(fechaISO);
  return fecha.toLocaleDateString("es-BO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

const formatearMoneda = (valor) => {
  return new Intl.NumberFormat("es-BO", {
    style: "currency",
    currency: "BOB",
    minimumFractionDigits: 2,
  }).format(valor || 0);
};

function formatearFechaHoraCortaBO(fecha) {
  return new Intl.DateTimeFormat("es-BO", {
    timeZone: "America/La_Paz",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(fecha);
}
