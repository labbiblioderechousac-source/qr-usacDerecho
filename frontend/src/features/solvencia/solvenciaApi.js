import axiosClient from '../../shared/api/axiosClient';

export const solvenciaApi = {
  motivos: () => axiosClient.get('/solvencia/motivos'),
  // Motivos, días máximos de anticipación, cuándo se entregaría una solicitud enviada ahora y cuánto puede pesar cada foto.
  reglas: () => axiosClient.get('/solvencia/reglas'),
  solicitar: (datos) => axiosClient.post('/solvencia', datos),
  listar: () => axiosClient.get('/solvencia'),
  resumen: () => axiosClient.get('/solvencia/resumen'),
  // Las fotos y la constancia se piden con la sesión (no tienen dirección pública): llegan como Blob.
  foto: (id, tipo) => axiosClient.get(`/solvencia/${id}/fotos/${tipo}`, { responseType: 'blob' }),
  constancia: (id) => axiosClient.get(`/solvencia/${id}/constancia`, { responseType: 'blob' }),
  // `guardadas`: dónde quedó cada foto en la PC de la biblioteca ({ comprobante, orden_de_pago }).
  aprobar: (id, guardadas) => axiosClient.patch(`/solvencia/${id}/aprobar`, { guardadas }),
  rechazar: (id, observacion, guardadas) => axiosClient.patch(`/solvencia/${id}/rechazar`, { observacion, guardadas }),
  // «Cómo hacer tu solvencia»: los videos y los pasos. La lee cualquiera; solo el administrador la cambia o vuelve a la original.
  guia: () => axiosClient.get('/solvencia/guia'),
  guardarGuia: (guia) => axiosClient.put('/solvencia/guia', guia),
  restaurarGuia: () => axiosClient.post('/solvencia/guia/restaurar'),
};
