const express = require('express');
const {
  getMotivos,
  getReglas,
  postSolicitud,
  getSolicitudes,
  getFoto,
  getConstancia,
  patchAprobar,
  patchRechazar,
  getResumen,
  getGuia,
  putGuia,
  postRestaurarGuia,
} = require('./solvencia_controller');
const { autenticar, requiereRol } = require('../auth/auth_middleware');

const router = express.Router();

// El personal que ve las solicitudes: administración y circulación.
const personal = [autenticar, requiereRol('administrador', 'circulacion')];
// Solo la administración ve las fotos y aprueba o rechaza.
const soloAdministrador = [autenticar, requiereRol('administrador')];

// Públicas: cualquier persona puede pedir su solvencia.
router.get('/motivos', getMotivos);
router.get('/reglas', getReglas);
router.get('/guia', getGuia);
router.post('/', postSolicitud);

// Solo personal autorizado.
router.get('/resumen', ...personal, getResumen);
router.put('/guia', ...soloAdministrador, putGuia);
router.post('/guia/restaurar', ...soloAdministrador, postRestaurarGuia);
router.get('/', ...personal, getSolicitudes);
router.get('/:id/fotos/:tipo', ...soloAdministrador, getFoto);
router.get('/:id/constancia', ...soloAdministrador, getConstancia);
router.patch('/:id/aprobar', ...soloAdministrador, patchAprobar);
router.patch('/:id/rechazar', ...soloAdministrador, patchRechazar);

module.exports = router;
