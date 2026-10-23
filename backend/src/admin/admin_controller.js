const {
  ACCESOS,
  DESTINOS_DEL_QR,
  TESIS,
  limpiarUrl,
  digitalDisponible,
  faltantes,
  listarParaAdmin,
  obtenerPorId,
  actualizarDocumento,
  actualizarQr,
  verificarQr,
  crearTesis,
  actualizarTesis,
  eliminarTesis,
  importarTesis,
} = require('../catalog/catalog_data');
const reservasData = require('../reservas/reservas_data');
const solvenciaData = require('../solvencia/solvencia_data');
const { registrar } = require('../actividad/actividad_data');
const revisionDeEnlaces = require('../catalog/revision_de_enlaces');
const { calcular, hojasDelExcel, nombreDelExcel } = require('./estadisticas');
const { crearExcel } = require('../../utils/excel');
const biblioteca = require('../../utils/biblioteca');
const { ok, fail, notFound } = require('../../utils/httpResponse');

const TEXTO_DE_ACCESO = { acceso_descarga: 'acceso y descarga', consulta: 'consulta digital', sin_acceso: 'sin acceso digital' };
const TEXTO_DE_DESTINO = { enlace: 'al enlace corto (abre la URL de la tesis)', url: 'a la URL de la tesis, tal cual', ficha: 'a la ficha de la tesis' };
const TEXTO_DE_VERIFICACION = { ok: 'enlace correcto', solo_ficha: 'lleva a la ficha', enlace_roto: 'enlace roto', sin_comprobar: 'el sitio no dejó comprobarlo' };

// Qué cambió en el documento digital de una tesis, para la bitácora.
function describirDocumento(antes, despues) {
  const cambios = [];
  if (antes.acceso !== despues.acceso) {
    cambios.push(`acceso ${TEXTO_DE_ACCESO[antes.acceso]} → ${TEXTO_DE_ACCESO[despues.acceso]}`);
  }
  if (antes.activo !== despues.activo) {
    cambios.push(despues.activo ? 'documento activado' : 'documento desactivado');
  }
  if ((antes.urlExterna || null) !== (despues.urlExterna || null)) {
    cambios.push(despues.urlExterna ? 'enlace actualizado' : 'enlace quitado');
  }
  return cambios.length > 0 ? cambios.join(', ') : 'sin cambios';
}

function getResumen(req, res) {
  // Códigos QR que el personal de tesis debería revisar: los activos sin verificar o con el enlace roto.
  const qrPorRevisar = TESIS.filter((t) => t.qr.activo && (!t.qr.verificadoEn || t.qr.resultado === 'enlace_roto'));
  return ok(res, {
    tesis: {
      total: TESIS.length,
      conDocumentoDigital: TESIS.filter(digitalDisponible).length,
      qrPorRevisar: qrPorRevisar.length,
      qrPorRevisarMuestra: qrPorRevisar.slice(0, 6).map((t) => ({ id: t.id, titulo: t.titulo, resultado: t.qr.resultado })),
      // Tesis a las que les falta algún dato importante (ver la configuración).
      incompletas: TESIS.filter((t) => faltantes(t).length > 0).length,
    },
    reservas: reservasData.resumen(),
    solvencia: solvenciaData.resumen(),
  });
}

// Operaciones de cada persona (reservas y solicitudes), agrupadas por su carné o documento.
function getUsuarios(req, res) {
  const q = String(req.query.q || '').trim().toLowerCase();
  const porPersona = new Map();

  const agregar = (identificacion, nombre, operacion) => {
    const clave = String(identificacion).trim().toLowerCase();
    if (!porPersona.has(clave)) {
      porPersona.set(clave, { identificacion: String(identificacion).trim(), nombre, operaciones: [] });
    }
    porPersona.get(clave).operaciones.push(operacion);
  };

  reservasData.listarReservas().forEach((r) =>
    agregar(r.identificacion, r.solicitante, {
      tipo: 'reserva',
      id: r.id,
      detalle: `${r.recursoNombre} · ${r.fecha} de ${r.hora} a ${r.horaFin}`,
      estado: r.estado,
      creadoEn: r.creadoEn,
    })
  );
  solvenciaData.listar().forEach((s) =>
    agregar(s.identificacion, s.solicitante, {
      tipo: 'solvencia',
      id: s.id,
      detalle: s.motivo,
      estado: s.estado,
      creadoEn: s.creadoEn,
    })
  );

  const personas = [...porPersona.values()]
    .map((p) => {
      const operaciones = p.operaciones.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
      return {
        ...p,
        operaciones,
        totalReservas: operaciones.filter((o) => o.tipo === 'reserva').length,
        totalSolicitudes: operaciones.filter((o) => o.tipo !== 'reserva').length,
        ultimaActividad: operaciones[0].creadoEn,
      };
    })
    .filter((p) => !q || p.identificacion.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q))
    .sort((a, b) => b.ultimaActividad.localeCompare(a.ultimaActividad));

  return ok(res, personas);
}

// Tesis con su documento digital y su código QR, para que el personal de tesis los gestione.
// Con búsqueda (q), filtro por documento (con o sin) y por páginas.
function getTesis(req, res) {
  const { q, pagina, porPagina, documento, verificacion, completitud } = req.query;
  return ok(res, listarParaAdmin({ q, pagina, porPagina, documento, verificacion, completitud }));
}

// --- Catálogo: alta, cambios, baja e importación ---

function postTesis(req, res) {
  try {
    const tesis = crearTesis(req.body);
    const conUrl = tesis.documentoDigital.urlExterna ? ' (con URL de la tesis y código QR)' : '';
    registrar(req.sesion, 'catalogo.creada', `${tesis.id}: ${tesis.titulo}${conUrl}`);
    return ok(res, tesis, 'Tesis agregada', 201);
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

function patchTesis(req, res) {
  try {
    const existente = obtenerPorId(req.params.id);
    const documentoAntes = existente ? { ...existente.documentoDigital } : null;
    const destinoAntes = existente?.qr.destino;
    const tesis = actualizarTesis(req.params.id, req.body);
    if (!tesis) return notFound(res, 'Tesis no encontrada');
    registrar(req.sesion, 'catalogo.actualizada', `${tesis.id}: ${tesis.titulo}`);
    // Si el mismo formulario cambió la URL o el acceso, o a dónde lleva el QR, también queda en la bitácora.
    const cambios = describirDocumento(documentoAntes, tesis.documentoDigital);
    if (cambios !== 'sin cambios') registrar(req.sesion, 'tesis.documento', `${tesis.id}: ${cambios}`);
    if (tesis.qr.destino !== destinoAntes && destinoAntes !== undefined) {
      registrar(req.sesion, 'qr.destino', `${tesis.id}: el código lleva ${TEXTO_DE_DESTINO[tesis.qr.destino]}`);
    }
    return ok(res, tesis, 'Tesis actualizada');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

function deleteTesis(req, res) {
  const tesis = eliminarTesis(req.params.id);
  if (!tesis) return notFound(res, 'Tesis no encontrada');
  registrar(req.sesion, 'catalogo.eliminada', `${tesis.id}: ${tesis.titulo}`);
  return ok(res, { eliminada: true });
}

// Importa filas del catálogo. Vaciar el catálogo antes de importar solo lo puede pedir el administrador.
function postImportar(req, res) {
  try {
    const { filas, existentes, reemplazar } = req.body;
    if (reemplazar === true && req.sesion.rol !== 'administrador') {
      return fail(res, 'Solo el administrador puede reemplazar todo el catálogo', 403);
    }
    const resultado = importarTesis(filas, { existentes, reemplazar: reemplazar === true });
    registrar(
      req.sesion,
      'catalogo.importado',
      `${resultado.creadas} nuevas, ${resultado.actualizadas} actualizadas, ${resultado.omitidas} omitidas, ${resultado.totalErrores} con errores${reemplazar === true ? ' (reemplazó el catálogo)' : ''}`
    );
    return ok(res, resultado, 'Importación terminada');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

function patchDocumento(req, res) {
  const { acceso, activo, urlExterna } = req.body;
  if (acceso !== undefined && !ACCESOS.includes(acceso)) {
    return fail(res, 'Nivel de acceso invalido');
  }
  let urlLimpia;
  try {
    if (urlExterna !== undefined) urlLimpia = limpiarUrl(urlExterna);
  } catch (err) {
    return fail(res, err.message, err.estado || 400);
  }
  const existente = obtenerPorId(req.params.id);
  const documentoAntes = existente ? { ...existente.documentoDigital } : null;
  const tesis = actualizarDocumento(req.params.id, { acceso, activo, urlExterna: urlLimpia });
  if (!tesis) return notFound(res, 'Tesis no encontrada');
  registrar(req.sesion, 'tesis.documento', `${tesis.id}: ${describirDocumento(documentoAntes, tesis.documentoDigital)}`);
  return ok(res, tesis);
}

function patchQr(req, res) {
  const { activo, destino } = req.body;
  if (activo === undefined && destino === undefined) {
    return fail(res, 'Indica si el código QR queda activo o a dónde lleva');
  }
  if (activo !== undefined && typeof activo !== 'boolean') {
    return fail(res, 'Indica si el código QR queda activo o no');
  }
  if (destino !== undefined && !DESTINOS_DEL_QR.includes(destino)) {
    return fail(res, 'El destino del código QR no es válido');
  }
  const antes = obtenerPorId(req.params.id)?.qr.destino;
  const tesis = actualizarQr(req.params.id, { activo, destino });
  if (!tesis) return notFound(res, 'Tesis no encontrada');
  if (activo !== undefined) {
    registrar(req.sesion, 'qr.estado', `${tesis.id}: código ${tesis.qr.activo ? 'activado' : 'desactivado'}`);
  }
  if (destino !== undefined && destino !== antes) {
    registrar(req.sesion, 'qr.destino', `${tesis.id}: el código lleva ${TEXTO_DE_DESTINO[destino]}`);
  }
  return ok(res, tesis);
}

async function postVerificarQr(req, res) {
  const tesis = await verificarQr(req.params.id);
  if (!tesis) return notFound(res, 'Tesis no encontrada');
  registrar(req.sesion, 'qr.verificado', `${tesis.id}: ${TEXTO_DE_VERIFICACION[tesis.qr.resultado]}`);
  return ok(res, tesis);
}

// Revisión automática de los enlaces: cómo va y pedir una ahora (ver catalog/revision_de_enlaces.js).
function getRevisionDeEnlaces(req, res) {
  return ok(res, revisionDeEnlaces.situacion());
}

function postRevisionDeEnlaces(req, res) {
  const iniciada = revisionDeEnlaces.revisarAhora(req.sesion);
  return ok(res, { iniciada }, iniciada ? 'Revisión iniciada' : 'Ya hay una revisión en curso', iniciada ? 202 : 200);
}

// ?desde=2026-10-01&hasta=2026-10-31 limita las estadísticas a ese período (ambos días incluidos); sin fechas, todo lo registrado.
function getEstadisticas(req, res) {
  try {
    return ok(res, calcular({ desde: req.query.desde, hasta: req.query.hasta }));
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

// Las estadísticas del mismo período en un libro de Excel: resumen, día por día, cada lugar por día, tesis y horas.
function getEstadisticasExcel(req, res) {
  try {
    const filtro = { desde: req.query.desde, hasta: req.query.hasta };
    const libro = crearExcel(hojasDelExcel(filtro), { autor: biblioteca.nombre });
    registrar(req.sesion, 'estadisticas.excel', nombreDelExcel(filtro));
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombreDelExcel(filtro)}"`,
      'Cache-Control': 'private, no-store',
    });
    return res.send(libro);
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

module.exports = {
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
};
