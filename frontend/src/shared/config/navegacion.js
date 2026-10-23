import { Armchair, BookOpen, FileCheck2, ListChecks } from 'lucide-react';

// Los servicios del kiosco (propuesta, sección 4.5): el OPAC, la reserva de espacios de estudio (con los cubículos adentro) y el
// formulario de solicitud de solvencia. Son las opciones de la pantalla inicial y del menú.
export const SERVICIOS = [
  {
    clave: 'opac',
    to: '/catalogo',
    titulo: 'Catálogo de tesis (OPAC)',
    tituloCorto: 'Catálogo',
    icono: BookOpen,
    acento: 'blue',
    accion: 'Buscar',
    resumen: 'Busca por autor, título, tema o tipo de documento. Consulta la ficha y, si existe, el documento digital.',
  },
  {
    clave: 'reservas',
    to: '/sala-de-estudio',
    titulo: 'Reservar espacio de estudio',
    tituloCorto: 'Reservas',
    icono: Armchair,
    acento: 'red',
    accion: 'Reservar',
    resumen: 'Cubículos para trabajar en grupo, estaciones individuales y lugares de la sala de lectura. Elige el día y la hora.',
  },
  {
    clave: 'solvencia',
    to: '/solvencia',
    titulo: 'Solicitud de solvencia',
    tituloCorto: 'Solvencia',
    icono: FileCheck2,
    acento: 'red',
    accion: 'Solicitar',
    resumen: 'Llena el formulario, revisa tus datos y recibe la confirmación de tu solicitud.',
  },
];

// Cómo hacer la solvencia: los pasos, el video de la biblioteca y, en el kiosco, un código QR para hacerla desde el celular. Va siempre al
// lado de la solicitud; donde la administración quitó el formulario (Configuración: en la web o en los kioscos), queda solo esta opción
// (ver useServicios).
export const PASOS_DE_SOLVENCIA = {
  clave: 'solvencia',
  to: '/solvencia/pasos',
  titulo: 'Cómo hacer tu solvencia',
  tituloCorto: 'Cómo hacer la solvencia',
  icono: ListChecks,
  acento: 'red',
  accion: 'Ver cómo',
  resumen: 'Los pasos y el video de la biblioteca: genera tu orden, paga, verifica y envía la solicitud con las fotos.',
};

// Menú principal del sitio.
export const MENU = [
  { to: '/', etiqueta: 'Inicio', exacto: true },
  { to: '/catalogo', etiqueta: 'Catálogo' },
  { to: '/sala-de-estudio', etiqueta: 'Reservas' },
  { to: '/solvencia', etiqueta: 'Solvencia' },
];
