import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { sucursalContext } from '../../middlewares/sucursal.middleware.js'
import { crearVenta, listarVentas} from './ventas.controller.js';

const router = Router();

router.get('/', authMiddleware, sucursalContext, listarVentas)
router.get(
  '/:id/pdf',
  authMiddleware,
  sucursalContext,
)
router.post(
  '/',
  authMiddleware,
  checkPermiso('ventas', 'crear'),
  sucursalContext,
  crearVenta
);

export default router;