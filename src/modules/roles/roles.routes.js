import { Router } from 'express'
import pool from '../../db/pool.js'
import authMiddleware from '../../middlewares/auth.middleware.js'
//import { auth } from '../../middlewares/auth.middleware.js'

const router = Router()

// Obtener roles activos
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, nombre
      FROM roles
      WHERE estado = 1
      ORDER BY nombre
    `)
    res.json(rows)
  } catch (error) {
    next(error)
  }
})

export default router
