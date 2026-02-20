export const validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    res.status(400).json({
      message: 'Datos inválidos',
      errors: error.errors
    });
  }
};
