import axiosClient from '../../shared/api/axiosClient';

export const adminApi = {
  resumen: () => axiosClient.get('/admin/resumen'),
  usuarios: (q) => axiosClient.get('/admin/usuarios', { params: q ? { q } : {} }),
  // Sin fechas, todo lo registrado; con { desde, hasta } ("2026-10-01"), solo ese período.
  estadisticas: (periodo = {}) => axiosClient.get('/admin/estadisticas', { params: periodo }),
  // Las mismas estadísticas en un libro de Excel (llega como Blob): resumen, día por día, cada lugar por día, tesis y horas.
  estadisticasExcel: (periodo = {}) => axiosClient.get('/admin/estadisticas/excel', { params: periodo, responseType: 'blob' }),

  // Catálogo y documentos digitales: las listas vienen por páginas ({ items, total, pagina, porPagina, paginas }).
  tesis: (params) => axiosClient.get('/admin/tesis', { params }),
  actualizarDocumento: (id, datos) => axiosClient.patch(`/admin/tesis/${id}/documento`, datos),
  codigosQr: (params) => axiosClient.get('/admin/qr', { params }),
  actualizarQr: (id, cambios) => axiosClient.patch(`/admin/qr/${id}`, cambios),
  verificarQr: (id) => axiosClient.post(`/admin/qr/${id}/verificar`),
  revisionDeEnlaces: () => axiosClient.get('/admin/qr/revision'),
  revisarEnlaces: () => axiosClient.post('/admin/qr/revision'),
  catalogo: (params) => axiosClient.get('/admin/catalogo', { params }),
  crearTesis: (datos) => axiosClient.post('/admin/catalogo', datos),
  actualizarTesis: (id, datos) => axiosClient.patch(`/admin/catalogo/${encodeURIComponent(id)}`, datos),
  eliminarTesis: (id) => axiosClient.delete(`/admin/catalogo/${encodeURIComponent(id)}`),
  importarCatalogo: (datos) => axiosClient.post('/admin/catalogo/importar', datos),


  // Solo administrador
  personal: () => axiosClient.get('/admin/personal'),
  crearCuenta: (datos) => axiosClient.post('/admin/personal', datos),
  actualizarCuenta: (usuario, datos) => axiosClient.patch(`/admin/personal/${encodeURIComponent(usuario)}`, datos),
  restablecerClave: (usuario, clave) => axiosClient.post(`/admin/personal/${encodeURIComponent(usuario)}/clave`, { clave }),
  configuracion: () => axiosClient.get('/admin/configuracion'),
  guardarConfiguracion: (datos) => axiosClient.patch('/admin/configuracion', datos),
  actividad: (params) => axiosClient.get('/admin/actividad', { params }),
  almacenamiento: () => axiosClient.get('/admin/almacenamiento'),
  respaldo: () => axiosClient.get('/admin/respaldo', { responseType: 'blob' }),
  enviarRespaldo: () => axiosClient.post('/admin/respaldo/enviar'),
  correo: () => axiosClient.get('/admin/correo'),
  verificarCorreo: () => axiosClient.post('/admin/correo/verificar'),
  probarCorreo: (para) => axiosClient.post('/admin/correo/prueba', { para }),
  // Devuelve la dirección de Google donde se da el permiso; Google trae de vuelta a la sección Correo.
  conectarGmail: () => axiosClient.post('/admin/correo/gmail/conectar'),
  desconectarGmail: () => axiosClient.post('/admin/correo/gmail/desconectar'),
  horarios: () => axiosClient.get('/admin/horarios'),
  guardarHorarios: (datos) => axiosClient.put('/admin/horarios', datos),
  agregarCierre: (datos) => axiosClient.post('/admin/horarios/cierres', datos),
  quitarCierre: (id) => axiosClient.delete(`/admin/horarios/cierres/${id}`),
};
