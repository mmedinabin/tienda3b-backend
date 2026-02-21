import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { uploadProducto } from '../../middlewares/uploadProducto.js'
import { sucursalContext } from '../../middlewares/sucursal.middleware.js'

import {
  listarProductos,
  obtenerProducto,
  crearProducto,
  actualizarProducto,
  cambiarEstadoProducto,
  cargarProductosPOS
} from './productos.controller.js';

const router = Router();
// 🔥 ESTA DEBE IR PRIMERO
router.get(
  '/pos',
  authMiddleware,
  sucursalContext,
  cargarProductosPOS
);

router.get(
  '/',
  authMiddleware,
  sucursalContext,
  checkPermiso('productos', 'ver'),
  listarProductos
);

router.get(
  '/:id',
  authMiddleware,
  sucursalContext,
  obtenerProducto
);

router.post(
  '/',
  authMiddleware,
  sucursalContext,
  uploadProducto.single('imagen'),
  checkPermiso('productos', 'crear'),
  crearProducto,
);

router.put(
  '/:id',
  authMiddleware,
  sucursalContext,
  uploadProducto.single('imagen'),
  checkPermiso('productos', 'editar'),
  actualizarProducto,
);

router.patch(
  '/:id/estado',
  authMiddleware,
  sucursalContext,
  checkPermiso('productos', 'editar'),
  cambiarEstadoProducto
)

export default router;
