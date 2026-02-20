import { z } from 'zod'

const emptyToNull = (val) => (val === '' ? null : val)

export const crearProveedorSchema = z.object({
  nombre: z.string().min(3, 'Nombre mínimo 3 caracteres'),

  telefono: z
    .string()
    .min(5, 'Teléfono obligatorio')
    .transform(emptyToNull),

  nit: z
    .string()
    .optional()
    .transform(emptyToNull),

  ci: z
    .string()
    .optional()
    .transform(emptyToNull),

  contacto: z
    .string()
    .optional()
    .transform(emptyToNull),

  email: z
    .string()
    .optional()
    .transform((val) => (val === '' ? null : val))
    .refine(
      (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      { message: 'Email inválido' }
    ),
})


export const actualizarProveedorSchema = z.object({
  nombre: z.string().min(3).optional(),
  telefono: z.string().min(5).optional(),

  nit: z.string().optional().transform(emptyToNull),
  ci: z.string().optional().transform(emptyToNull),
  contacto: z.string().optional().transform(emptyToNull),
  email: z
    .string()
    .optional()
    .transform(emptyToNull)
    .refine(
      (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      { message: 'Email inválido' }
    ),

  estado: z.coerce.boolean().optional(),
})