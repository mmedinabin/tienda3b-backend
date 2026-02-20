import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';

import {
  listarClientes,
  crearCliente,
  actualizarCliente,
} from './clientes.controller.js';

import {
  crearClienteSchema,
  actualizarClienteSchema,
} from './clientes.validator.js';

const router = Router();

router.get(
  '/',
  authMiddleware,
  checkPermiso('clientes', 'ver'),
  listarClientes
);

router.post(
  '/',
  authMiddleware,
  checkPermiso('clientes', 'crear'),
  validate(crearClienteSchema),
  crearCliente
);

router.put(
  '/:id',
  authMiddleware,
  checkPermiso('clientes', 'editar'),
  validate(actualizarClienteSchema),
  actualizarCliente
);

export default router;
