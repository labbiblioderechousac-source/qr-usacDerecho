import { createBrowserRouter, redirect } from 'react-router-dom';
import Layout from '../shared/components/Layout';
import NotFoundPage from './NotFoundPage';
import PantallaDeCarga from './PantallaDeCarga';
import HomePage from '../features/inicio/HomePage';
import { RUTA_DEL_PANEL } from '../shared/config/rutas';
import { hayKiosco } from '../shared/kiosco/kiosco';

// Cada página se descarga cuando alguien entra a ella: así el primer acceso (que en un kiosco o en un celular pesa) solo
// trae el inicio y el diseño del sitio, no todo el código de la biblioteca.
const pagina = (cargar) => ({ lazy: async () => ({ Component: (await cargar()).default }) });

// Protección de rutas del panel del personal. Corre antes de dibujar cualquier página del panel (RUTA_DEL_PANEL, en shared/config/rutas.js):
//  - una pestaña que es un kiosco no entra al panel aunque alguien escriba la dirección (si el servidor tiene KIOSCOS_IP, también
//    lo niega la red; ver backend/server.js);
//  - sin sesión, con una sesión vencida o con una sección que el rol no puede ver, se redirige (ver features/admin/guardia.js).
// El servidor vuelve a comprobar la sesión y el rol en cada petición a la API.
async function protegerElPanel({ request }) {
  if (hayKiosco(request.url)) throw redirect('/');
  const { guardarRutaDelPanel } = await import('../features/admin/guardia');
  return guardarRutaDelPanel({ request });
}

export const router = createBrowserRouter([
  // Sitio público y kioscos (propuesta, sección 4.5): el catálogo (OPAC), la reserva de cubículos y de espacios de estudio
  // y la solicitud de solvencia.
  {
    element: <Layout />,
    hydrateFallbackElement: <PantallaDeCarga />,
    children: [
      {
        // Si una página falla al cargar, el error se muestra dentro del diseño del sitio (con su menú y su pie).
        errorElement: <NotFoundPage />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/catalogo', ...pagina(() => import('../features/catalog/OpacSearchPage')) },
          { path: '/tesis/:id', ...pagina(() => import('../features/catalog/ThesisDetailPage')) },
          { path: '/tesis/:id/documento', ...pagina(() => import('../features/catalog/ThesisDocumentPage')) },
          { path: '/sala-de-estudio', ...pagina(() => import('../features/reservas/StudyRoomPage')) },
          { path: '/solvencia', ...pagina(() => import('../features/solvencia/SolvenciaPage')) },
          { path: '/solvencia/pasos', ...pagina(() => import('../features/solvencia/PasosDeSolvenciaPage')) },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
  // Consola del personal: otra parte del sistema, sin el diseño público (encabezado, buscador, pie, modo kiosco).
  // Se descarga solo cuando alguien entra al panel: el público y los kioscos no cargan ese código.
  {
    path: `${RUTA_DEL_PANEL}/*`,
    loader: protegerElPanel,
    ...pagina(() => import('../features/admin/AdminApp')),
    hydrateFallbackElement: <PantallaDeCarga />,
    errorElement: <NotFoundPage />,
  },
]);
