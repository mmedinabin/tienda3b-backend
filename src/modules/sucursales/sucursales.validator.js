import { z } from 'zod';

export const crearSucursalSchema = z.object({
  ciudad_id: z.number(),
  nombre: z.string().min(3),
  direccion: z.string().min(5),
  telefono: z.string().optional(),
});

export const actualizarSucursalSchema = z.object({
  nombre: z.string().min(3).optional(),
  direccion: z.string().min(5).optional(),
  telefono: z.string().optional(),
  estado: z.coerce.boolean().optional(),
});
