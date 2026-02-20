import { Router } from 'express'
import authMiddleware from '../../middlewares/auth.middleware.js'
import { checkPermiso } from '../../middlewares/permisos.middleware.js'

import {
  listarCategorias,
  listarCategoriasActivas,
  crearCategoria,
  actualizarCategoria,
} from './categorias.controller.js'

const router = Router()

router.get(
  '/',
  authMiddleware,
  checkPermiso('categorias', 'ver'),
  listarCategorias
)

// 🔴 ESTE ES EL QUE FALTA
router.get(
  '/activas',
  authMiddleware,
  listarCategoriasActivas
)

router.post(
  '/',
  authMiddleware,
  checkPermiso('categorias', 'crear'),
  crearCategoria
)

router.put(
  '/:id',
  authMiddleware,
  checkPermiso('categorias', 'editar'),
  actualizarCategoria
)

export default router
