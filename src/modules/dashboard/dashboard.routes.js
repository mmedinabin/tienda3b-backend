import { Router } from "express";
import authMiddleware from "../../middlewares/auth.middleware.js";
import { sucursalContext } from "../../middlewares/sucursal.middleware.js";
import { obtenerDashboard } from "./dashboard.controller.js";

const router = Router();

router.get("/", authMiddleware, sucursalContext, obtenerDashboard);

export default router;
