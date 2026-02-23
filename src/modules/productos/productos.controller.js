import pool from "../../db/pool.js";
import { guardarImagenProducto } from "../../utils/image.js";
import { getUTCDateTime } from "../../utils/date.js";

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

  const nowUTC = getUTCDateTime();

  /* =========================
     VALIDACIONES
  ========================= */

  if (!categoria_id)
    return res.status(400).json({ message: "Categoría es obligatoria" });

  if (!nombre || !nombre.trim())
    return res.status(400).json({ message: "Nombre es obligatorio" });

  if (!precioVenta || precioVenta <= 0)
    return res.status(400).json({ message: "Precio de venta inválido" });

  if (cantidadInicial < 0)
    return res.status(400).json({ message: "Stock inicial inválido" });

  if (cantidadInicial > 0) {
    if (sucursalId === null || sucursalId === undefined) {
      return res.status(400).json({
        message:
          "Debe seleccionar una sucursal específica para registrar la compra",
      });
    }

    if (costoUnitario <= 0)
      return res.status(400).json({ message: "Costo unitario inválido" });

    if (costoUnitario >= precioVenta)
      return res.status(400).json({
        message: "El costo unitario debe ser menor al precio de venta",
      });

    if (!Number.isInteger(cantidadInicial))
      return res.status(400).json({
        message: "La cantidad inicial debe ser entera",
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
      `,
    );

    if (!row) {
      await conn.query(
        `
        INSERT INTO secuencias (tipo, sucursal_id, ultimo_numero)
        VALUES ('PRODUCTO', 0, 0)
        `,
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
      [siguienteNumero],
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
       precio_venta, imagen, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        codigoGenerado,
        Number(categoria_id),
        marca_id ? Number(marca_id) : null,
        nombre.trim(),
        descripcion || null,
        tipo_presentacion || "UNIDAD",
        unidad_medida || null,
        Number(stock_minimo ?? 0),
        precioVenta,
        imagen,
        nowUTC,
      ],
    );

    const productoId = productoRes.insertId;

    /* =========================
       4️⃣ STOCK INICIAL (OPCIONAL)
    ========================= */

    if (cantidadInicial > 0) {
      // Fecha vencimiento plano (YYYY-MM-DD)
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
          productoId,
          sucursalId,
          fechaVencimientoPlano,
          costoUnitario,
          cantidadInicial,
          cantidadInicial,
          nowUTC,
        ],
      );

      const loteId = loteRes.insertId;

      // Actualizar resumen stock
      await conn.query(
        `
        INSERT INTO stock (producto_id, sucursal_id, cantidad, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          cantidad = cantidad + VALUES(cantidad),
          updated_at = VALUES(updated_at)
        `,
        [productoId, sucursalId, cantidadInicial, nowUTC, nowUTC],
      );

      // Movimiento stock
      await conn.query(
        `
        INSERT INTO movimientos_stock
        (tipo_movimiento, producto_id, sucursal_destino,
         lote_id, cantidad, costo_unitario, motivo,
         created_by, created_at)
        VALUES ('ENTRADA_INICIAL', ?, ?, ?, ?, ?, 'STOCK INICIAL', ?, ?)
        `,
        [
          productoId,
          sucursalId,
          loteId,
          cantidadInicial,
          costoUnitario,
          req.user?.id || null,
          nowUTC,
        ],
      );

      const totalMovimiento = cantidadInicial * costoUnitario;
      await conn.query(
        `
  INSERT INTO kardex
  (producto_id, sucursal_id, tipo, referencia,
   cantidad, costo_unitario, total,
   saldo_cantidad, saldo_total,
   created_at)
  VALUES (?, ?, 'ENTRADA', 'STOCK INICIAL',
          ?, ?, ?, ?, ?, ?)
  `,
        [
          productoId,
          sucursalId,
          cantidadInicial,
          costoUnitario,
          totalMovimiento,
          cantidadInicial, // saldo cantidad
          totalMovimiento, // saldo total
          nowUTC,
        ],
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
  const { id } = req.params;

  try {
    /* =========================
       VALIDAR EXISTENCIA
    ========================= */
    const [existe] = await pool.query(
      "SELECT id FROM productos WHERE id = ?",
      [id]
    );

    if (!existe.length) {
      return res.status(404).json({
        message: "Producto no encontrado",
      });
    }

    /* =========================
       VALIDACIONES
    ========================= */
    const precioVenta = Number(req.body.precio_venta);
    const stockMinimo = Number(req.body.stock_minimo);

    if (!req.body.categoria_id)
      return res.status(400).json({ message: "Categoría es obligatoria" });

    if (!req.body.nombre || !req.body.nombre.trim())
      return res.status(400).json({ message: "Nombre es obligatorio" });

    if (!precioVenta || precioVenta <= 0)
      return res.status(400).json({ message: "Precio inválido" });

    /* =========================
       IMAGEN (opcional)
    ========================= */
    let imagen = null;

    if (req.file) {
      imagen = await guardarImagenProducto(req.file.buffer);
    }

    /* =========================
       DATA LIMPIA
    ========================= */
    const data = {
      categoria_id: Number(req.body.categoria_id),
      marca_id: req.body.marca_id
        ? Number(req.body.marca_id)
        : null,
      nombre: req.body.nombre.trim(),
      descripcion: req.body.descripcion || null,
      tipo_presentacion: req.body.tipo_presentacion || "UNIDAD",
      unidad_medida: req.body.unidad_medida || null,
      stock_minimo: isNaN(stockMinimo) ? 0 : stockMinimo,
      precio_venta: precioVenta,
      updated_at: getUTCDateTime(),
    };

    if (imagen) {
      data.imagen = imagen;
    }

    /* =========================
       UPDATE
    ========================= */
    await pool.query(
      "UPDATE productos SET ? WHERE id = ?",
      [data, id]
    );

    return res.json({
      message: "Producto actualizado correctamente",
    });

  } catch (error) {
    console.error("ERROR ACTUALIZAR PRODUCTO:", error);

    return res.status(500).json({
      message: "Error al actualizar producto",
      error: error.message,
    });
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
      message: "Debe seleccionar una sucursal para ver los productos",
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
      [sucursalId],
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
