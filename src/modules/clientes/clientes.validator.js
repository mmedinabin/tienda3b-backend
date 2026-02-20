import { z } from "zod";

const emptyToNull = (val) => (val === "" ? null : val);

export const crearClienteSchema = z.object({
  tipo: z.enum(["NATURAL", "EMPRESA"]).default("NATURAL"),

  nombre: z.string().min(3),

  documento: z.string().optional().transform(emptyToNull),

  telefono: z.string().optional().transform(emptyToNull),

  email: z
    .string()
    .optional()
    .transform(emptyToNull)
    .refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
      message: "Email inválido",
    }),

  direccion: z.string().optional().transform(emptyToNull),
});

export const actualizarClienteSchema = z.object({
  tipo: z.enum(["NATURAL", "EMPRESA"]).optional(),

  nombre: z.string().min(3).optional(),

  documento: z.string().optional().transform(emptyToNull),

  telefono: z.string().optional().transform(emptyToNull),

  email: z
    .string()
    .optional()
    .transform(emptyToNull)
    .refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
      message: "Email inválido",
    }),

  direccion: z.string().optional().transform(emptyToNull),

  estado: z.coerce.boolean().optional(),
});
