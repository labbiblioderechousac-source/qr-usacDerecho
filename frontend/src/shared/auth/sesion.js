// Sesión del personal en este navegador. Normalmente se guarda en `sessionStorage`: se borra al cerrar la pestaña.
// Si el rol no tiene cierre por inactividad (Configuración: «Nunca»), se guarda en `localStorage`: la PC de la administración sigue
// con la sesión abierta aunque se cierre el navegador, hasta que la persona salga.
// Un kiosco no cierra su pestaña; allí la sesión se cierra por inactividad (ver KioscoContext).
const CLAVE = 'sesion_personal';

function leerDe(almacen) {
  try {
    return JSON.parse(almacen.getItem(CLAVE));
  } catch {
    return null;
  }
}

function quitarDe(almacen) {
  try {
    almacen.removeItem(CLAVE);
  } catch {
    // nada que borrar
  }
}

export function leerSesion() {
  return leerDe(sessionStorage) ?? leerDe(localStorage);
}

export function guardarSesion(sesion) {
  const sinCierre = sesion?.minutosDeInactividad === 0;
  try {
    (sinCierre ? localStorage : sessionStorage).setItem(CLAVE, JSON.stringify(sesion));
    quitarDe(sinCierre ? sessionStorage : localStorage);
  } catch {
    // sin almacenamiento disponible: la sesión dura solo mientras no se recargue la página
  }
}

export function borrarSesion() {
  quitarDe(sessionStorage);
  quitarDe(localStorage);
}
