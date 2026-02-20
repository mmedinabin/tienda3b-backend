import puppeteer from "puppeteer";
import pool from "../db/pool.js";

export const generarDocumentoPDF = async (tipo, id, esMovil = false) => {
  const conn = await pool.getConnection();

  try {
    let cabeceraQuery = "";
    let detalleQuery = "";

    if (tipo === "COMPRA") {
      cabeceraQuery = `
        SELECT 
          c.codigo,
          c.created_at AS fecha,
          c.tipo_pago,
          c.total,
          c.saldo,
          p.nombre AS tercero
        FROM compras c
        JOIN proveedores p ON p.id = c.proveedor_id
        WHERE c.id = ?
      `;

      detalleQuery = `
        SELECT 
          pr.nombre,
          cd.cantidad,
          cd.costo_unitario,
          cd.costo_subtotal
        FROM compra_detalle cd
        JOIN productos pr ON pr.id = cd.producto_id
        WHERE cd.compra_id = ?
      `;
    }

    if (tipo === "VENTA") {
      cabeceraQuery = `
        SELECT 
          v.codigo,
          v.created_at AS fecha,
          v.tipo_pago,
          v.total,
          v.saldo,
          c.nombre AS tercero
        FROM ventas v
        JOIN clientes c ON c.id = v.cliente_id
        WHERE v.id = ?
      `;

      detalleQuery = `
        SELECT 
          pr.nombre,
          vd.cantidad,
          vd.precio_unitario,
          vd.subtotal
        FROM venta_detalle vd
        JOIN productos pr ON pr.id = vd.producto_id
        WHERE vd.venta_id = ?
      `;
    }

    const [[cabecera]] = await conn.query(cabeceraQuery, [id]);
    const [detalle] = await conn.query(detalleQuery, [id]);

    if (!cabecera) throw new Error("Documento no encontrado");

    /* ================= HTML TEMPLATE ================= */

    const html = `
<html>
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 40px;
      color: #333;
    }

    .header {
      text-align: center;
      margin-bottom: 20px;
    }

    .empresa {
      font-size: 16px;
      font-weight: bold;
    }

    .documento-titulo {
      font-size: 20px;
      font-weight: bold;
      margin-top: 10px;
    }

    .info {
      margin-top: 20px;
      font-size: 13px;
    }

    .info p {
      margin: 3px 0;
    }

    hr {
      margin: 20px 0;
      border: none;
      border-top: 1px solid #ccc;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 12px;
    }

    th {
      background-color: #f0f0f0;
      padding: 8px;
      text-align: left;
      border: 1px solid #ddd;
    }

    td {
      padding: 8px;
      border: 1px solid #ddd;
    }

    .text-center {
      text-align: center;
    }

    .text-right {
      text-align: right;
    }

    .totales {
      margin-top: 25px;
      width: 300px;
      float: right;
      font-size: 13px;
    }

    .totales table {
      width: 100%;
      border-collapse: collapse;
    }

    .totales td {
      border: none;
      padding: 4px 0;
    }

    .totales .linea {
      border-top: 1px solid #000;
      margin-top: 5px;
    }

    .footer {
      margin-top: 60px;
      font-size: 11px;
      text-align: center;
      color: #777;
    }

  </style>
</head>

<body>

  <div class="header">
    <div class="empresa">MI EMPRESA S.R.L.</div>
    <div>NIT: 123456789</div>
    <div>Santa Cruz - Bolivia</div>

    <div class="documento-titulo">${tipo}</div>
  </div>

  <div class="info">
    <p><strong>Código:</strong> ${cabecera.codigo}</p>
    <p><strong>Fecha:</strong> ${new Date(cabecera.fecha).toLocaleDateString()}</p>
    <p><strong>${tipo === "COMPRA" ? "Proveedor" : "Cliente"}:</strong> ${cabecera.tercero}</p>
    <p><strong>Tipo pago:</strong> ${cabecera.tipo_pago}</p>
  </div>

  <hr/>

  <table>
    <thead>
      <tr>
        <th style="width:5%">#</th>
        <th>Producto</th>
        <th style="width:15%">Cantidad</th>
        <th style="width:20%">${tipo === "COMPRA" ? "Costo Unit." : "Precio Unit."}</th>
        <th style="width:20%">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${detalle
        .map(
          (d, i) => `
        <tr>
          <td class="text-center">${i + 1}</td>
          <td>${d.nombre}</td>
          <td class="text-center">${d.cantidad}</td>
          <td class="text-right">Bs ${Number(tipo === "COMPRA" ? d.costo_unitario : d.precio_unitario).toFixed(2)}</td>
          <td class="text-right">Bs ${Number(tipo === "COMPRA" ? d.costo_subtotal : d.subtotal).toFixed(2)}</td>
        </tr>
      `,
        )
        .join("")}
    </tbody>
  </table>

  <div class="totales">
    <table>
      <tr>
        <td><strong>Total:</strong></td>
        <td class="text-right"><strong>Bs ${Number(cabecera.total).toFixed(2)}</strong></td>
      </tr>
      <tr>
        <td>Saldo:</td>
        <td class="text-right">Bs ${Number(cabecera.saldo).toFixed(2)}</td>
      </tr>
    </table>
    <div class="linea"></div>
  </div>

  <div class="footer">
    Documento generado automáticamente por el sistema
  </div>

</body>
</html>
`;

    /* ================= GENERAR PDF ================= */

    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    await browser.close();

    return {
      buffer: pdf,
      codigo: cabecera.codigo,
    };
  } finally {
    conn.release();
  }
};
