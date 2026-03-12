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

    //const resultado = compras.map((c) => comprasMap[c.id]);

    const resultado = compras.map((c) => {
      const compra = comprasMap[c.id];

      const totalItems = compra.productos.length;

      return {
        ...compra,
        total_items: totalItems,
        producto_resumen: totalItems === 1 ? compra.productos[0] : null,
      };
    });

    res.json({ esGlobal, data: resultado });
  } catch (error) {
    console.error("ERROR LISTAR COMPRAS:", error);
    res.status(500).json({
      message: "Error al listar compras",
    });
  }
};
/* =====================================
   FUNCION NUMERO A LETRAS (BÁSICA BS)
===================================== */
function numeroALetras(numero) {
  const n = Number(numero);

  if (isNaN(n)) return "Cero 00/100";

  const entero = Math.floor(n);
  const decimal = Math.round((n - entero) * 100)
    .toString()
    .padStart(2, "0");

  const unidades = [
    "",
    "Uno",
    "Dos",
    "Tres",
    "Cuatro",
    "Cinco",
    "Seis",
    "Siete",
    "Ocho",
    "Nueve",
  ];

  const especiales = [
    "Diez",
    "Once",
    "Doce",
    "Trece",
    "Catorce",
    "Quince",
    "Dieciséis",
    "Diecisiete",
    "Dieciocho",
    "Diecinueve",
  ];

  const decenas = [
    "",
    "",
    "Veinte",
    "Treinta",
    "Cuarenta",
    "Cincuenta",
    "Sesenta",
    "Setenta",
    "Ochenta",
    "Noventa",
  ];

  function convertir(num) {
    if (num < 10) return unidades[num];

    if (num >= 10 && num < 20) return especiales[num - 10];

    if (num < 100) {
      const d = Math.floor(num / 10);
      const r = num % 10;
      return r === 0 ? decenas[d] : `${decenas[d]} y ${unidades[r]}`;
    }

    if (num === 100) return "Cien";

    if (num < 1000) {
      const c = Math.floor(num / 100);
      const r = num % 100;

      const centenas = [
        "",
        "Ciento",
        "Doscientos",
        "Trescientos",
        "Cuatrocientos",
        "Quinientos",
        "Seiscientos",
        "Setecientos",
        "Ochocientos",
        "Novecientos",
      ];

      return r === 0 ? centenas[c] : `${centenas[c]} ${convertir(r)}`;
    }

    if (num < 1000000) {
      const miles = Math.floor(num / 1000);
      const r = num % 1000;

      const milesTexto = miles === 1 ? "Mil" : `${convertir(miles)} Mil`;

      return r === 0 ? milesTexto : `${milesTexto} ${convertir(r)}`;
    }

    return num.toString();
  }

  return `${convertir(entero)} ${decimal}/100`;
}

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
    CONCAT(
      SUBSTRING_INDEX(pr.nombre, ' ', 1),

      IF(m.nombre IS NOT NULL AND m.nombre <> '',
        CONCAT(' ', m.nombre),
        ''
      ),

      ' ',

      SUBSTRING(pr.nombre, LENGTH(SUBSTRING_INDEX(pr.nombre,' ',1)) + 1),

      IF(pr.descripcion IS NOT NULL AND pr.descripcion <> '',
        CONCAT(' ', pr.descripcion),
        ''
      )
    )
  ) AS producto_label

FROM compra_detalle d
JOIN productos pr ON pr.id = d.producto_id
LEFT JOIN marcas m ON m.id = pr.marca_id

WHERE d.compra_id = ?
`,
      [id],
    );

    // const [detalle] = await pool.query(
    //   `
    //   SELECT
    //     d.cantidad,
    //     d.costo_unitario,
    //     d.costo_subtotal,
    //     pr.nombre AS producto_label
    //   FROM compra_detalle d
    //   JOIN productos pr ON pr.id = d.producto_id
    //   WHERE d.compra_id = ?
    //   `,
    //   [id],
    // );

    /* ===== CONFIG ===== */

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=compra-${compra.codigo}.pdf`,
    );

    const doc = new PDFDocument({
      size: "LETTER",
      margin: 40,
    });

    doc.pipe(res);

    const margin = doc.page.margins.left;
    const pageWidth = doc.page.width;

    const formatBs = (n) =>
      Number(n).toLocaleString("es-BO", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    /* ===== HEADER ===== */

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("RECIBO DE COMPRA", { align: "center" });

    doc.moveDown(1.5);

    doc.font("Helvetica").fontSize(10);

    doc.text(`Código: ${compra.codigo}`);
    doc.text(
      `Fecha: ${new Date(compra.fecha_compra).toLocaleDateString("es-BO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })}`,
    );
    //doc.text(`Fecha: ${new Date(compra.fecha_compra).toLocaleString()}`);
    doc.text(`Proveedor: ${compra.proveedor}`);
    doc.text(`Tipo de Pago: ${compra.tipo_pago}`);

    doc.moveDown(1.5);

    /* ===== TABLA ===== */

    let startY = doc.y;
    const rowHeight = 25;

    const colWidths = [30, 290, 60, 80, 80];

    const headers = ["#", "DESCRIPCIÓN", "CANT.", "COSTO UNIT.", "SUBTOTAL"];

    const tableWidth = colWidths.reduce((a, b) => a + b, 0);

    // Header gris
    doc
      .rect(margin, startY, tableWidth, rowHeight)
      .fillAndStroke("#e6e6e6", "black");

    let x = margin;

    doc.font("Helvetica-Bold").fontSize(9);

    headers.forEach((header, i) => {
      doc.fillColor("black").text(header, x, startY + 7, {
        width: colWidths[i],
        align: "center",
      });

      doc.rect(x, startY, colWidths[i], rowHeight).stroke();
      x += colWidths[i];
    });

    startY += rowHeight;

    /* ===== FILAS ===== */

    doc.font("Helvetica").fontSize(9);

    detalle.forEach((item, index) => {
      if (startY > doc.page.height - 120) {
        doc.addPage();
        startY = margin;
      }

      let xRow = margin;

      const rowValues = [
        index + 1,
        item.producto_label,
        item.cantidad,
        formatBs(item.costo_unitario),
        formatBs(item.costo_subtotal),
      ];

      rowValues.forEach((val, i) => {
        doc.rect(xRow, startY, colWidths[i], rowHeight).stroke();

        const isDescripcion = i === 1;

        doc.text(val.toString(), isDescripcion ? xRow + 5 : xRow, startY + 7, {
          width: isDescripcion ? colWidths[i] - 10 : colWidths[i],
          align: isDescripcion ? "left" : "center",
        });

        xRow += colWidths[i];
      });

      startY += rowHeight;
    });

    /* ===== TOTAL INTEGRADO ===== */

    const totalRowY = startY;

    const col0 = margin;
    const col1 = col0 + colWidths[0];
    const col2 = col1 + colWidths[1];
    const col3 = col2 + colWidths[2];
    const col4 = col3 + colWidths[3];

    const combinedWidth = colWidths[2] + colWidths[3];

    doc.rect(col2, totalRowY, combinedWidth, rowHeight).stroke();

    doc.font("Helvetica-Bold").fontSize(10);

    doc.text("TOTAL BS", col2, totalRowY + 5, {
      width: combinedWidth - 6,
      align: "right",
    });

    doc.rect(col4, totalRowY, colWidths[4], rowHeight).stroke();

    doc.text(formatBs(compra.total), col4, totalRowY + 7, {
      width: colWidths[4],
      align: "center",
    });

    startY += rowHeight;

    /* ===== TOTAL LITERAL ===== */

    doc.moveDown(1.5);

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(`Son: ${numeroALetras(compra.total)} Bolivianos`, margin, doc.y, {
        width: tableWidth,
        align: "right",
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
