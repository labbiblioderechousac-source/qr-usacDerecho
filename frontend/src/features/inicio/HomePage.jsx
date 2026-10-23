import { Link } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import Container from '../../shared/components/Container';
import HeroSearch from '../../shared/components/HeroSearch';
import ServiceCard from '../../shared/components/ServiceCard';
import { LIBRARY } from '../../shared/config/library';
import { useServicios } from '../../shared/config/useServicios';
import { useTitulo } from '../../shared/hooks/useTitulo';
import HorariosYUbicacion from './HorariosYUbicacion';

const ATAJOS = [
  { to: '/catalogo?tipo=tesis_grado', etiqueta: 'Tesis de grado' },
  { to: '/catalogo?tipo=tesis_posgrado', etiqueta: 'Tesis de posgrado' },
  { to: '/catalogo?digital=1', etiqueta: 'Con documento digital' },
  { to: '/catalogo?avanzada=1', etiqueta: 'Búsqueda avanzada' },
];

// Pantalla inicial del sitio y del kiosco (propuesta, sección 4.5): «Servicios de la biblioteca» con sus opciones, grandes y
// claras (catálogo, reservas de espacios de estudio con los cubículos adentro, y solvencia), más el buscador del catálogo.
// Debajo, los horarios de reserva y dónde está la biblioteca.
export default function HomePage() {
  useTitulo(null);
  const { servicios } = useServicios();

  return (
    <>
      <section className="hero-bg border-t-4 border-t-action text-white">
        <Container className="py-12 sm:py-16">
          <div className="mx-auto max-w-4xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-blue-100">
              <Landmark size={14} aria-hidden="true" />
              {LIBRARY.facultad} · USAC
            </p>
            <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.12] tracking-tight sm:text-5xl">Servicios de la biblioteca</h1>
            <p className="mx-auto mt-3 max-w-2xl text-lg text-white/80">
              {LIBRARY.nombre}. Busca una tesis, reserva un lugar de estudio o solicita tu solvencia desde esta pantalla.
            </p>
            <div className="mx-auto mt-8 max-w-3xl text-left">
              <HeroSearch />
            </div>
            <ul className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <li className="mr-1 text-sm text-white/60">Atajos:</li>
              {ATAJOS.map((a) => (
                <li key={a.to}>
                  <Link
                    to={a.to}
                    className="inline-flex rounded-full border border-white/25 px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:border-white hover:bg-white/10 hover:text-white"
                  >
                    {a.etiqueta}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="bg-surface py-12 sm:py-16" aria-labelledby="servicios-titulo">
        <Container>
          <h2 id="servicios-titulo" className="text-center font-display text-3xl font-semibold text-slate-900">
            ¿Qué quieres hacer?
          </h2>
          <ul className={`mt-8 grid gap-6 ${servicios.length === 4 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'}`}>
            {servicios.map((s) => (
              <li key={s.clave}>
                <ServiceCard to={s.to} icono={s.icono} titulo={s.titulo} accion={s.accion} acento={s.acento}>
                  {s.resumen}
                </ServiceCard>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <HorariosYUbicacion />
    </>
  );
}
