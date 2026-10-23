const express = require('express');
const {
  getDisponibilidad,
  getCondiciones,
  postReserva,
  getReservas,
  patchAvanzar,
  patchCancelar,
  patchLiberar,
  getPenalizaciones,
  patchQuitarPenalizacion,
  postSancion,
  patchQuitarSancion,
  getSanciones,
  postLiberarNoLlegaron,
  getResumen,
} = require('./reservas_controller');
const { autenticar, requiereRol } = require('../auth/auth_middleware');

const router = express.Router();

// El personal que atiende reservas: administración y circulación.
const personal = [autenticar, requiereRol('administrador', 'circulacion')];

// Del personal, pero van antes que «POST /:tipo» (la reserva pública), que si no las tomaría como un tipo de lugar.
router.post('/sanciones', ...personal, postSancion);
router.post('/liberar-no-llegaron', ...personal, postLiberarNoLlegaron);

// Públicas: las usa cualquier persona desde el kiosco o desde su celular.
router.get('/condiciones', getCondiciones);
router.get('/:tipo/disponibilidad', getDisponibilidad);
router.post('/:tipo', postReserva);

// Solo personal autorizado: muestran datos de las personas o cambian el estado de una reserva.
router.get('/resumen', ...personal, getResumen);
router.get('/', ...personal, getReservas);
router.get('/penalizaciones', ...personal, getPenalizaciones);
router.patch('/item/:id/avanzar', ...personal, patchAvanzar);
router.patch('/item/:id/cancelar', ...personal, patchCancelar);
router.patch('/item/:id/liberar', ...personal, patchLiberar);
router.patch('/item/:id/quitar-penalizacion', ...personal, patchQuitarPenalizacion);
router.get('/sanciones', ...personal, getSanciones);
router.patch('/sanciones/:id/quitar', ...personal, patchQuitarSancion);

module.exports = router;
