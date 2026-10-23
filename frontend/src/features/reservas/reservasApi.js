import axiosClient from '../../shared/api/axiosClient';

export const reservasApi = {
  disponibilidad: (tipo, fecha) => axiosClient.get(`/reservas/${tipo}/disponibilidad`, { params: { fecha } }),
  // Si hay servicio un día concreto y a qué horas se puede reservar (avisa de los días de cierre).
  diaDeHorario: (fecha) => axiosClient.get('/horarios/dia', { params: { fecha } }),
  // Cómo está cada día de un rango (cerrado o no y cuántas horas se reservan): el calendario marca los cierres.
  diasDeHorario: (desde, hasta) => axiosClient.get('/horarios/dias', { params: { desde, hasta } }),
  // La semana completa con las horas de reserva de cada día y los próximos cierres (para el inicio del sitio).
  horarioSemanal: () => axiosClient.get('/horarios/semana'),
  condiciones: () => axiosClient.get('/reservas/condiciones'),
  reservar: (tipo, datos) => axiosClient.post(`/reservas/${tipo}`, datos),
  listar: (tipo) => axiosClient.get('/reservas', { params: tipo ? { tipo } : {} }),
  avanzar: (id) => axiosClient.patch(`/reservas/item/${id}/avanzar`),
  cancelar: (id) => axiosClient.patch(`/reservas/item/${id}/cancelar`),
  liberar: (id) => axiosClient.patch(`/reservas/item/${id}/liberar`),
  // Quién no puede reservar por no haberse presentado, y quitarle la penalización.
  penalizaciones: () => axiosClient.get('/reservas/penalizaciones'),
  quitarPenalizacion: (id) => axiosClient.patch(`/reservas/item/${id}/quitar-penalizacion`),
  // Sanciones que pone el personal a mano: { identificacion, horas, motivo, reservaId? }; el historial de todas, y quitarlas.
  sancionar: (datos) => axiosClient.post('/reservas/sanciones', datos),
  sanciones: () => axiosClient.get('/reservas/sanciones'),
  quitarSancion: (id) => axiosClient.patch(`/reservas/sanciones/${id}/quitar`),
  // Libera de una vez a quienes no llegaron y ya pasó su hora de inicio (con la penalización por no presentarse).
  liberarNoLlegaron: () => axiosClient.post('/reservas/liberar-no-llegaron', {}),
  resumen: () => axiosClient.get('/reservas/resumen'),
};
