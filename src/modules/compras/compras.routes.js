import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { sucursalContext } from '../../middlewares/sucursal.middleware.js'
import { crearCompra,listarCompras, descargarCompraPDF, anularCompra } from './compras.controller.js';

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
router.put(
  '/:id/anular',
  authMiddleware,
  checkPermiso('compras', 'eliminar'),
  sucursalContext,
  anularCompra
);

export default router;
