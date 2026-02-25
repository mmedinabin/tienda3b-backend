import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { sucursalContext } from '../../middlewares/sucursal.middleware.js'
import { crearVenta, listarVentas, descargarVentaPDF,anularVenta} from './ventas.controller.js';

const router = Router();

router.get('/', authMiddleware, sucursalContext, listarVentas)
router.get(
  '/:id/pdf',
  authMiddleware,
  sucursalContext,
  descargarVentaPDF
)
router.post(
  '/',
  authMiddleware,
  checkPermiso('ventas', 'crear'),
  sucursalContext,
  crearVenta
);
router.put(
  '/:id/anular',
  authMiddleware,
  checkPermiso('ventas', 'eliminar'), // 👈 SOLO quien tenga permiso
  sucursalContext,
  anularVenta
);

export default router;