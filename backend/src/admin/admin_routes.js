const express = require('express');
const {
  getResumen,
  getUsuarios,
  getTesis,
  postTesis,
  patchTesis,
  deleteTesis,
  postImportar,
  patchDocumento,
  patchQr,
  postVerificarQr,
  getRevisionDeEnlaces,
  postRevisionDeEnlaces,
  getEstadisticas,
  getEstadisticasExcel,
} = require('./admin_controller');
const { getHorarios, putHorarios, postCierre, deleteCierre } = require('./horarios_controller');
const { getPersonal, postPersonal, patchPersonal, postClavePersonal } = require('./personal_controller');
const { getConfiguracion, patchConfiguracion } = require('./configuracion_controller');
const { getActividad } = require('./actividad_controller');
const { getCorreo, postVerificar, postPrueba } = require('./correo_controller');
const { getAlmacenamiento, getRespaldo, postEnviarRespaldo } = require('./almacenamiento_controller');
const { autenticar, requiereRol } = require('../auth/auth_middleware');

const router = express.Router();

// Qué rol entra a qué sección (propuesta, sección 4.5.6).
const circulacion = [autenticar, requiereRol('administrador', 'circulacion')];
const tesis = [autenticar, requiereRol('administrador', 'tesis')];
const estadisticas = [autenticar, requiereRol('administrador', 'consulta')];
const soloAdministrador = [autenticar, requiereRol('administrador')];

router.get('/resumen', autenticar, getResumen);
router.get('/usuarios', ...circulacion, getUsuarios);
router.get('/tesis', ...tesis, getTesis);
router.get('/catalogo', ...tesis, getTesis);
router.post('/catalogo/importar', ...tesis, postImportar);
router.post('/catalogo', ...tesis, postTesis);
router.patch('/catalogo/:id', ...tesis, patchTesis);
router.delete('/catalogo/:id', ...soloAdministrador, deleteTesis);
router.patch('/tesis/:id/documento', ...tesis, patchDocumento);
router.get('/qr', ...tesis, getTesis);
router.get('/qr/revision', ...tesis, getRevisionDeEnlaces);
router.post('/qr/revision', ...tesis, postRevisionDeEnlaces);
router.patch('/qr/:id', ...tesis, patchQr);
router.post('/qr/:id/verificar', ...tesis, postVerificarQr);
router.get('/estadisticas', ...estadisticas, getEstadisticas);
router.get('/estadisticas/excel', ...estadisticas, getEstadisticasExcel);

// Administración: cuentas del personal, configuración general y registro de actividad.
router.get('/personal', ...soloAdministrador, getPersonal);
router.post('/personal', ...soloAdministrador, postPersonal);
router.patch('/personal/:usuario', ...soloAdministrador, patchPersonal);
router.post('/personal/:usuario/clave', ...soloAdministrador, postClavePersonal);
router.get('/configuracion', ...soloAdministrador, getConfiguracion);
router.patch('/configuracion', ...soloAdministrador, patchConfiguracion);
router.get('/actividad', ...soloAdministrador, getActividad);
router.get('/almacenamiento', ...soloAdministrador, getAlmacenamiento);
router.get('/respaldo', ...soloAdministrador, getRespaldo);
router.post('/respaldo/enviar', ...soloAdministrador, postEnviarRespaldo);
router.get('/correo', ...soloAdministrador, getCorreo);
router.post('/correo/verificar', ...soloAdministrador, postVerificar);
router.post('/correo/prueba', ...soloAdministrador, postPrueba);
router.get('/horarios', ...soloAdministrador, getHorarios);
router.put('/horarios', ...soloAdministrador, putHorarios);
router.post('/horarios/cierres', ...soloAdministrador, postCierre);
router.delete('/horarios/cierres/:id', ...soloAdministrador, deleteCierre);


module.exports = router;
