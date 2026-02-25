import { Router } from 'express';
import {
  listarUsuarios,
  obtenerUsuario,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
} from './usuarios.controller.js'
import authMiddleware from '../../middlewares/auth.middleware.js'
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { crearUsuarioSchema } from './usuarios.validator.js';

const router = Router();

router.get('/', authMiddleware, checkPermiso('USUARIOS', 'ver'), listarUsuarios)
router.get('/:id', authMiddleware, checkPermiso('usuarios', 'ver'), obtenerUsuario)

router.post(
  '/',
  authMiddleware,
  checkPermiso('usuarios', 'crear'),
  validate(crearUsuarioSchema),
  crearUsuario,
)
router.put('/:id', authMiddleware, checkPermiso('usuarios', 'editar'), actualizarUsuario)
router.delete('/:id', authMiddleware, checkPermiso('usuarios', 'eliminar'), eliminarUsuario)

export default router;
