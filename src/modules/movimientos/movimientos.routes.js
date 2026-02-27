import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { sucursalContext } from '../../middlewares/sucursal.middleware.js'
import { cargaInicialMovimiento, listarMovimientos, anularMovimiento, obtenerMovimientoPorId} from './movimientos.controller.js';

const router = Router();

router.get(
  '/',
  authMiddleware,
  checkPermiso('movimientos', 'ver'),
  sucursalContext,
  listarMovimientos
);
router.get(
  '/:id',
  authMiddleware,
  checkPermiso('movimientos', 'ver'),
  sucursalContext,
  obtenerMovimientoPorId
);

router.post(
  '/carga-inicial',
  authMiddleware,
  checkPermiso('movimientos', 'crear'),
  sucursalContext,
  cargaInicialMovimiento
);
router.put(
  '/:id/anular',
  authMiddleware,
  checkPermiso('movimientos', 'eliminar'),
  sucursalContext,
  anularMovimiento
);

export default router;