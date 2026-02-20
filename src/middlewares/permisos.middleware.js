import pool from '../db/pool.js';

export const checkPermiso = (modulo, accion) => {
  return async (req, res, next) => {
    const rolId = req.user.rol_id;

    const campo = {
      ver: 'puede_ver',
      crear: 'puede_crear',
      editar: 'puede_editar',
      eliminar: 'puede_eliminar'
    }[accion];

    const [rows] = await pool.query(`
      SELECT rm.${campo}
      FROM rol_modulos rm
      JOIN modulos m ON m.id = rm.modulo_id
      WHERE rm.rol_id = ? AND m.clave = ?
    `, [rolId, modulo]);

    if (!rows.length || !rows[0][campo]) {
      return res.status(403).json({ message: 'Permiso denegado' });
    }

    next();
  };
};
