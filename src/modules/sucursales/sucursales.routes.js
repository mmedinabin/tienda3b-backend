import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  listarSucursales,
  crearSucursal,
  actualizarSucursal,
} from './sucursales.controller.js';
import {
  crearSucursalSchema,
  actualizarSucursalSchema,
} from './sucursales.validator.js';

const router = Router();

router.get(
  '/',
  authMiddleware,
  checkPermiso('sucursales', 'ver'),
  listarSucursales
);

router.post(
  '/',
  authMiddleware,
  checkPermiso('sucursales', 'crear'),
  validate(crearSucursalSchema),
  crearSucursal
);

router.put(
  '/:id',
  authMiddleware,
  checkPermiso('sucursales', 'editar'),
  validate(actualizarSucursalSchema),
  actualizarSucursal
);

export default router;