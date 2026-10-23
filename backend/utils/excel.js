const { crearZip } = require('./zip');

// Un libro de Excel (.xlsx) armado a mano: un .xlsx es un .zip con unos archivos XML adentro (formato Office Open XML), así que no hace
// falta ninguna librería. Cubre lo que usan las estadísticas: varias hojas, un título, encabezados con color, números y textos, filas
// sombreadas, una fila de totales con fórmulas SUMA, anchos de columna y la primera fila y columna fijas al desplazarse.
//
// `hojas`: [{ nombre, titulo?, nota?, columnas: [{ titulo, ancho? }], filas: [{ valores: [...], sombreada? }], totales? }]
//   - valores: número, texto o null (celda vacía).
//   - totales: true agrega al final una fila «Total» que suma cada columna numérica.

const ESTILO = { normal: 0, encabezado: 1, titulo: 2, total: 3, sombreada: 4, nota: 5 };

function letraDeColumna(indice) {
  let n = indice + 1;
  let letras = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

function xml(texto) {
  return String(texto ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function celda(referencia, valor, estilo) {
  if (valor === null || valor === undefined || valor === '') return `<c r="${referencia}" s="${estilo}"/>`;
  if (typeof valor === 'number' && Number.isFinite(valor)) return `<c r="${referencia}" s="${estilo}"><v>${valor}</v></c>`;
  return `<c r="${referencia}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${xml(valor)}</t></is></c>`;
}

// Excel no acepta en el nombre de una hoja estos signos ni más de 31 caracteres.
const nombreDeHoja = (nombre) => String(nombre).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);

function hojaXml({ titulo, nota, columnas, filas, totales }) {
  const renglones = [];
  let numero = 0;
  const agregar = (celdas, alto) => {
    numero += 1;
    renglones.push(`<row r="${numero}"${alto ? ` ht="${alto}" customHeight="1"` : ''}>${celdas(numero)}</row>`);
  };

  if (titulo) agregar((n) => celda(`A${n}`, titulo, ESTILO.titulo), 22);
  if (nota) agregar((n) => celda(`A${n}`, nota, ESTILO.nota));
  if (titulo || nota) agregar(() => '');
  const filaDelEncabezado = numero + 1;
  agregar((n) => columnas.map((c, i) => celda(`${letraDeColumna(i)}${n}`, c.titulo, ESTILO.encabezado)).join(''), 32);
  const primeraDeDatos = numero + 1;
  filas.forEach((fila) => {
    const estilo = fila.sombreada ? ESTILO.sombreada : ESTILO.normal;
    agregar((n) => fila.valores.map((v, i) => celda(`${letraDeColumna(i)}${n}`, v, estilo)).join(''));
  });
  const ultimaDeDatos = numero;

  if (totales && filas.length > 0) {
    agregar((n) =>
      columnas
        .map((c, i) => {
          const letra = letraDeColumna(i);
          if (i === 0) return celda(`${letra}${n}`, 'Total', ESTILO.total);
          const numeros = filas.map((f) => f.valores[i]).filter((v) => typeof v === 'number');
          if (numeros.length === 0) return celda(`${letra}${n}`, null, ESTILO.total);
          const suma = numeros.reduce((a, b) => a + b, 0);
          return `<c r="${letra}${n}" s="${ESTILO.total}"><f>SUM(${letra}${primeraDeDatos}:${letra}${ultimaDeDatos})</f><v>${suma}</v></c>`;
        })
        .join('')
    );
  }

  const anchos = columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho ?? 12}" customWidth="1"/>`).join('');
  // Fijas: la fila de encabezados y la primera columna (la fecha, el lugar o la tesis).
  const panel = `<pane xSplit="1" ySplit="${filaDelEncabezado}" topLeftCell="B${filaDelEncabezado + 1}" activePane="bottomRight" state="frozen"/>`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheetViews><sheetView workbookViewId="0">${panel}</sheetView></sheetViews>` +
    `<cols>${anchos}</cols>` +
    `<sheetData>${renglones.join('')}</sheetData>` +
    '</worksheet>'
  );
}

// Los estilos, en el orden de ESTILO. Colores de la biblioteca: azul #1E3A8A, fondo #F3F5F9.
const ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="5">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="14"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><i/><sz val="10"/><color rgb="FF475569"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="5">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE3E9F5"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F5F9"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top style="thin"><color rgb="FF1E3A8A"/></top><bottom/><diagonal/></border>' +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

// Devuelve el .xlsx como Buffer.
function crearExcel(hojas, { autor = '' } = {}) {
  const nombres = hojas.map((h) => nombreDeHoja(h.nombre));
  const ahora = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const archivos = [
    {
      nombre: '[Content_Types].xml',
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>',
    },
    {
      nombre: '_rels/.rels',
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>',
    },
    {
      nombre: 'docProps/core.xml',
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:creator>${xml(autor)}</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${ahora}</dcterms:created>` +
        '</cp:coreProperties>',
    },
    {
      nombre: 'xl/workbook.xml',
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' +
        nombres.map((nombre, i) => `<sheet name="${xml(nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets>' +
        '</workbook>',
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    { nombre: 'xl/styles.xml', contenido: ESTILOS },
    ...hojas.map((hoja, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: hojaXml(hoja) })),
  ];
  return crearZip(archivos);
}

module.exports = { crearExcel, letraDeColumna };
