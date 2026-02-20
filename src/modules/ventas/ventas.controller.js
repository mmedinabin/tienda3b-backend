import pool from "../../db/pool.js";

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

    /*1️⃣ GENERAR CÓDIGO DE VENTA (SIN SALTOS) */
    // 1. Obtener datos de la sucursal
    const [[sucursal]] = await conn.query(
      `SELECT codigo_sucursal FROM sucursales WHERE id = ?`,
      [sucursalId],
    );

    if (!sucursal) {
      throw new Error("Sucursal no válida");
    }

    // 2. Bloquear fila de secuencia
    let [[row]] = await conn.query(
      `SELECT ultimo_numero
   FROM secuencias
   WHERE tipo = 'VENTA'
   AND sucursal_id = ?
   FOR UPDATE`,
      [sucursalId],
    );

    // 3. Si no existe secuencia, crearla
    if (!row) {
      await conn.query(
        `INSERT INTO secuencias (tipo, sucursal_id, ultimo_numero)
     VALUES ('VENTA', ?, 0)`,
        [sucursalId],
      );

      row = { ultimo_numero: 0 };
    }

    // 4. Calcular siguiente número
    const siguienteNumero = row.ultimo_numero + 1;

    // 5. Actualizar secuencia
    await conn.query(
      `UPDATE secuencias
   SET ultimo_numero = ?
   WHERE tipo = 'VENTA'
   AND sucursal_id = ?`,
      [siguienteNumero, sucursalId],
    );

    // 6. Generar código final
    const codigo = `V-${sucursal.codigo_sucursal}-${String(
      siguienteNumero,
    ).padStart(5, "0")}`;

    /* =====================================================
       2️⃣ CALCULAR TOTAL VENTA
    ====================================================== */

    const totalVenta = productos.reduce(
      (acc, p) => acc + Number(p.cantidad) * Number(p.precio_venta),
      0,
    );

    if (totalVenta <= 0) {
      throw new Error("Total de venta inválido");
    }

    if (tipo_pago === "CREDITO") {
      if (Number(abono_inicial || 0) > totalVenta) {
        throw new Error("Abono no puede ser mayor al total");
      }
    }

    const saldo =
      tipo_pago === "CREDITO" ? totalVenta - Number(abono_inicial || 0) : 0;

    const estado_pago =
      tipo_pago === "CREDITO" && saldo > 0 ? "PENDIENTE" : "PAGADO";

    /* =====================================================
       3️⃣ INSERTAR VENTA
    ====================================================== */

    const [ventaRes] = await conn.query(
      `INSERT INTO ventas
      (codigo, sucursal_id, cliente_id,
       tipo_pago, estado_pago,
       total, saldo,
       created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        codigo,
        sucursalId,
        cliente_id || null,
        tipo_pago,
        estado_pago,
        totalVenta,
        saldo,
        req.user?.id || null,
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

      if (cantidadVenta <= 0 || precioVenta <= 0) {
        throw new Error("Cantidad o precio inválido");
      }

      await conn.query(`SELECT id FROM productos WHERE id = ? FOR UPDATE`, [
        productoId,
      ]);

      // 🔴 VALIDACIÓN CRÍTICA — validar stock general
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

      /* ---- Buscar lotes FIFO ---- */

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

        const consumir = Math.min(cantidadRestante, disponible);

        const subtotalCosto = consumir * Number(lote.costo_unitario);

        /* ---- Registrar consumo lote ---- */

        await conn.query(
          `INSERT INTO venta_lotes
           (venta_detalle_id, lote_id,
            cantidad, costo_unitario, subtotal_costo)
           VALUES (?, ?, ?, ?, ?)`,
          [detalleId, lote.id, consumir, lote.costo_unitario, subtotalCosto],
        );

        /* ---- Descontar lote ---- */

        await conn.query(
          `UPDATE lotes
           SET cantidad_actual = cantidad_actual - ?
           WHERE id = ?`,
          [consumir, lote.id],
        );

        cantidadRestante -= consumir;
        costoTotalProducto += subtotalCosto;
      }

      if (cantidadRestante > 0) {
        throw new Error(`Stock insuficiente para producto ${productoId}`);
      }

      /* ---- Actualizar stock general ---- */
      await conn.query(
        `UPDATE stock
         SET cantidad = cantidad - ?
         WHERE producto_id = ?
         AND sucursal_id = ?`,
        [cantidadVenta, productoId, sucursalId],
      );

      // 🟡 MEJORA promedio seguro
      const costoUnitarioPromedio = cantidadVenta > 0 ? costoTotalProducto / cantidadVenta : 0;

      /* ---- Kardex SALIDA ---- */
      await conn.query(
        `INSERT INTO kardex
        (producto_id, sucursal_id,
         tipo, referencia,
         cantidad, costo_unitario, total)
        VALUES (?, ?, 'SALIDA', ?, ?, ?, ?)`,
        [
          productoId,
          sucursalId,
          codigo,
          cantidadVenta,
          costoUnitarioPromedio,
          costoTotalProducto,
        ],
      );

      /* ---- Calcular utilidad ---- */

      const ingresoProducto = cantidadVenta * precioVenta;

      const utilidadProducto = ingresoProducto - costoTotalProducto;

      utilidadTotal += utilidadProducto;
    }

    /* =====================================================
       5️⃣ ACTUALIZAR UTILIDAD TOTAL
    ====================================================== */

    await conn.query(
      `UPDATE ventas
       SET utilidad_total = ?
       WHERE id = ?`,
      [utilidadTotal, ventaId],
    );

    await conn.commit();

    res.status(201).json({
      message: "Venta registrada correctamente",
      codigo,
      utilidad: utilidadTotal,
    });
  } catch (error) {
    await conn.rollback();

    // 🟡 MEJORA manejo deadlock
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
