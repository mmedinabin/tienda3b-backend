import { z } from 'zod';

export const crearProductoSchema = z.object({
  categoria_id: z.number().int(),
  marca_id: z.coerce.number().optional(),
  nombre: z.string().min(3),
  descripcion: z.string().optional(),
  tipo_presentacion: z.enum(['UNIDAD','CAJA','GRANEL']),
  unidad_medida: z.enum(['PZA','KG','LT','GR']),
  stock_minimo: z.number().optional(),
  precio_venta: z.number(),
});

export const actualizarProductoSchema = z.object({
  categoria_id: z.number().int().optional(),
  marca_id: z.coerce.number().nullable().optional(),
  nombre: z.string().optional(),
  descripcion: z.string().optional(),
  tipo_presentacion: z.enum(['UNIDAD','CAJA','GRANEL']).optional(),
  unidad_medida: z.enum(['PZA','KG','LT','GR']).optional(),
  stock_minimo: z.number().optional(),
  precio_venta: z.number().optional(),
  estado: z.coerce.boolean().optional(),
});