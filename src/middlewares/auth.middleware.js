import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/jwt.js'

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token requerido' })
  }

  const token = header.split(' ')[1]

  try {
    const decoded = jwt.verify(token, JWT_SECRET)

    req.user = decoded
    next()

  } catch (error) {
    return res.status(401).json({ message: 'Token inválido o expirado' })
  }
}

export default authMiddleware
