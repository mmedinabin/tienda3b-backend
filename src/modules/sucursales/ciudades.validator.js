import { z } from 'zod';

export const crearCiudadSchema = z.object({
  nombre: z.string().min(3),
  codigo: z.string().min(2).max(10),
});
