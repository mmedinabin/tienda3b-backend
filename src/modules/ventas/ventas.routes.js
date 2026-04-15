import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { sucursalContext } from '../../middlewares/sucursal.middleware.js'
import { crearVenta,obtenerVenta, listarVentas, descargarVentaPDF,anularVenta, reemplazarVenta} from './ventas.controller.js';

const router = Router();

router.get('/', authMiddleware, sucursalContext, listarVentas)
router.get(
  '/:id',
  authMiddleware,
  sucursalContext,
  obtenerVenta
);
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
  checkPermiso('ventas', 'eliminar'),
  sucursalContext,
  anularVenta
);

router.put(
  '/:id/reemplazar',
  authMiddleware,
  checkPermiso('ventas', 'crear'),
  sucursalContext,
  reemplazarVenta
)

export default router;