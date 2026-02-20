import { Router } from "express";

import authMiddleware from '../../middlewares/auth.middleware.js';
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { sucursalContext } from '../../middlewares/sucursal.middleware.js'
import { listarStock } from "./stock.controller.js";

const router = Router();

router.get("/", authMiddleware, sucursalContext, listarStock);

export default router;
