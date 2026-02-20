import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { sucursalContext } from '../../middlewares/sucursal.middleware.js'
import { crearCompra,listarCompras, descargarCompraPDF } from './compras.controller.js';

const router = Router();

router.get('/', authMiddleware, sucursalContext, listarCompras)
router.get(
  '/:id/pdf',
  authMiddleware,
  sucursalContext,
  descargarCompraPDF
)
router.post(
  '/',
  authMiddleware,
  checkPermiso('compras', 'crear'),
  sucursalContext,
  crearCompra
);

export default router;
