import { fechaYHora } from '../../shared/utils/fechas';

// Textos y colores de los estados que muestra el panel.
export const ESTADO_RESERVA = {
  reservado: { tone: 'warning', label: 'Reservado' },
  en_uso: { tone: 'accent', label: 'En uso' },
  finalizado: { tone: 'status', label: 'Finalizado' },
  cancelado: { tone: 'danger', label: 'Cancelado' },
  liberada: { tone: 'neutral', label: 'Liberada' },
};

export const MOTIVO_LIBERACION = {
  no_presentado: 'No se presentó dentro del tiempo de tolerancia',
  manual: 'Liberada por el personal',
};

export const TIPO_RESERVA = { cubiculo: 'Cubículo', estacion: 'Estación', sala_lectura: 'Sala de lectura' };

export const SIGUIENTE_RESERVA = { reservado: 'Sellar ingreso', en_uso: 'Sellar salida' };

export const ESTADO_SOLVENCIA = {
  pendiente: { tone: 'warning', label: 'Pendiente' },
  en_revision: { tone: 'warning', label: 'Pendiente' }, // estado de versiones anteriores: se resuelve igual que una pendiente
  aprobada: { tone: 'status', label: 'Aprobada' },
  rechazada: { tone: 'danger', label: 'Rechazada' },
};



// Roles del personal, con lo que puede hacer cada uno (propuesta, sección 4.5.6).
export const ROLES_DEL_PERSONAL = {
  administrador: { nombre: 'Administrador', descripcion: 'Gestión completa y configuración general' },
  circulacion: { nombre: 'Personal de circulación', descripcion: 'Reservas, usuarios y consulta de solicitudes' },
  tesis: { nombre: 'Personal de tesis', descripcion: 'Documentos digitales y códigos QR' },
  consulta: { nombre: 'Consulta', descripcion: 'Solo estadísticas' },
};

// Cómo se lee cada acción de la bitácora de actividad (el servidor guarda códigos como "reserva.cancelada").
export const ACCIONES_DE_ACTIVIDAD = {
  'acceso.iniciado': 'Inició sesión',
  'acceso.cerrado': 'Cerró sesión',
  'reserva.avanzada': 'Cambió el estado de una reserva',
  'reserva.cancelada': 'Canceló una reserva',
  'reserva.liberada': 'Liberó un lugar reservado',
  'reserva.salida_anticipada': 'Registró una salida antes de tiempo',
  'reserva.penalizada': 'Penalizó a alguien por no presentarse',
  'reserva.penalizacion_quitada': 'Quitó una penalización por no presentarse',
  'solicitud.avanzada': 'Avanzó una solicitud de solvencia',
  'solicitud.aprobada': 'Aprobó una solicitud de solvencia',
  'solicitud.rechazada': 'Rechazó una solicitud de solvencia',
  'tesis.documento': 'Cambió el documento digital de una tesis',
  'qr.estado': 'Cambió el estado de un código QR',
  'qr.destino': 'Cambió a dónde lleva un código QR',
  'qr.verificado': 'Verificó un código QR',
  'qr.revision': 'Revisión de los enlaces de las tesis',
  'catalogo.creada': 'Agregó una tesis al catálogo',
  'catalogo.actualizada': 'Modificó una tesis del catálogo',
  'catalogo.eliminada': 'Eliminó una tesis del catálogo',
  'catalogo.importado': 'Importó tesis al catálogo',
  'horarios.actualizados': 'Cambió los horarios de reserva',
  'horarios.cierre_agregado': 'Registró un día de cierre',
  'horarios.cierre_quitado': 'Quitó un día de cierre',
  'personal.creada': 'Creó una cuenta del personal',
  'personal.actualizada': 'Modificó una cuenta del personal',
  'personal.clave': 'Restableció la clave de una cuenta',
  'cuenta.clave': 'Cambió su propia clave',
  'configuracion.cambiada': 'Cambió la configuración',
  'correo.prueba': 'Envió un correo de prueba',
  'respaldo.descargado': 'Descargó un respaldo de los datos',
  'respaldo.enviado': 'Se envió un respaldo por correo',
  'respaldo.fallido': 'No se pudo enviar el respaldo por correo',
};

// Los correos que manda el sistema (sección Correo): de qué eran y cómo les fue.
export const TIPO_DE_CORREO = {
  reserva: 'Confirmación de reserva',
  solvencia: 'Solicitud de solvencia',
  solvencia_aprobada: 'Solvencia aprobada (con constancia)',
  solvencia_rechazada: 'Solvencia rechazada',
  comprobante: 'Comprobante a pedido',
  reserva_cancelada: 'Reserva cancelada',
  reserva_liberada: 'Reserva liberada',
  prueba: 'Correo de prueba',
  respaldo: 'Respaldo de los datos',
};

export const ESTADO_DE_CORREO = {
  enviado: { tone: 'status', label: 'Enviado' },
  simulado: { tone: 'neutral', label: 'Simulado' },
  fallido: { tone: 'danger', label: 'Falló' },
};

export const CATEGORIAS_DE_ACTIVIDAD = {
  acceso: 'Acceso',
  reserva: 'Reservas',
  solicitud: 'Solvencias',
  tesis: 'Tesis digitales',
  qr: 'Códigos QR',
  catalogo: 'Catálogo',
  horarios: 'Horarios',
  personal: 'Cuentas del personal',
  cuenta: 'Cuenta propia',
  configuracion: 'Configuración',
  correo: 'Correo',
  respaldo: 'Respaldos',
};

// Fecha y hora legibles para una marca de tiempo ISO, en hora de la biblioteca.
export function fechaLegible(iso) {
  if (!iso) return '—';
  const { fecha, hora } = fechaYHora(iso);
  return `${fecha} ${hora}`;
}
