import { Router } from "express";
import authMiddleware from "../../middlewares/auth.middleware.js";
import { checkPermiso } from '../../middlewares/permisos.middleware.js';
import { sucursalContext } from "../../middlewares/sucursal.middleware.js";
import { obtenerDashboard } from "./dashboard.controller.js";

const router = Router();

router.get("/", authMiddleware, checkPermiso('DASHBOARD', 'ver'), sucursalContext, obtenerDashboard);

export default router;
