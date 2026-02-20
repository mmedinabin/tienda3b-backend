import { Router } from 'express';
import { listarCiudades, crearCiudad } from './ciudades.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { crearCiudadSchema } from './ciudades.validator.js';

const router = Router();

router.get('/', listarCiudades);
router.post('/', validate(crearCiudadSchema), crearCiudad);

export default router;
