import { Router } from 'express';
import { login, getPerfil } from './auth.controller.js';
import authMiddleware from '../../middlewares/auth.middleware.js'

const router = Router();

router.post('/login', login);
router.get('/perfil', authMiddleware, getPerfil)

export default router;
