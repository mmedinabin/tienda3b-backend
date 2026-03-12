import pool from "../../db/pool.js";
import { getUTCDateTime } from "../../utils/date.js";
import PDFDocument from "pdfkit";

/* =========================================
   FORMATO FECHA BOLIVIA CORTO (UTC-4)
========================================= */
const formatearFechaCortaBO = (fechaUTC) => {
  const fecha = new Date(fechaUTC);

  const fechaBO = new Date(
    fecha.toLocaleString("en-US", { timeZone: "America/La_Paz" }),
  );

  const dia = String(fechaBO.getDate()).padStart(2, "0");
  const mes = String(fechaBO.getMonth() + 1).padStart(2, "0");
  const anio = fechaBO.getFullYear();

  const horas = String(fechaBO.getHours()).padStart(2, "0");
  const minutos = String(fechaBO.getMinutes()).padStart(2, "0");

  return `${dia}/${mes}/${anio} ${horas}:${minutos}`;
};

/* =========================================
   FORMATO MONEDA
========================================= */
const formatearMoneda = (valor) => {
  return `Bs ${Number(valor).toFixed(2)}`;
};

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
  try {
    const sucursalId = req.sucursalActiva;
    const esGlobal = sucursalId == null;

    /* ==============================
       1️⃣ Query base
    =============================== */

    let queryVentasrrr = `
      SELECT 
        v.id,
        v.codigo,
        v.created_at AS fecha,
        IFNULL(c.nombre, 'SIN NOMBRE') AS cliente,
        v.cliente_id,
        v.tipo_pago,
        v.total,
        v.saldo,
        v.estado,
        v.estado_pago
      FROM ventas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
    `;
    let queryVentas = `
  SELECT 
    v.id,
    v.codigo,
    v.created_at AS fecha,

    IFNULL(c.nombre, 'SIN NOMBRE') AS cliente,
    v.cliente_id,

    v.tipo_pago,
    v.total,
    v.saldo,
    v.estado,
    v.estado_pago,

    s.id AS sucursal_id,
    CONCAT(
      s.codigo_sucursal,
      ' - ',
      ci.nombre
    ) AS sucursal

  FROM ventas v

  LEFT JOIN clientes c ON c.id = v.cliente_id

  INNER JOIN sucursales s ON s.id = v.sucursal_id
  INNER JOIN ciudades ci ON ci.id = s.ciudad_id
`;

    const params = [];

    if (!esGlobal) {
      queryVentas += ` WHERE v.sucursal_id = ?`;
      params.push(sucursalId);
    }

    queryVentas += `
      ORDER BY v.created_at DESC
      LIMIT ${esGlobal ? 50 : 25}
    `;

    const [ventas] = await pool.query(queryVentas, params);

    if (ventas.length === 0) {
      return res.json({
        esGlobal,
        data: [],
      });
    }

    /* ==============================
       2️⃣ Obtener IDs
    =============================== */

    const ventaIds = ventas.map((v) => v.id);
    const placeholders = ventaIds.map(() => "?").join(",");

    /* ==============================
       3️⃣ Traer detalle
    =============================== */

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

    const resultado = ventas.map((v) => ventasMap[v.id]);

    res.json({
      esGlobal,
      data: resultado,
    });
  } catch (error) {
    console.error("ERROR LISTAR VENTAS:", error);
    res.status(500).json({
      message: "Error al listar ventas",
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

const formatBs = (n) =>
  Number(n).toLocaleString("es-BO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const descargarVentaPDF = async (req, res) => {
  try {
    const { id } = req.params;

    /* =============================
       1️⃣ CABECERA
    ============================== */

    const [[venta]] = await pool.query(
      `
      SELECT 
        v.codigo,
        v.created_at,
        v.total,
        v.saldo,
        v.tipo_pago,
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
       2️⃣ DETALLE
    ============================== */
    const [detalle] = await pool.query(
      `
SELECT 
  d.cantidad,
  d.precio_unitario,
  d.precio_subtotal,

  TRIM(
    CONCAT(
      SUBSTRING_INDEX(p.nombre, ' ', 1),

      IF(m.nombre IS NOT NULL AND m.nombre <> '',
         CONCAT(' ', m.nombre),
         ''
      ),

      ' ',

      SUBSTRING(p.nombre, LENGTH(SUBSTRING_INDEX(p.nombre,' ',1)) + 1),

      IF(p.descripcion IS NOT NULL AND p.descripcion <> '',
         CONCAT(' ', p.descripcion),
         ''
      )
    )
  ) AS producto_label

FROM venta_detalle d
JOIN productos p ON p.id = d.producto_id
LEFT JOIN marcas m ON m.id = p.marca_id

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
      `inline; filename=nota-entrega-${venta.codigo}.pdf`,
    );

    const doc = new PDFDocument({
      size: "LETTER",
      margin: 40,
    });

    doc.pipe(res);

    const margin = doc.page.margins.left;
    const pageWidth = doc.page.width;
    //const tableWidth = pageWidth - margin * 2;

    /* =============================
       HEADER DOCUMENTO
    ============================== */

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("NOTA DE ENTREGA", { align: "center" });

    doc.moveDown(1.5);

    doc.font("Helvetica").fontSize(10);

    doc.text(`Código: ${venta.codigo}`);
    doc.text(`Fecha: ${new Date(venta.created_at).toLocaleString()}`);
    doc.text(`Cliente: ${venta.cliente}`);
    doc.text(`Tipo de Pago: ${venta.tipo_pago}`);

    doc.moveDown(1.5);

    /* =============================
   TABLA
============================= */

    let startY = doc.y;
    const rowHeight = 25;

    // Ajustamos columnas para que SUBTOTAL quede alineado con TOTAL
    const colWidths = [
      30, // #
      290, // descripción
      60, // cantidad
      80, // unitario
      80, // subtotal
    ];

    const headers = ["#", "DESCRIPCIÓN", "CANT.", "P. UNITARIO", "SUBTOTAL"];

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

    /* =============================
   FILAS
============================= */

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
        formatBs(item.precio_unitario),
        formatBs(item.precio_subtotal),
      ];

      rowValues.forEach((val, i) => {
        doc.rect(xRow, startY, colWidths[i], rowHeight).stroke();

        const isDescripcion = i === 1;

        doc.text(
          val.toString(),
          isDescripcion ? xRow + 5 : xRow, // 👈 pequeño padding izquierdo
          startY + 7,
          {
            width: isDescripcion ? colWidths[i] - 10 : colWidths[i], // 👈 compensar padding
            align: isDescripcion ? "left" : "center",
          },
        );

        xRow += colWidths[i];
      });

      startY += rowHeight;
    });

    /* =============================
   TOTAL INTEGRADO A TABLA
============================= */

    // No sumamos espacio extra → pegado a la tabla

    const totalRowY = startY;

    // Calcular posiciones acumuladas
    const col0 = margin;
    const col1 = col0 + colWidths[0];
    const col2 = col1 + colWidths[1];
    const col3 = col2 + colWidths[2]; // inicio CANT
    const col4 = col3 + colWidths[3]; // inicio SUBTOTAL

    // Ancho combinado CANT + P.UNITARIO
    const combinedWidth = colWidths[2] + colWidths[3];

    // Dibujar celda combinada (CANT + UNITARIO)
    doc.rect(col2, totalRowY, combinedWidth, rowHeight).stroke();

    doc.font("Helvetica-Bold").fontSize(10);

    const paddingRight = 6;

    doc.text("TOTAL BS", col2, totalRowY + 5, {
      width: combinedWidth - paddingRight,
      align: "right",
    });

    // Dibujar celda SUBTOTAL
    doc.rect(col4, totalRowY, colWidths[4], rowHeight).stroke();

    doc.text(formatBs(venta.total), col4, totalRowY + 7, {
      width: colWidths[4],
      align: "center",
    });

    startY += rowHeight;

    /* =============================
   TOTAL EN LITERAL (NEGRITA)
============================= */

    doc.moveDown(1.5);

    doc
      .font("Helvetica-Bold") // 👈 NEGRITA
      .fontSize(10)
      .text(`Son: ${numeroALetras(venta.total)} Bolivianos`, margin, doc.y, {
        width: tableWidth,
        align: "right",
      });

    doc.end();
  } catch (error) {
    console.error("ERROR PDF:", error);
    res.status(500).json({ message: "Error al generar PDF" });
  }
};

/* =============================
   DESCARGAR TICKET 80MM
============================= */
export const descargarVentaPDFticket = async (req, res) => {
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
       2️⃣ DETALLE CON LABEL
    ============================== */
    const [detalle] = await pool.query(
      `
  SELECT 
    d.cantidad,
    d.precio_unitario,
    d.precio_subtotal,

    TRIM(
      CONCAT_WS(' ',
        SUBSTRING_INDEX(p.nombre, ' ', 1),
        NULLIF(m.nombre, ''),
        NULLIF(
          SUBSTRING(
            p.nombre,
            LENGTH(SUBSTRING_INDEX(p.nombre, ' ', 1)) + 2
          ),
          ''
        ),
        NULLIF(p.descripcion, '')
      )
    ) AS producto_label

  FROM venta_detalle d
  JOIN productos p ON p.id = d.producto_id
  LEFT JOIN marcas m ON m.id = p.marca_id
  WHERE d.venta_id = ?
  `,
      [id],
    );

    /* =============================
       CONFIG ALTURA DINÁMICA
    ============================== */

    const TICKET_WIDTH = 226;
    const MARGIN = 10;

    const BASE_HEIGHT = 580; // altura estándar
    const ITEM_HEIGHT = 26; // crecimiento por item

    const dynamicHeight = BASE_HEIGHT + detalle.length * ITEM_HEIGHT;
    const FINAL_HEIGHT = Math.max(BASE_HEIGHT, dynamicHeight);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=ticket-${venta.codigo}.pdf`,
    );

    const doc = new PDFDocument({
      size: [TICKET_WIDTH, FINAL_HEIGHT],
      margin: MARGIN,
    });

    doc.pipe(res);

    const CONTENT_WIDTH = TICKET_WIDTH - MARGIN * 2;

    const colLeft = MARGIN;
    const colCant = MARGIN + 8; // 👈 mover un poco a la derecha
    const colPrecio = 110;
    const colSub = 170; // 👈 un poco más a la derecha

    doc.lineWidth(0.5);

    /* =============================
       HELPERS
    ============================== */

    const drawSeparator = (bold = false) => {
      if (bold) doc.lineWidth(1);

      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(TICKET_WIDTH - MARGIN, doc.y)
        .stroke();

      doc.moveDown(0.6);

      if (bold) doc.lineWidth(0.5);
    };

    const textCenter = (text, size = 8, bold = false) => {
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(size)
        .text(text, {
          width: CONTENT_WIDTH,
          align: "center",
        });
    };

    const textLeft = (text, size = 8, bold = false) => {
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(size)
        .text(text, colLeft, doc.y, {
          width: CONTENT_WIDTH,
        });
    };

    const textPriceLine = (cantidad, precio, subtotal) => {
      const lineY = doc.y;

      doc.font("Helvetica").fontSize(8);

      //doc.text(`${cantidad} x`, colLeft, lineY);
      doc.text(`${cantidad} x`, colCant, lineY);

      doc.text(precio, colPrecio, lineY, {
        width: 50,
        align: "right",
      });

      doc.text(subtotal, colSub, lineY, {
        width: 50,
        align: "right",
      });

      doc.y = lineY + 14;
    };

    /* =============================
       HEADER
    ============================== */

    textCenter("TIENDA 3B", 12, true);
    textCenter("Valles Cruceños", 9);
    doc.moveDown(0.3);
    drawSeparator();

    /* =============================
       DATOS VENTA
    ============================== */

    textLeft(`Venta: ${venta.codigo}`);
    textLeft(`Fecha: ${formatearFechaCortaBO(venta.created_at)}`);
    textLeft(`Cliente: ${venta.cliente}`);
    textLeft(`Pago: ${venta.tipo_pago}`);

    doc.moveDown(0.3);
    drawSeparator();

    /* =============================
       DETALLE PRODUCTOS
    ============================== */

    let contador = 1;

    detalle.forEach((item) => {
      textLeft(`#${contador} ${item.producto_label}`, 8, true);

      doc.moveDown(0.2);

      textPriceLine(
        item.cantidad,
        formatearMoneda(item.precio_unitario),
        formatearMoneda(item.precio_subtotal),
      );

      contador++;
    });

    /* =============================
       TOTAL
    ============================== */

    drawSeparator(true);

    const totalY = doc.y;

    doc.font("Helvetica-Bold").fontSize(9);

    doc.text("TOTAL:", colLeft, totalY);

    doc.text(formatearMoneda(venta.total), colSub + 5, totalY, {
      width: 45,
      align: "right",
    });

    if (Number(venta.saldo) > 0) {
      doc.moveDown(0.5);

      const saldoY = doc.y;

      doc.text("SALDO:", colLeft, saldoY);

      doc.text(formatearMoneda(venta.saldo), colSub, saldoY, {
        width: 50,
        align: "right",
      });
    }

    doc.moveDown(1);
    drawSeparator();

    /* =============================
   FOOTER
============================= */

    doc.moveDown(0.8);

    doc.font("Helvetica").fontSize(7);

    doc.text(`Imp: ${formatearFechaCortaBO(new Date())}`, MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: "center",
    });

    doc.moveDown(0.4);

    doc.text("Gracias por su compra", MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: "center",
    });

    doc.end();
  } catch (error) {
    console.error("ERROR TICKET:", error);
    res.status(500).json({ message: "Error al generar Ticket" });
  }
};

export const anularVenta = async (req, res) => {
  const sucursalId = req.sucursalActiva;
  const { id } = req.params;
  const { motivo } = req.body;

  const usuarioId = req.user?.id || null;

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

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const nowUTC = getUTCDateTime();

    /* =====================================================
       1️⃣ BLOQUEAR VENTA
    ====================================================== */

    const [[venta]] = await conn.query(
      `SELECT *
       FROM ventas
       WHERE id = ?
       FOR UPDATE`,
      [id],
    );

    if (!venta) throw new Error("Venta no encontrada");

    if (venta.estado === "ANULADA") throw new Error("La venta ya está anulada");

    const sucursalId = venta.sucursal_id;
    const codigoVenta = venta.codigo;

    /* =====================================================
       2️⃣ OBTENER DETALLES + LOTES CONSUMIDOS
    ====================================================== */

    const [movimientos] = await conn.query(
      `SELECT 
          vd.id AS detalle_id,
          vd.producto_id,
          vd.cantidad AS cantidad_detalle,
          vl.lote_id,
          vl.cantidad AS cantidad_lote,
          vl.subtotal_costo
       FROM venta_detalle vd
       JOIN venta_lotes vl ON vl.venta_detalle_id = vd.id
       WHERE vd.venta_id = ?
       FOR UPDATE`,
      [id],
    );

    if (!movimientos.length)
      throw new Error("No se encontraron movimientos para revertir");

    /* =====================================================
       3️⃣ AGRUPAR POR PRODUCTO PARA STOCK Y KARDEX
    ====================================================== */

    const resumenProductos = {};

    for (const mov of movimientos) {
      const productoId = mov.producto_id;

      if (!resumenProductos[productoId]) {
        resumenProductos[productoId] = {
          cantidad: 0,
          totalCosto: 0,
        };
      }

      resumenProductos[productoId].cantidad += Number(mov.cantidad_lote);
      resumenProductos[productoId].totalCosto += Number(mov.subtotal_costo);
    }

    /* =====================================================
       4️⃣ REVERTIR LOTES (DEVOLVER A LOS MISMOS)
    ====================================================== */

    for (const mov of movimientos) {
      await conn.query(
        `UPDATE lotes
         SET cantidad_actual = cantidad_actual + ?
         WHERE id = ?`,
        [mov.cantidad_lote, mov.lote_id],
      );
    }

    /* =====================================================
       5️⃣ REVERTIR STOCK GENERAL
    ====================================================== */

    for (const productoId of Object.keys(resumenProductos)) {
      const cantidad = resumenProductos[productoId].cantidad;

      await conn.query(
        `UPDATE stock
         SET cantidad = cantidad + ?,
             updated_at = ?
         WHERE producto_id = ?
         AND sucursal_id = ?`,
        [cantidad, nowUTC, productoId, sucursalId],
      );
    }

    /* =====================================================
       6️⃣ INSERTAR KARDEX ENTRADA (REVERSIÓN)
    ====================================================== */

    for (const productoId of Object.keys(resumenProductos)) {
      const cantidad = resumenProductos[productoId].cantidad;
      const totalCosto = resumenProductos[productoId].totalCosto;

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

      const nuevoSaldoCantidad = saldoAnteriorCantidad + cantidad;
      const nuevoSaldoTotal = saldoAnteriorTotal + totalCosto;

      const costoUnitario = cantidad > 0 ? totalCosto / cantidad : 0;

      await conn.query(
        `INSERT INTO kardex
         (producto_id, sucursal_id,
          tipo, referencia,
          cantidad, costo_unitario,
          total, saldo_cantidad,
          saldo_total, created_at)
         VALUES (?, ?, 'ENTRADA', ?, ?, ?, ?, ?, ?, ?)`,
        [
          productoId,
          sucursalId,
          `ANULACION ${codigoVenta}`,
          cantidad,
          costoUnitario,
          totalCosto,
          nuevoSaldoCantidad,
          nuevoSaldoTotal,
          nowUTC,
        ],
      );
    }

    /* =====================================================
       7️⃣ REVERTIR PAGOS CLIENTE
    ====================================================== */

    const [pagos] = await conn.query(
      `SELECT id, monto
       FROM cliente_pagos
       WHERE venta_id = ?
       FOR UPDATE`,
      [id],
    );

    for (const pago of pagos) {
      await conn.query(
        `INSERT INTO cliente_pagos
         (venta_id, monto, fecha, created_at)
         VALUES (?, ?, ?, ?)`,
        [id, -Number(pago.monto), nowUTC.split(" ")[0], nowUTC],
      );
    }

    /* =====================================================
       8️⃣ ACTUALIZAR VENTA
    ====================================================== */

    await conn.query(
      `UPDATE ventas
       SET estado = 'ANULADA',
           estado_pago = 'PENDIENTE',
           saldo = 0,
           utilidad_total = 0,
           anulada_at = ?,
           anulada_by = ?,
           motivo_anulacion = ?,
           updated_at = ?
       WHERE id = ?`,
      [nowUTC, usuarioId, motivo || "Sin motivo especificado", nowUTC, id],
    );

    /* =====================================================
       9️⃣ AUDITORÍA
    ====================================================== */

    await conn.query(
      `INSERT INTO auditoria
       (tabla, registro_id, accion,
        detalle, usuario_id, created_at)
       VALUES (?, ?, 'ANULACION', ?, ?, ?)`,
      [
        "ventas",
        id,
        JSON.stringify({
          codigo: codigoVenta,
          motivo: motivo || null,
        }),
        usuarioId,
        nowUTC,
      ],
    );

    await conn.commit();

    res.json({
      message: "Venta anulada correctamente",
      codigo: codigoVenta,
    });
  } catch (error) {
    await conn.rollback();

    console.error("ERROR ANULAR VENTA:", error);

    res.status(400).json({
      message: error.message || "Error al anular venta",
    });
  } finally {
    conn.release();
  }
};
