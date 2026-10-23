const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const biblioteca = require('../../utils/biblioteca');

// Constancia de solvencia de biblioteca en PDF. Es lo que la biblioteca promete en su sitio («Enviaremos tu Solvencia a tu correo
// electrónico en formato PDF para que la puedas imprimir»): sale adjunta en el correo de aprobación. Tamaño carta, para imprimirla.
//
// El texto de la constancia está en TEXTO (abajo): si la biblioteca usa una redacción oficial distinta, se cambia ahí.

const LOGO = path.join(__dirname, '..', '..', 'assets', 'logo-biblioteca.png');

// Colores de la biblioteca (los mismos del sitio y de los correos).
const AZUL = '#1e3a8a';
const AZUL_CLARO = '#1d4ed8';
const ROJO = '#dc2626';
const TINTA = '#0f172a';
const GRIS = '#475569';
const LINEA = '#dde2ec';
const FONDO = '#f3f5f9';

const ANCHO = 612; // carta: 8.5 x 11 pulgadas
const ALTO = 792;
const MARGEN = 64;
const ANCHO_UTIL = ANCHO - MARGEN * 2;

const TEXTO = {
  titulo: 'CONSTANCIA DE SOLVENCIA DE BIBLIOTECA',
  cuerpo: (s) =>
    `La ${biblioteca.nombre}, de la ${biblioteca.facultad} de la ${biblioteca.universidad}, hace constar que ` +
    `${s.solicitante}, quien se identifica con el carné ${s.identificacion} y el CUI ${s.cui}, estudiante de ${s.programa}, ` +
    'no tiene libros ni otros materiales pendientes de devolución y se encuentra SOLVENTE con esta biblioteca.',
  uso: (s) =>
    `Se extiende la presente constancia a solicitud de la persona interesada, para el trámite de ${s.motivo.toLowerCase()}, ` +
    `después de verificar el pago de la orden ${s.ordenDePago}.`,
  pie: 'Documento emitido electrónicamente por la biblioteca. Si la constancia tiene algún error, la persona debe presentar una nueva solicitud.',
};

// "jueves 8 de octubre de 2026" a partir de "2026-10-08".
function fechaLarga(fecha) {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// "22 de octubre de 2026" a partir de un momento ISO, en hora de la biblioteca.
function diaDe(iso) {
  return new Date(iso).toLocaleDateString('es-GT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: process.env.TZ || 'America/Guatemala' });
}

// Devuelve el PDF (Buffer) de la constancia de una solicitud aprobada.
function constanciaDeSolvencia(s) {
  return new Promise((resolve, reject) => {
    const emitida = s.atendidaEn ?? new Date().toISOString();
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN },
      displayTitle: true,
      lang: 'es',
      info: {
        Title: `Constancia de solvencia ${s.id} - ${s.solicitante}`,
        Author: biblioteca.nombre,
        Subject: 'Constancia de solvencia de biblioteca',
        Creator: biblioteca.nombre,
        Producer: 'Sistema de autoservicio de la biblioteca',
      },
    });

    const trozos = [];
    doc.on('data', (trozo) => trozos.push(trozo));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);

    // --- Encabezado: franja azul con el logo y el nombre de la biblioteca, línea roja debajo ---------------------------
    const alto = 118;
    doc.rect(0, 0, ANCHO, alto).fill(AZUL);
    doc.rect(0, alto, ANCHO, 4).fill(ROJO);
    if (fs.existsSync(LOGO)) doc.image(LOGO, MARGEN, 18, { fit: [68, 82] });
    doc.font('Helvetica').fontSize(9).fillColor('#bfdbfe').text(biblioteca.universidad.toUpperCase(), MARGEN + 86, 30, { width: ANCHO_UTIL - 86, characterSpacing: 1.2 });
    doc.font('Helvetica').fontSize(10).fillColor('#dbeafe').text(biblioteca.facultad, MARGEN + 86, doc.y + 3, { width: ANCHO_UTIL - 86 });
    doc.font('Times-Bold').fontSize(16).fillColor('#ffffff').text(biblioteca.nombre, MARGEN + 86, doc.y + 4, { width: ANCHO_UTIL - 86 });

    // --- Título ------------------------------------------------------------------------------------------------------
    doc.font('Times-Bold').fontSize(19).fillColor(AZUL_CLARO).text(TEXTO.titulo, MARGEN, 162, { width: ANCHO_UTIL, align: 'center' });
    const bajo = doc.y + 8;
    doc.rect(ANCHO / 2 - 26, bajo, 52, 3).fill(ROJO);
    doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(`No. ${s.id}`, MARGEN, bajo + 14, { width: ANCHO_UTIL, align: 'center' });

    // --- Cuerpo ------------------------------------------------------------------------------------------------------
    doc.font('Times-Roman').fontSize(13).fillColor(TINTA);
    doc.text(TEXTO.cuerpo(s), MARGEN, doc.y + 26, { width: ANCHO_UTIL, align: 'justify', lineGap: 5 });
    doc.moveDown(0.9);
    doc.text(TEXTO.uso(s), MARGEN, doc.y, { width: ANCHO_UTIL, align: 'justify', lineGap: 5 });
    doc.moveDown(0.9);
    doc.text(`Guatemala, ${diaDe(emitida)}.`, MARGEN, doc.y, { width: ANCHO_UTIL, lineGap: 5 });

    // --- Datos de la solicitud, en un recuadro -------------------------------------------------------------------------
    const filas = [
      ['Número de solicitud', s.id],
      ['Código de verificación', s.codigoConfirmacion],
      ['Nombre completo', s.solicitante],
      ['Carné', s.identificacion],
      ['CUI', s.cui],
      ['Motivo', s.motivo],
      ['Orden de pago', s.ordenDePago],
      ...(s.fechaPapeleria ? [['Presentará su papelería el', fechaLarga(s.fechaPapeleria)]] : []),
      ['Fecha de emisión', diaDe(emitida)],
      ...(s.revisadaPor?.nombre ? [['Revisada por', s.revisadaPor.nombre]] : []),
    ];
    const altoDeFila = 21;
    const arriba = doc.y + 24;
    doc.roundedRect(MARGEN, arriba, ANCHO_UTIL, filas.length * altoDeFila + 18, 8).fillAndStroke(FONDO, LINEA);
    filas.forEach(([etiqueta, valor], i) => {
      const y = arriba + 10 + i * altoDeFila;
      doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text(etiqueta, MARGEN + 16, y + 4, { width: 170 });
      const codigo = ['Número de solicitud', 'Código de verificación'].includes(etiqueta);
      doc.font(codigo ? 'Courier-Bold' : 'Helvetica-Bold').fontSize(codigo ? 11 : 10.5).fillColor(TINTA).text(String(valor ?? ''), MARGEN + 190, y + 3, {
        width: ANCHO_UTIL - 206,
        lineBreak: false,
        ellipsis: true,
      });
    });

    // --- Pie de página (dentro del margen inferior: sin esto pdfkit pasaría el texto a una hoja nueva) -------------------
    doc.page.margins.bottom = 0;
    doc.moveTo(MARGEN, ALTO - 92).lineTo(ANCHO - MARGEN, ALTO - 92).lineWidth(0.8).stroke(LINEA);
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(TEXTO.pie, MARGEN, ALTO - 82, { width: ANCHO_UTIL, align: 'center' });
    doc.text(`${biblioteca.nombre} · ${biblioteca.facultad} · ${biblioteca.universidad}`, MARGEN, doc.y + 3, { width: ANCHO_UTIL, align: 'center' });

    doc.end();
  });
}

// "Constancia_solvencia_SOL-001_Maria_Lopez.pdf"
function nombreDeLaConstancia(s, sinTildes) {
  return `Constancia_solvencia_${s.id}_${sinTildes(s.solicitante) || 'solicitante'}.pdf`;
}

module.exports = { constanciaDeSolvencia, nombreDeLaConstancia };
