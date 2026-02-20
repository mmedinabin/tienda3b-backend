import { z } from 'zod';

export const crearUsuarioSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6),
  nombre: z.string().min(3),
  rol_id: z.coerce.number().int(),
  sucursal_id: z.coerce.number().int().nullable().optional(),
});
