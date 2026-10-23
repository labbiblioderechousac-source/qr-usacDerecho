import { Link } from 'react-router-dom';
import { Clock, MapPin } from 'lucide-react';
import Container from './Container';
import EnlaceExterno from './EnlaceExterno';
import MarcaBiblioteca from './MarcaBiblioteca';
import Redes from './Redes';
import { LIBRARY } from '../config/library';
import { useServicios } from '../config/useServicios';

// El panel del personal es otra parte del sistema y no se enlaza desde el sitio público.
const ENLACE = 'text-white/75 transition-colors hover:text-white hover:underline underline-offset-2';

// Pie de página: quién es la biblioteca (con sus redes), los servicios y dónde encontrarla. En un kiosco no se muestran las
// redes ni el enlace al mapa (llevarían fuera del sistema), pero sí la dirección.
export default function SiteFooter() {
  const { servicios } = useServicios();
  return (
    <footer className="mt-auto border-t-4 border-t-action bg-ink text-white print:hidden">
      <Container className="grid gap-10 py-12 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.3fr]">
        <div>
          <div className="flex items-center gap-3">
            <MarcaBiblioteca tamano={64} />
            <p className="font-display text-lg font-semibold leading-snug">{LIBRARY.nombreCorto}</p>
          </div>
          <p className="mt-3 text-sm text-white/70">
            {LIBRARY.facultad} · {LIBRARY.universidad}
          </p>
          <p className="mt-3 text-sm font-medium text-blue-200">{LIBRARY.descripcion}</p>
          <Redes claro variante="botones" className="mt-5" />
        </div>

        <nav aria-label="Servicios de la biblioteca">
          <h2 className="text-sm font-bold uppercase tracking-wider text-blue-300">Servicios</h2>
          <ul className="mt-4 flex flex-col gap-2.5 text-sm">
            {servicios.map((s) => (
              <li key={s.clave}>
                <Link to={s.to} className={ENLACE}>
                  {s.tituloCorto}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-blue-300">Ubicación</h2>
          <ul className="mt-4 flex flex-col gap-3 text-sm text-white/75">
            <li className="flex gap-3">
              <MapPin size={18} className="mt-0.5 shrink-0 text-blue-300" aria-hidden="true" />
              <span>
                {LIBRARY.direccion}.{' '}
                <EnlaceExterno href={LIBRARY.comoLlegar} className="font-semibold text-white underline underline-offset-2">
                  Cómo llegar
                </EnlaceExterno>
              </span>
            </li>
            <li className="flex gap-3">
              <Clock size={18} className="mt-0.5 shrink-0 text-blue-300" aria-hidden="true" />
              <span>
                Horarios de reserva de lugares de estudio.{' '}
                <Link to="/#horarios-y-ubicacion" className="font-semibold text-white underline underline-offset-2">
                  Ver horarios
                </Link>
              </span>
            </li>
          </ul>
        </div>
      </Container>

      <div className="border-t border-white/10">
        <Container className="py-5 text-xs text-white/55">
          <p>
            © {new Date().getFullYear()} {LIBRARY.nombreCorto} · {LIBRARY.facultad} · USAC
          </p>
        </Container>
      </div>
    </footer>
  );
}
