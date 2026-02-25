import { Router } from 'express'
import authMiddleware from '../../middlewares/auth.middleware.js'
import { reporteComprasDetalle } from './reportescompra.controller.js'
import { reporteVentasDetalle } from './reportesventa.controller.js'


const router = Router()

router.get('/compras-detalle', authMiddleware, reporteComprasDetalle)
router.get('/ventas-detalle', authMiddleware, reporteVentasDetalle)

export default router