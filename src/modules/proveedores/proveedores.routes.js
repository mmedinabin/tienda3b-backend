import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';

import {
  listarProveedores,
  crearProveedor,
  actualizarProveedor,
} from './proveedores.controller.js';

import {
  crearProveedorSchema,
  actualizarProveedorSchema,
} from './proveedores.validator.js';

const router = Router();

router.get(
  '/',
  authMiddleware,
  checkPermiso('proveedores', 'ver'),
  listarProveedores
);

router.post(
  '/',
  authMiddleware,
  checkPermiso('proveedores', 'crear'),
  validate(crearProveedorSchema),
  crearProveedor
);

router.put(
  '/:id',
  authMiddleware,
  checkPermiso('proveedores', 'editar'),
  validate(actualizarProveedorSchema),
  actualizarProveedor
);

export default router;