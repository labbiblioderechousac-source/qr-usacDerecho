import { useEffect, useState } from 'react';
import axiosClient from '../api/axiosClient';
import { useKiosco } from '../kiosco/KioscoContext';
import { MENU, PASOS_DE_SOLVENCIA, SERVICIOS } from './navegacion';

// Si el formulario de solvencia está disponible aquí: la administración lo puede quitar de la web o de los kioscos (Configuración).
// Se pregunta una vez por página cargada (un kiosco recarga la página al terminar cada sesión, así que toma el cambio enseguida).
let pedido = null;
function pedirReglas() {
  if (!pedido) {
    pedido = axiosClient
      .get('/solvencia/reglas')
      .then((res) => res.data.data)
      .catch(() => {
        pedido = null; // sin conexión: se vuelve a preguntar la próxima vez
        return null;
      });
  }
  return pedido;
}

// { disponible, reglas }. Mientras no hay respuesta se da por disponible, que es lo normal.
export function useSolvenciaDisponible() {
  const { kiosco } = useKiosco();
  const [reglas, setReglas] = useState(null);

  useEffect(() => {
    let vigente = true;
    pedirReglas().then((r) => {
      if (vigente) setReglas(r);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const canales = reglas?.disponible;
  const disponible = canales ? Boolean(kiosco ? canales.kiosco : canales.web) : true;
  return { disponible, reglas };
}

// Las opciones del inicio, del menú y del pie. «Cómo hacer tu solvencia» va siempre al lado de la solicitud (en el menú, las dos dentro de
// «Solvencias»); donde el formulario no está disponible, queda solo esa opción (la de la solicitud desaparece).
export function useServicios() {
  const { disponible } = useSolvenciaDisponible();
  const servicios = SERVICIOS.flatMap((s) => (s.clave !== 'solvencia' ? [s] : disponible ? [s, { ...PASOS_DE_SOLVENCIA, clave: 'pasos_solvencia' }] : [PASOS_DE_SOLVENCIA]));
  const menu = MENU.map((m) => (m.to !== '/solvencia' || disponible ? m : { to: PASOS_DE_SOLVENCIA.to, etiqueta: m.etiqueta }));
  return { servicios, menu };
}
