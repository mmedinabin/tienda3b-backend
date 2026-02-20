USE minimarket_pos;

CREATE TABLE roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    descripcion VARCHAR(255),
    estado BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL
);

CREATE TABLE modulos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100),
    clave VARCHAR(50) UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rol_modulos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rol_id INT,
    modulo_id INT,
    puede_ver BOOLEAN DEFAULT 1,
    puede_crear BOOLEAN DEFAULT 0,
    puede_editar BOOLEAN DEFAULT 0,
    puede_eliminar BOOLEAN DEFAULT 0
);

CREATE TABLE usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rol_id INT,
    email VARCHAR(150) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    nombre VARCHAR(150),
    google_id VARCHAR(255),
    estado BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL
);

CREATE TABLE password_resets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT,
    token VARCHAR(255),
    expira_en DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sucursales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150),
    direccion VARCHAR(255),
    telefono VARCHAR(50),
    estado BOOLEAN DEFAULT 1,
    created_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL
);

CREATE TABLE empleados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT,
    sucursal_id INT,
    nombres VARCHAR(150),
    ci VARCHAR(50),
    sueldo DECIMAL(10,2),
    en_planilla BOOLEAN DEFAULT 1,
    estado BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL
);

CREATE TABLE anticipos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    empleado_id INT,
    monto DECIMAL(10,2),
    fecha DATE,
    observacion VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE planillas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    empleado_id INT,
    mes INT,
    anio INT,
    sueldo_base DECIMAL(10,2),
    total_anticipos DECIMAL(10,2),
    total_pagar DECIMAL(10,2),
    fecha_pago DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE proveedores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150),
    nit VARCHAR(150),
    ci VARCHAR(150),
    contacto VARCHAR(150),
    telefono VARCHAR(50),
    email VARCHAR(150),
	estado BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categorias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150),
    estado BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE productos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    categoria_id INT,
    codigo VARCHAR(100) UNIQUE,
    nombre VARCHAR(200),
    unidad_medida VARCHAR(50),
    imagen VARCHAR(255),
    stock_minimo INT DEFAULT 0,
    precio_venta DECIMAL(10,2),
    estado BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL
);

CREATE TABLE clientes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tipo ENUM('NATURAL','EMPRESA') DEFAULT 'NATURAL',
    nombre VARCHAR(200) NOT NULL,
    documento VARCHAR(50),      -- CI / NIT
    telefono VARCHAR(50),
    email VARCHAR(500),
    direccion VARCHAR(255),
    estado BOOLEAN DEFAULT 1,
    created_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL
);

CREATE TABLE compras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    proveedor_id INT,
    sucursal_id INT,
    tipo_pago ENUM('CONTADO','CREDITO'),
    total DECIMAL(10,2),
    saldo DECIMAL(10,2),
    created_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE compra_detalle (
    id INT AUTO_INCREMENT PRIMARY KEY,
    compra_id INT,
    producto_id INT,
    cantidad INT,
    costo_unitario DECIMAL(10,2),
    costo_subtotal DECIMAL(10,2)
);

CREATE TABLE lotes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    producto_id INT NOT NULL,
    sucursal_id INT NOT NULL,
    compra_detalle_id INT NOT NULL,
    lote_codigo VARCHAR(100) NULL,
    fecha_vencimiento DATE NULL, -- OPCIONAL (solo alerta)
    costo_unitario DECIMAL(10,2) NOT NULL,
    cantidad_inicial INT NOT NULL,
    cantidad_actual INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE compra_pagos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    compra_id INT,
    monto DECIMAL(10,2),
    fecha DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ventas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sucursal_id INT,
    cliente_id INT NULL,
    tipo_pago ENUM('EFECTIVO','TRANSFERENCIA','CREDITO'),
    estado_pago ENUM('PENDIENTE','PAGADO') DEFAULT 'PAGADO',
    total DECIMAL(10,2),
    saldo DECIMAL(10,2),
    created_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE venta_detalle (
    id INT AUTO_INCREMENT PRIMARY KEY,
    venta_id INT,
    producto_id INT,
    lote_id INT,
    cantidad INT,
    costo_unitario DECIMAL(10,2),
    precio_unitario DECIMAL(10,2),
    precio_subtotal DECIMAL(10,2)
);

CREATE TABLE cliente_pagos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    venta_id INT,
    monto DECIMAL(10,2),
    fecha DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stock (
    id INT AUTO_INCREMENT PRIMARY KEY,
    producto_id INT,
    sucursal_id INT,
    cantidad INT,
    precio_venta DECIMAL(10,2) NOT NULL,
    monto_total DECIMAL(12,2) GENERATED ALWAYS AS (cantidad * precio_venta) STORED,
    UNIQUE (producto_id, sucursal_id),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE movimientos_stock (
    id INT AUTO_INCREMENT PRIMARY KEY,
    producto_id INT,
    sucursal_origen INT,
    sucursal_destino INT,
    lote_id INT NULL,
    cantidad INT,
    costo_unitario DECIMAL(10,2) NULL,
    motivo VARCHAR(255),
    created_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auditoria (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tabla VARCHAR(100),
    registro_id INT,
    accion ENUM('INSERT','UPDATE','DELETE'),
    detalle JSON NULL,
    usuario_id INT,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP
);