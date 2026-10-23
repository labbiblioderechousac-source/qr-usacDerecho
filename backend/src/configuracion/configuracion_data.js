const almacen = require('../../utils/almacen');
const { rechazo } = require('../../utils/errores');
const { CONDICIONES } = require('../reservas/recursos_data');

// Ajustes generales que el administrador puede cambiar sin tocar el código (propuesta, sección 4.5.6:
// "configuración general"). Arrancan con los valores de recursos_data.js y se guardan en el almacén de datos.
const TIPOS_DE_RESERVA = ['cubiculo', 'estacion', 'sala_lectura'];
const TOLERANCIA_MINIMA = 5;
const TOLERANCIA_MAXIMA = 60;
const HORAS_MAXIMAS = 12; // el tope que el administrador puede fijar: más que eso ya no es una reserva de estudio
const PENALIZACION_MAXIMA = 168; // una semana sin poder reservar es el castigo más largo por no presentarse

const NOMBRE_DEL_SERVICIO = { cubiculo: 'cubículos', estacion: 'estaciones', sala_lectura: 'la sala de lectura' };

// Datos de una tesis que el administrador puede marcar como importantes (además de los obligatorios: código, título, autor y año).
// Una tesis que no trae alguno se registra igual, porque a veces la entregan así, pero queda marcada como incompleta para que el
// personal la encuentre y la complete después. Los demás datos (programa, institución, colección...) tienen siempre un valor por defecto.
const CAMPOS_DE_TESIS = { director: 'Director(a)', paginas: 'Páginas', temas: 'Temas', resumen: 'Resumen', signatura: 'Signatura topográfica' };
const CAMPOS_IMPORTANTES_INICIALES = ['director', 'paginas', 'temas', 'resumen'];
const nombresDe = (campos) => (campos.length > 0 ? campos.map((c) => CAMPOS_DE_TESIS[c].toLowerCase()).join(', ') : 'ninguno');

// Tras cuántos minutos sin tocar la pantalla se cierra la sesión del panel, para cada rol. 0 es «nunca»: la sesión queda abierta en esa
// PC hasta que la persona salga (útil para la PC de la administración, que tiene que estar atenta a las solicitudes que llegan).
const ROLES = { administrador: 'administración', circulacion: 'circulación', tesis: 'tesis', consulta: 'consulta' };
const MINUTOS_DE_INACTIVIDAD = [0, 10, 20, 30, 60, 120, 240, 480];
const INACTIVIDAD_INICIAL = { administrador: 0, circulacion: 20, tesis: 20, consulta: 20 };
const textoDeMinutos = (minutos) => (minutos === 0 ? 'nunca' : `${minutos} min`);

// Dónde se puede llenar el formulario de solicitud de solvencia. En el kiosco de la entrada no hay cámara para las fotos del pago: la
// administración puede quitar ahí la opción y el kiosco muestra los pasos y un código QR para hacerla desde el celular.
const CANALES_DE_SOLVENCIA = { web: 'la web', kiosco: 'los kioscos' };
const SOLVENCIA_INICIAL = { web: true, kiosco: true };

const INICIAL = {
  toleranciaMinutos: CONDICIONES.toleranciaMinutos,
  horasDePenalizacion: CONDICIONES.horasDePenalizacion,
  maxHorasPorReserva: CONDICIONES.maxHorasPorReserva,
  maxHorasPorDia: CONDICIONES.maxHorasPorDia,
  reservasPausadas: Object.fromEntries(TIPOS_DE_RESERVA.map((tipo) => [tipo, false])),
  camposImportantes: CAMPOS_IMPORTANTES_INICIALES,
  minutosDeInactividad: INACTIVIDAD_INICIAL,
  solvenciaDisponible: SOLVENCIA_INICIAL,
  actualizadaEn: null,
  actualizadaPor: null,
};

// Lo guardado manda; lo que falte (por ejemplo un tipo de lugar nuevo) se completa con los valores iniciales.
const guardado = almacen.cargar('configuracion', INICIAL);
const estado = {
  ...INICIAL,
  ...guardado,
  reservasPausadas: { ...INICIAL.reservasPausadas, ...guardado.reservasPausadas },
  minutosDeInactividad: { ...INACTIVIDAD_INICIAL, ...guardado.minutosDeInactividad },
  solvenciaDisponible: { ...SOLVENCIA_INICIAL, ...guardado.solvenciaDisponible },
};
// Los topes de horas se llamaban «cubiculoMaxHorasPor...» cuando solo valían para los cubículos: se conservan los valores guardados.
if (guardado.maxHorasPorReserva === undefined && guardado.cubiculoMaxHorasPorReserva !== undefined) {
  estado.maxHorasPorReserva = guardado.cubiculoMaxHorasPorReserva;
}
if (guardado.maxHorasPorDia === undefined && guardado.cubiculoMaxHorasPorDia !== undefined) {
  estado.maxHorasPorDia = guardado.cubiculoMaxHorasPorDia;
}
delete estado.cubiculoMaxHorasPorReserva;
delete estado.cubiculoMaxHorasPorDia;
// Se conservan en el orden de CAMPOS_DE_TESIS y sin datos que ya no existan.
const ordenados = (campos) => Object.keys(CAMPOS_DE_TESIS).filter((c) => campos.includes(c));
estado.camposImportantes = ordenados(Array.isArray(estado.camposImportantes) ? estado.camposImportantes : CAMPOS_IMPORTANTES_INICIALES);

function obtener() {
  return {
    toleranciaMinutos: estado.toleranciaMinutos,
    horasDePenalizacion: estado.horasDePenalizacion,
    maxHorasPorReserva: estado.maxHorasPorReserva,
    maxHorasPorDia: estado.maxHorasPorDia,
    reservasPausadas: { ...estado.reservasPausadas },
    camposImportantes: [...estado.camposImportantes],
    camposDeTesis: Object.entries(CAMPOS_DE_TESIS).map(([campo, nombre]) => ({ campo, nombre })),
    minutosDeInactividad: { ...estado.minutosDeInactividad },
    solvenciaDisponible: { ...estado.solvenciaDisponible },
    actualizadaEn: estado.actualizadaEn,
    actualizadaPor: estado.actualizadaPor,
    limites: {
      toleranciaMinima: TOLERANCIA_MINIMA,
      toleranciaMaxima: TOLERANCIA_MAXIMA,
      horasMaximas: HORAS_MAXIMAS,
      penalizacionMaxima: PENALIZACION_MAXIMA,
      minutosDeInactividad: MINUTOS_DE_INACTIVIDAD,
    },
  };
}

// Minutos de inactividad que cierran la sesión de un rol (0: nunca).
function minutosDeInactividad(rol) {
  return estado.minutosDeInactividad[rol] ?? 20;
}

// Si se puede llenar la solicitud de solvencia en la web y en los kioscos: { web, kiosco }.
function solvenciaDisponible() {
  return { ...estado.solvenciaDisponible };
}

function toleranciaMinutos() {
  return estado.toleranciaMinutos;
}

// Cuántas horas queda sin poder reservar quien no se presentó a una reserva (0: no hay castigo).
function horasDePenalizacion() {
  return estado.horasDePenalizacion;
}

// Topes de horas de las reservas (valen para todos los lugares de estudio): por reserva y por persona al día.
function limitesDeHoras() {
  return { maxHorasPorReserva: estado.maxHorasPorReserva, maxHorasPorDia: estado.maxHorasPorDia };
}

// Los datos importantes de las tesis, con su nombre: [{ campo, nombre }].
function camposImportantes() {
  return estado.camposImportantes.map((campo) => ({ campo, nombre: CAMPOS_DE_TESIS[campo] }));
}

function reservasPausadas(tipo) {
  return estado.reservasPausadas[tipo] === true;
}

function tiposPausados() {
  return TIPOS_DE_RESERVA.filter(reservasPausadas);
}

function mensajeDePausa(tipo) {
  return `Las reservas de ${NOMBRE_DEL_SERVICIO[tipo]} están pausadas temporalmente. Consulta en el mostrador de la biblioteca.`;
}

function horasDeReserva(valor, actual, nombre) {
  if (valor === undefined) return actual;
  const horas = Number(valor);
  if (!Number.isInteger(horas) || horas < 1 || horas > HORAS_MAXIMAS) {
    throw rechazo(`${nombre} debe ser un número entero de 1 a ${HORAS_MAXIMAS} horas`);
  }
  return horas;
}

// Valida todo antes de cambiar algo: o se aplican todos los cambios, o ninguno.
// Devuelve la configuración nueva y la lista de cambios hechos, para la bitácora.
function actualizar(
  {
    toleranciaMinutos: tolerancia,
    horasDePenalizacion: penalizacion,
    reservasPausadas: pausas,
    maxHorasPorReserva: porReserva,
    maxHorasPorDia: porDia,
    camposImportantes: importantes,
    minutosDeInactividad: inactividad,
    solvenciaDisponible: canales,
  } = {},
  sesion
) {
  let nuevaTolerancia = estado.toleranciaMinutos;
  if (tolerancia !== undefined) {
    nuevaTolerancia = Number(tolerancia);
    if (!Number.isInteger(nuevaTolerancia) || nuevaTolerancia < TOLERANCIA_MINIMA || nuevaTolerancia > TOLERANCIA_MAXIMA) {
      throw rechazo(`La tolerancia debe ser un número entero de ${TOLERANCIA_MINIMA} a ${TOLERANCIA_MAXIMA} minutos`);
    }
  }

  let nuevaPenalizacion = estado.horasDePenalizacion;
  if (penalizacion !== undefined) {
    nuevaPenalizacion = Number(penalizacion);
    if (!Number.isInteger(nuevaPenalizacion) || nuevaPenalizacion < 0 || nuevaPenalizacion > PENALIZACION_MAXIMA) {
      throw rechazo(`Las horas sin poder reservar por no presentarse deben ser un número entero de 0 a ${PENALIZACION_MAXIMA}`);
    }
  }

  const nuevoPorReserva = horasDeReserva(porReserva, estado.maxHorasPorReserva, 'El máximo de horas por reserva');
  const nuevoPorDia = horasDeReserva(porDia, estado.maxHorasPorDia, 'El máximo de horas por persona al día');
  if (nuevoPorDia < nuevoPorReserva) {
    throw rechazo('El máximo por persona al día no puede ser menor que el máximo por reserva');
  }

  const nuevasPausas = { ...estado.reservasPausadas };
  if (pausas !== undefined) {
    if (typeof pausas !== 'object' || pausas === null || Array.isArray(pausas)) {
      throw rechazo('Indica qué reservas quedan pausadas');
    }
    Object.entries(pausas).forEach(([tipo, pausada]) => {
      if (!TIPOS_DE_RESERVA.includes(tipo) || typeof pausada !== 'boolean') {
        throw rechazo('Los datos de pausa no son válidos');
      }
      nuevasPausas[tipo] = pausada;
    });
  }

  let nuevosImportantes = estado.camposImportantes;
  if (importantes !== undefined) {
    if (!Array.isArray(importantes) || !importantes.every((c) => Object.hasOwn(CAMPOS_DE_TESIS, c))) {
      throw rechazo('Los datos importantes de las tesis no son válidos');
    }
    nuevosImportantes = ordenados(importantes);
  }

  const nuevaInactividad = { ...estado.minutosDeInactividad };
  if (inactividad !== undefined) {
    if (typeof inactividad !== 'object' || inactividad === null || Array.isArray(inactividad)) {
      throw rechazo('Indica tras cuántos minutos se cierra la sesión de cada rol');
    }
    Object.entries(inactividad).forEach(([rol, minutos]) => {
      if (!Object.hasOwn(ROLES, rol) || !MINUTOS_DE_INACTIVIDAD.includes(Number(minutos))) {
        throw rechazo(`El cierre de sesión por inactividad debe ser uno de estos valores: ${MINUTOS_DE_INACTIVIDAD.map(textoDeMinutos).join(', ')}`);
      }
      nuevaInactividad[rol] = Number(minutos);
    });
  }

  const nuevosCanales = { ...estado.solvenciaDisponible };
  if (canales !== undefined) {
    if (typeof canales !== 'object' || canales === null || Array.isArray(canales)) {
      throw rechazo('Indica dónde se puede pedir la solvencia');
    }
    Object.entries(canales).forEach(([canal, disponible]) => {
      if (!Object.hasOwn(CANALES_DE_SOLVENCIA, canal) || typeof disponible !== 'boolean') {
        throw rechazo('Los datos de la solicitud de solvencia no son válidos');
      }
      nuevosCanales[canal] = disponible;
    });
  }

  const cambios = [];
  if (nuevaTolerancia !== estado.toleranciaMinutos) {
    cambios.push(`tolerancia ${estado.toleranciaMinutos} → ${nuevaTolerancia} min`);
  }
  if (nuevaPenalizacion !== estado.horasDePenalizacion) {
    cambios.push(`sin reservar por no presentarse: ${estado.horasDePenalizacion} → ${nuevaPenalizacion} h`);
  }
  if (nuevoPorReserva !== estado.maxHorasPorReserva) {
    cambios.push(`horas por reserva: máximo ${estado.maxHorasPorReserva} → ${nuevoPorReserva} h`);
  }
  if (nuevoPorDia !== estado.maxHorasPorDia) {
    cambios.push(`horas por persona al día: máximo ${estado.maxHorasPorDia} → ${nuevoPorDia} h`);
  }
  TIPOS_DE_RESERVA.forEach((tipo) => {
    if (nuevasPausas[tipo] !== estado.reservasPausadas[tipo]) {
      cambios.push(`reservas de ${NOMBRE_DEL_SERVICIO[tipo]} ${nuevasPausas[tipo] ? 'pausadas' : 'reanudadas'}`);
    }
  });

  if (nuevosImportantes.join() !== estado.camposImportantes.join()) {
    cambios.push(`datos importantes de las tesis: ${nombresDe(estado.camposImportantes)} → ${nombresDe(nuevosImportantes)}`);
  }
  Object.keys(ROLES).forEach((rol) => {
    if (nuevaInactividad[rol] !== estado.minutosDeInactividad[rol]) {
      cambios.push(`cierre de sesión por inactividad (${ROLES[rol]}): ${textoDeMinutos(estado.minutosDeInactividad[rol])} → ${textoDeMinutos(nuevaInactividad[rol])}`);
    }
  });

  Object.keys(CANALES_DE_SOLVENCIA).forEach((canal) => {
    if (nuevosCanales[canal] !== estado.solvenciaDisponible[canal]) {
      cambios.push(`solicitud de solvencia en ${CANALES_DE_SOLVENCIA[canal]}: ${nuevosCanales[canal] ? 'activada' : 'desactivada'}`);
    }
  });

  if (cambios.length > 0) {
    estado.solvenciaDisponible = nuevosCanales;
    estado.minutosDeInactividad = nuevaInactividad;
    estado.camposImportantes = nuevosImportantes;
    estado.toleranciaMinutos = nuevaTolerancia;
    estado.horasDePenalizacion = nuevaPenalizacion;
    estado.maxHorasPorReserva = nuevoPorReserva;
    estado.maxHorasPorDia = nuevoPorDia;
    estado.reservasPausadas = nuevasPausas;
    estado.actualizadaEn = new Date().toISOString();
    estado.actualizadaPor = sesion?.usuario ?? null;
    almacen.guardar('configuracion', estado);
  }
  return { configuracion: obtener(), cambios };
}

module.exports = {
  TIPOS_DE_RESERVA,
  obtener,
  toleranciaMinutos,
  horasDePenalizacion,
  limitesDeHoras,
  camposImportantes,
  reservasPausadas,
  tiposPausados,
  mensajeDePausa,
  minutosDeInactividad,
  solvenciaDisponible,
  actualizar,
};
