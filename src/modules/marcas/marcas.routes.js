import { Router } from 'express'
import authMiddleware from '../../middlewares/auth.middleware.js'
import { checkPermiso } from '../../middlewares/permisos.middleware.js'

import { listarMarcas,
    crearMarca
} from './marcas.controller.js'

const router = Router()

router.get(
  '/',
  authMiddleware,
  checkPermiso('marcas', 'ver'),
  listarMarcas
)

router.post(
  '/',
  authMiddleware,
  checkPermiso('marcas', 'crear'),
  crearMarca
)

export default router
