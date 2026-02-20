import pool from "../../db/pool.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES } from "../../config/jwt.js";

/* =========================
   LOGIN
========================= */
export const login = async (req, res, next) => {
  try {
    const { login, password } = req.body;

    const [rows] = await pool.query(
      `
      SELECT id, username, nombre, password, 
             rol_id, sucursal_id, estado
      FROM usuarios
      WHERE email = ? OR username = ?
      `,
      [login, login],
    );

    if (!rows.length)
      return res.status(401).json({ message: "Credenciales inválidas" });

    const usuario = rows[0];

    if (!usuario.estado)
      return res.status(403).json({ message: "Usuario inactivo" });

    const match = await bcrypt.compare(password, usuario.password);
    if (!match)
      return res.status(401).json({ message: "Credenciales inválidas" });

    const token = jwt.sign(
      {
        id: usuario.id,
        rol_id: usuario.rol_id,
        sucursal_id: usuario.sucursal_id, // 👈 sucursal por defecto
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES },
    );

    res.json({ token });
  } catch (error) {
    console.error("🔥 ERROR LOGIN:", error);
    next(error);
  }
};

/* =========================
   PERFIL
========================= */
export const getPerfil = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [[usuario]] = await pool.query(
      `
  SELECT 
    u.id,
    u.username,
    u.nombre,
    u.rol_id,
    r.nombre AS rol,
    u.sucursal_id,
    s.codigo_sucursal,
    s.nombre AS sucursal_nombre,
    c.nombre AS ciudad
  FROM usuarios u
  JOIN roles r ON r.id = u.rol_id
  LEFT JOIN sucursales s ON s.id = u.sucursal_id
  LEFT JOIN ciudades c ON c.id = s.ciudad_id
  WHERE u.id = ?
  `,
      [userId],
    );

    const [permisos] = await pool.query(
      `
  SELECT 
    m.clave,
    rm.puede_ver,
    rm.puede_crear,
    rm.puede_editar,
    rm.puede_eliminar
  FROM rol_modulos rm
  JOIN modulos m ON m.id = rm.modulo_id
  WHERE rm.rol_id = ?
  `,
      [usuario.rol_id],
    );

    res.json({
      user: {
        ...usuario,
        esAdmin: usuario.rol === "ADMIN",
      },
      permisos,
    });
  } catch (error) {
    next(error);
  }
};
