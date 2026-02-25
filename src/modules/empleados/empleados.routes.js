import { Router } from 'express'
import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import {
  crearEmpleado,
  listarEmpleados,
  cambiarEstadoEmpleado,
  listarUsuariosDisponibles,
  obtenerEmpleado,
  actualizarEmpleado
} from './empleados.controller.js'

const router = Router()

router.use(authMiddleware)

router.get(
  '/',
  authMiddleware,
  checkPermiso('empleados', 'ver'),
  listarEmpleados
);


router.get('/usuarios-disponibles', listarUsuariosDisponibles)
router.get('/:id', obtenerEmpleado)
router.put('/:id', actualizarEmpleado)
router.post('/', crearEmpleado)
router.patch('/:id/estado', cambiarEstadoEmpleado)

export default router
