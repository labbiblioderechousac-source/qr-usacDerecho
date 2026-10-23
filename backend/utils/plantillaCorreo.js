const biblioteca = require('./biblioteca');

// Arma un correo con el mismo contenido en dos formas: texto plano y HTML. Así los dos dicen siempre lo mismo y quien
// lee desde un programa que no muestra HTML (o lo tiene apagado) recibe el comprobante completo.
//
// El HTML usa tablas y estilos en línea, que es lo que entienden todos los programas de correo (Gmail, Outlook, el celular).
// No lleva imágenes: así no depende de que el programa las descargue, ni de adjuntos, ni de ninguna dirección pública.
// Todo lo que escribe la gente (nombres, carnés) pasa por `esc` antes de entrar al HTML.

const COLOR = {
  azul: '#1e3a8a',
  azulClaro: '#1d4ed8',
  rojo: '#dc2626',
  fondo: '#f3f5f9',
  borde: '#dde2ec',
  texto: '#0f172a',
  suave: '#475569',
};

function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// `filas`: pares [etiqueta, valor]; con un tercer elemento 'codigo' el valor se resalta (números y códigos de confirmación).
// `parrafos`: textos que van debajo de los datos; `introduccion`, los que van antes (el saludo de un correo formal).
// `previa`: la línea que algunos programas muestran junto al asunto.
function plantilla({ titulo, previa = '', introduccion = [], filas = [], parrafos = [] }) {
  const texto = [
    biblioteca.nombre,
    biblioteca.facultad,
    '',
    titulo,
    '',
    ...introduccion.flatMap((parrafo) => [parrafo, '']),
    ...filas.map(([etiqueta, valor]) => `${etiqueta}: ${valor}`),
    ...parrafos.flatMap((parrafo) => ['', parrafo]),
  ].join('\n');

  const filasHtml = filas
    .map(([etiqueta, valor, estilo]) => {
      const destacado = estilo === 'codigo';
      return `<tr>
<td class="et" style="width:36%;padding:7px 14px 7px 0;color:${COLOR.suave};font-size:13px;vertical-align:top;">${esc(etiqueta)}</td>
<td class="va" style="padding:7px 0;color:${COLOR.texto};font-size:15px;vertical-align:top;${
        destacado ? "font-family:Consolas,'Courier New',monospace;font-weight:bold;font-size:17px;letter-spacing:.04em;" : ''
      }">${esc(valor)}</td>
</tr>`;
    })
    .join('\n');

  const introduccionHtml = introduccion
    .map((parrafo) => `<p style="margin:0 0 14px;color:${COLOR.texto};font-size:15px;line-height:1.6;">${esc(parrafo)}</p>`)
    .join('\n');

  const parrafosHtml = parrafos
    .map((parrafo) => `<p style="margin:16px 0 0;color:${COLOR.suave};font-size:14px;line-height:1.6;">${esc(parrafo)}</p>`)
    .join('\n');

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>
@media only screen and (max-width: 480px) {
  td.et, td.va { display: block !important; width: 100% !important; padding-right: 0 !important; }
  td.et { padding-bottom: 0 !important; }
  td.va { padding-top: 2px !important; padding-bottom: 10px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${COLOR.fondo};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${COLOR.fondo};">${esc(previa || titulo)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.fondo};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${COLOR.borde};border-radius:12px;overflow:hidden;">
<tr><td style="background:${COLOR.azul};padding:22px 28px;color:#ffffff;font-family:Georgia,'Times New Roman',serif;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#bfdbfe;">${esc(biblioteca.facultad)}</div>
<div style="margin-top:5px;font-size:20px;font-weight:bold;line-height:1.3;">${esc(biblioteca.nombre)}</div>
</td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background:${COLOR.rojo};">&nbsp;</td></tr>
<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif;color:${COLOR.texto};">
<h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:${COLOR.azulClaro};">${esc(titulo)}</h1>
${introduccionHtml}
<table role="presentation" cellpadding="0" cellspacing="0" style="border-top:1px solid ${COLOR.borde};border-bottom:1px solid ${COLOR.borde};width:100%;padding:6px 0;">
${filasHtml}
</table>
${parrafosHtml}
</td></tr>
<tr><td style="background:${COLOR.fondo};padding:16px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${COLOR.suave};">
Este mensaje se generó automáticamente: no respondas a esta dirección.<br>${esc(biblioteca.universidad)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { texto, html };
}

// Para un mensaje que solo trae texto: lo envuelve en un HTML sencillo (algunos servicios de correo exigen la parte HTML).
function htmlDeTexto(texto) {
  const lineas = String(texto ?? '').split('\n').map(esc).join('<br>\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:${COLOR.texto};">${lineas}</body></html>`;
}

module.exports = { plantilla, htmlDeTexto, esc };
