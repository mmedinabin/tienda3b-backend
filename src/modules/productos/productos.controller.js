import pool from "../../db/pool.js";
import { guardarImagenProducto } from "../../utils/image.js";

export const listarProductos = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT 
      p.id,
      p.codigo,
      p.nombre,
      m.nombre AS marca,
      p.descripcion,
      p.tipo_presentacion,
      p.unidad_medida,
      p.imagen,
      p.precio_venta,
      p.estado,
      c.nombre AS categoria
    FROM productos p
    JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN marcas m ON m.id = p.marca_id
    ORDER BY p.codigo ASC
  `);
  res.json(rows);
};

export const obtenerProducto = async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM productos WHERE id = ?", [
    req.params.id,
  ]);
  res.json(rows[0]);
};

// export const crearProducto = async (req, res) => {
//   const {
//     categoria_id,
//     marca_id,
//     nombre,
//     descripcion,
//     tipo_presentacion,
//     unidad_medida,
//     stock_minimo,
//     precio_venta,
//     stock_inicial,
//     costo_inicial,
//     fecha_vencimiento,
//   } = req.body;

//   const sucursalId = req.sucursalActiva;

//   const cantidadInicial = Number(stock_inicial || 0);
//   const costoUnitario = Number(costo_inicial || 0);
//   const precioVenta = Number(precio_venta || 0);

//   /* ======================================================
//      🔎 VALIDACIONES DE NEGOCIO (ANTES DE TRANSACCIÓN)
//   ====================================================== */

//   if (!categoria_id) {
//     return res.status(400).json({ message: "Categoría es obligatoria" });
//   }

//   if (!nombre || !nombre.trim()) {
//     return res.status(400).json({ message: "Nombre es obligatorio" });
//   }

//   if (!precioVenta || precioVenta <= 0) {
//     return res.status(400).json({ message: "Precio de venta inválido" });
//   }

//   if (cantidadInicial > 0) {
//     if (sucursalId === null || sucursalId === undefined) {
//       return res.status(400).json({
//         message: "Debe seleccionar sucursal activa para crear stock inicial",
//       });
//     }

//     if (costoUnitario <= 0) {
//       return res.status(400).json({
//         message: "Costo unitario inválido",
//       });
//     }

//     if (costoUnitario >= precioVenta) {
//       return res.status(400).json({
//         message: "El costo unitario debe ser menor al precio de venta",
//       });
//     }
//   }

//   /* ======================================================
//      🔄 INICIO DE TRANSACCIÓN
//   ====================================================== */

//   const conn = await pool.getConnection();

//   try {
//     await conn.beginTransaction();

//     let imagen = "default.png";
//     if (req.file) {
//       imagen = await guardarImagenProducto(req.file.buffer);
//     }

//     /* =========================
//        1️⃣ INSERTAR PRODUCTO
//     ========================= */

//     const [productoRes] = await conn.query(
//       `
//       INSERT INTO productos
//       (categoria_id, marca_id, nombre, descripcion, tipo_presentacion, unidad_medida, stock_minimo, precio_venta, imagen)
//       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
//       `,
//       [
//         Number(categoria_id),
//         marca_id ? Number(marca_id) : null,
//         nombre.trim(),
//         descripcion || null,
//         tipo_presentacion || "UNIDAD",
//         unidad_medida,
//         Number(stock_minimo ?? 1),
//         precioVenta,
//         imagen,
//       ],
//     );

//     const productoId = productoRes.insertId;

//     /* =========================
//        2️⃣ GENERAR CÓDIGO INTERNO
//     ========================= */
//     // 1. Buscar secuencia PRODUCTO global (sucursal_id = 0)
//     let [[row]] = await conn.query(
//       `SELECT ultimo_numero 
//    FROM secuencias 
//    WHERE tipo = 'PRODUCTO' AND sucursal_id = 0
//    FOR UPDATE`,
//     );

//     // 2. Si no existe, crearla automáticamente
//     if (!row) {
//       await conn.query(
//         `INSERT INTO secuencias (tipo, sucursal_id, ultimo_numero)
//      VALUES ('PRODUCTO', 0, 0)`,
//       );

//       row = { ultimo_numero: 0 };
//     }

//     // 3. Calcular siguiente número
//     const siguienteNumero = row.ultimo_numero + 1;

//     // 4. Actualizar secuencia
//     await conn.query(
//       `UPDATE secuencias
//    SET ultimo_numero = ?
//    WHERE tipo = 'PRODUCTO' AND sucursal_id = 0`,
//       [siguienteNumero],
//     );

//     // 5. Generar código final
//     const codigoGenerado = `P-${String(siguienteNumero).padStart(4, "0")}`;

//     //const codigoGenerado = `P-${String(productoId).padStart(4, "0")}`;

//     // 6. Actualizar producto con código
//     await conn.query(`UPDATE productos SET codigo = ? WHERE id = ?`, [
//       codigoGenerado,
//       productoId,
//     ]);
//     // await conn.query(`UPDATE productos SET codigo = ? WHERE id = ?`, [
//     //   codigoGenerado,
//     //   productoId,
//     // ]);

//     /* =========================
//        3️⃣ STOCK INICIAL (OPCIONAL)
//     ========================= */

//     if (cantidadInicial > 0) {
//       const [loteRes] = await conn.query(
//         `
//         INSERT INTO lotes (
//           producto_id,
//           sucursal_id,
//           origen,
//           fecha_vencimiento,
//           costo_unitario,
//           cantidad_inicial,
//           cantidad_actual
//         ) VALUES (?, ?, 'INICIAL', ?, ?, ?, ?)
//         `,
//         [
//           productoId,
//           sucursalId,
//           fecha_vencimiento || null,
//           costoUnitario,
//           cantidadInicial,
//           cantidadInicial,
//         ],
//       );

//       const loteId = loteRes.insertId;

//       await conn.query(
//         `
//         INSERT INTO stock (producto_id, sucursal_id, cantidad)
//         VALUES (?, ?, ?)
//         ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad)
//         `,
//         [productoId, sucursalId, cantidadInicial],
//       );

//       await conn.query(
//         `
//         INSERT INTO movimientos_stock
//         (tipo_movimiento, producto_id, sucursal_destino, lote_id, cantidad, costo_unitario, motivo, created_by)
//         VALUES ('TRANSFERENCIA_ENTRADA', ?, ?, ?, ?, ?, 'STOCK INICIAL', ?)
//         `,
//         [
//           productoId,
//           sucursalId,
//           loteId,
//           cantidadInicial,
//           costoUnitario,
//           req.user?.id || null,
//         ],
//       );

//       await conn.query(
//         `
//         INSERT INTO kardex
//         (producto_id, sucursal_id, tipo, referencia, cantidad, costo_unitario, total)
//         VALUES (?, ?, 'ENTRADA', 'STOCK INICIAL', ?, ?, ?)
//         `,
//         [
//           productoId,
//           sucursalId,
//           cantidadInicial,
//           costoUnitario,
//           cantidadInicial * costoUnitario,
//         ],
//       );
//     }

//     /* =========================
//        ✅ CONFIRMAR TRANSACCIÓN
//     ========================= */

//     await conn.commit();

//     return res.status(201).json({
//       message: "Producto creado correctamente",
//       producto: {
//         id: productoId,
//         codigo: codigoGenerado,
//         nombre: nombre.trim(),
//         descripcion: descripcion || null,
//         precio_venta: precioVenta,
//         unidad_medida,
//         tipo_presentacion: tipo_presentacion || "UNIDAD",
//       },
//     });
//     // return res.status(201).json({
//     //   message: "Producto creado correctamente",
//     //   codigo: codigoGenerado,
//     // });
//   } catch (error) {
//     await conn.rollback();
//     console.error("ERROR CREAR PRODUCTO:", error);

//     return res.status(400).json({
//       message: error.message,
//       sqlMessage: error.sqlMessage,
//       code: error.code,
//     });
//   } finally {
//     conn.release();
//   }
// };

export const crearProducto = async (req, res) => {
  const {
    categoria_id,
    marca_id,
    nombre,
    descripcion,
    tipo_presentacion,
    unidad_medida,
    stock_minimo,
    precio_venta,
    stock_inicial,
    costo_inicial,
    fecha_vencimiento,
  } = req.body;

  const sucursalId = req.sucursalActiva;

  const cantidadInicial = Number(stock_inicial || 0);
  const costoUnitario = Number(costo_inicial || 0);
  const precioVenta = Number(precio_venta || 0);

  if (!categoria_id)
    return res.status(400).json({ message: "Categoría es obligatoria" });

  if (!nombre || !nombre.trim())
    return res.status(400).json({ message: "Nombre es obligatorio" });

  if (!precioVenta || precioVenta <= 0)
    return res.status(400).json({ message: "Precio de venta inválido" });

  if (cantidadInicial > 0) {
    if (!sucursalId)
      return res.status(400).json({
        message: "Debe seleccionar sucursal activa para crear stock inicial",
      });

    if (costoUnitario <= 0)
      return res.status(400).json({ message: "Costo unitario inválido" });

    if (costoUnitario >= precioVenta)
      return res.status(400).json({
        message: "El costo unitario debe ser menor al precio de venta",
      });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    /* =========================
       1️⃣ GENERAR CÓDIGO PRODUCTO
    ========================= */

    let [[row]] = await conn.query(
      `
      SELECT ultimo_numero
      FROM secuencias
      WHERE tipo = 'PRODUCTO' AND sucursal_id = 0
      FOR UPDATE
      `
    );

    if (!row) {
      await conn.query(
        `
        INSERT INTO secuencias (tipo, sucursal_id, ultimo_numero)
        VALUES ('PRODUCTO', 0, 0)
        `
      );
      row = { ultimo_numero: 0 };
    }

    const siguienteNumero = row.ultimo_numero + 1;

    await conn.query(
      `
      UPDATE secuencias
      SET ultimo_numero = ?
      WHERE tipo = 'PRODUCTO' AND sucursal_id = 0
      `,
      [siguienteNumero]
    );

    const codigoGenerado = `P-${String(siguienteNumero).padStart(4, "0")}`;

    /* =========================
       2️⃣ IMAGEN
    ========================= */

    let imagen = "default.png";
    if (req.file) {
      imagen = await guardarImagenProducto(req.file.buffer);
    }

    /* =========================
       3️⃣ INSERTAR PRODUCTO
    ========================= */

    const [productoRes] = await conn.query(
      `
      INSERT INTO productos
      (codigo, categoria_id, marca_id, nombre, descripcion,
       tipo_presentacion, unidad_medida, stock_minimo,
       precio_venta, imagen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        codigoGenerado,
        Number(categoria_id),
        marca_id ? Number(marca_id) : null,
        nombre.trim(),
        descripcion || null,
        tipo_presentacion || "UNIDAD",
        unidad_medida,
        Number(stock_minimo ?? 1),
        precioVenta,
        imagen,
      ]
    );

    const productoId = productoRes.insertId;

    /* =========================
       4️⃣ STOCK INICIAL (OPCIONAL)
    ========================= */

    if (cantidadInicial > 0) {
      const [loteRes] = await conn.query(
        `
        INSERT INTO lotes (
          producto_id,
          sucursal_id,
          origen,
          fecha_vencimiento,
          costo_unitario,
          cantidad_inicial,
          cantidad_actual
        )
        VALUES (?, ?, 'INICIAL', ?, ?, ?, ?)
        `,
        [
          productoId,
          sucursalId,
          fecha_vencimiento || null,
          costoUnitario,
          cantidadInicial,
          cantidadInicial,
        ]
      );

      const loteId = loteRes.insertId;

      await conn.query(
        `
        INSERT INTO stock (producto_id, sucursal_id, cantidad)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad)
        `,
        [productoId, sucursalId, cantidadInicial]
      );

      await conn.query(
        `
        INSERT INTO movimientos_stock
        (tipo_movimiento, producto_id, sucursal_destino,
         lote_id, cantidad, costo_unitario, motivo, created_by)
        VALUES ('TRANSFERENCIA_ENTRADA', ?, ?, ?, ?, ?, 'STOCK INICIAL', ?)
        `,
        [
          productoId,
          sucursalId,
          loteId,
          cantidadInicial,
          costoUnitario,
          req.user?.id || null,
        ]
      );

      await conn.query(
        `
        INSERT INTO kardex
        (producto_id, sucursal_id, tipo, referencia,
         cantidad, costo_unitario, total)
        VALUES (?, ?, 'ENTRADA', 'STOCK INICIAL', ?, ?, ?)
        `,
        [
          productoId,
          sucursalId,
          cantidadInicial,
          costoUnitario,
          cantidadInicial * costoUnitario,
        ]
      );
    }

    /* =========================
       ✅ CONFIRMAR
    ========================= */

    await conn.commit();

    return res.status(201).json({
      message: "Producto creado correctamente",
      producto: {
        id: productoId,
        codigo: codigoGenerado,
        nombre: nombre.trim(),
        precio_venta: precioVenta,
        unidad_medida,
      },
    });

  } catch (error) {
    await conn.rollback();
    console.error("ERROR CREAR PRODUCTO:", error);

    return res.status(400).json({
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
    });

  } finally {
    conn.release();
  }
};



export const actualizarProducto = async (req, res) => {
  try {
    const { id } = req.params;

    let imagen = null;

    if (req.file) {
      imagen = await guardarImagenProducto(req.file.buffer);
    }

    const data = {
      categoria_id: Number(req.body.categoria_id),
      marca_id: Number(req.body.marca_id),
      nombre: req.body.nombre,
      descripcion: req.body.descripcion,
      tipo_presentacion: req.body.tipo_presentacion,
      unidad_medida: req.body.unidad_medida,
      stock_minimo: Number(req.body.stock_minimo),
      precio_venta: Number(req.body.precio_venta),
      updated_at: new Date(),
    };

    if (imagen) {
      data.imagen = imagen;
    }

    await pool.query("UPDATE productos SET ? WHERE id = ?", [data, id]);

    res.json({ message: "Producto actualizado correctamente" });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: "Error al actualizar producto" });
  }
};

export const cambiarEstadoProducto = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (typeof estado === "undefined") {
      return res.status(400).json({ message: "Estado es requerido" });
    }

    await pool.query(
      "UPDATE productos SET estado = ?, updated_at = ? WHERE id = ?",
      [estado, new Date(), id],
    );

    res.json({ message: "Estado actualizado correctamente" });
  } catch (error) {
    console.error("ERROR CAMBIAR ESTADO:", error);
    res.status(400).json({ message: "Error al actualizar estado" });
  }
};


export const cargarProductosPOS = async (req, res) => {
  const sucursalId = req.sucursalActiva;

if (sucursalId === null || sucursalId === undefined) {
    return res.status(400).json({
      message:
        "Debe seleccionar una sucursal para ver los productos",
    });
  }

try {
    const [rows] = await pool.query(
      `
      SELECT 
        p.id,
        p.codigo,
        p.nombre,
        COALESCE(m.nombre, '') AS marca,
        COALESCE(p.descripcion, '') AS descripcion,
        p.precio_venta,
        s.cantidad AS stock
      FROM stock s
      JOIN productos p ON p.id = s.producto_id
      LEFT JOIN marcas m ON m.id = p.marca_id
      WHERE s.sucursal_id = ?
        AND s.cantidad > 0
        AND p.estado = 1
      ORDER BY p.nombre
      `,
      [sucursalId]
    );

    const productos = rows.map((p) => ({
      ...p,
      precio_venta: Number(p.precio_venta),
      stock: Number(p.stock),
    }));

    res.json(productos);

    //res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error POS" });
  }
};
