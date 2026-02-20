export const getSucursalOperativa = (req) => {
  const usuario = req.user;

  // Si NO es admin → usar sucursal fija
  if (usuario.rol_id !== 1) {
    return usuario.sucursal_id;
  }

  // Si es ADMIN → usar header
  const sucursalHeader = Number(req.headers['x-sucursal-id']);

  return sucursalHeader || usuario.sucursal_id || null;
};