import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, Home, MapPin, Menu, MonitorSmartphone, X } from 'lucide-react';
import Container from './Container';
import MarcaBiblioteca from './MarcaBiblioteca';
import Redes from './Redes';
import { LIBRARY } from '../config/library';
import { useServicios } from '../config/useServicios';
import { useKiosco } from '../kiosco/KioscoContext';

const ENLACE_BASE = 'relative whitespace-nowrap rounded-md px-4 py-2.5 text-base font-semibold transition-colors';
const enlaceDeMenu = ({ isActive }) =>
  `${ENLACE_BASE} ${isActive ? 'text-primary after:absolute after:inset-x-4 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-action' : 'text-slate-700 hover:bg-surface hover:text-primary'}`;

// Una opción del menú con varias páginas adentro (Solvencias): se abre con un clic o un toque (en el kiosco no hay «pasar el mouse por
// encima») y se cierra al elegir, al tocar fuera o con Escape.
function MenuDesplegable({ item }) {
  const { pathname } = useLocation();
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);
  const activo = item.hijos.some((h) => pathname === h.to || pathname.startsWith(`${h.to}/`));

  useEffect(() => setAbierto(false), [pathname]);

  useEffect(() => {
    if (!abierto) return undefined;
    const alTocarFuera = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    };
    const alTeclear = (e) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('mousedown', alTocarFuera);
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('mousedown', alTocarFuera);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        className={`${enlaceDeMenu({ isActive: activo })} inline-flex items-center gap-1.5`}
      >
        {item.etiqueta}
        <ChevronDown size={16} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {abierto ? (
        <div className="entrar absolute right-0 top-full z-50 mt-2 flex w-80 flex-col gap-1 rounded-xl border border-border bg-white p-2 shadow-lift">
          {item.hijos.map(({ to, etiqueta, resumen, icono: Icono, exacto }) => (
            <NavLink
              key={to}
              to={to}
              end={exacto}
              className={({ isActive }) => `flex items-start gap-3 rounded-lg px-3 py-3 transition-colors ${isActive ? 'bg-blue-50' : 'hover:bg-surface'}`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-action">
                <Icono size={20} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-slate-900">{etiqueta}</span>
                <span className="block text-sm text-slate-600">{resumen}</span>
              </span>
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const enlaceMovil = ({ isActive }) =>
  `flex items-center gap-3 rounded-lg px-3 py-3.5 text-lg font-semibold ${isActive ? 'bg-blue-50 text-primary' : 'text-slate-800 hover:bg-surface'}`;

export default function SiteHeader() {
  const { pathname } = useLocation();
  const { kiosco, esKiosco } = useKiosco();
  const { menu } = useServicios();
  const [menuMovil, setMenuMovil] = useState(false);
  const [conSombra, setConSombra] = useState(false);

  useEffect(() => setMenuMovil(false), [pathname]);

  useEffect(() => {
    const alDesplazar = () => setConSombra(window.scrollY > 8);
    alDesplazar();
    window.addEventListener('scroll', alDesplazar, { passive: true });
    return () => window.removeEventListener('scroll', alDesplazar);
  }, []);

  return (
    <>
      <a
        href="#contenido"
        className="sr-only z-[70] rounded-md bg-white px-4 py-2 text-sm font-bold text-primary shadow-lift focus:not-sr-only focus:fixed focus:left-4 focus:top-4 print:hidden"
      >
        Saltar al contenido
      </a>

      {/* Franja superior: dónde está la biblioteca y sus redes (las redes no se muestran en un kiosco). */}
      <div className="bg-ink text-white print:hidden">
        <Container className="flex items-center justify-between gap-x-6 gap-y-1 py-2">
          <Link to="/#horarios-y-ubicacion" className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-white/80 transition-colors hover:text-white">
            <MapPin size={15} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{LIBRARY.ubicacion}</span>
          </Link>
          <Redes claro className="hidden shrink-0 md:flex" />
        </Container>
      </div>

      <div className={`sticky top-0 z-40 border-b border-border bg-white/95 backdrop-blur transition-shadow print:hidden ${conSombra ? 'shadow-card' : ''}`}>
        <Container className="flex items-center justify-between gap-4 py-3">
          <Link to="/" className="flex min-w-0 items-center gap-3" aria-label={`${LIBRARY.nombreCorto}: ir al inicio`}>
            <MarcaBiblioteca tamano={52} />
            <span className="min-w-0 leading-tight">
              <span className="hidden truncate text-base font-bold text-slate-900 sm:block">{LIBRARY.nombreCorto}</span>
              <span className="block truncate text-base font-bold text-slate-900 sm:hidden">{LIBRARY.tituloSitio}</span>
              <span className="hidden truncate text-xs text-slate-500 sm:block">
                {LIBRARY.facultad} · USAC
              </span>
            </span>
          </Link>

          <nav aria-label="Menú principal" className="hidden items-center gap-1 md:flex">
            {menu.map((item) =>
              item.hijos ? (
                <MenuDesplegable key={item.to} item={item} />
              ) : (
                <NavLink key={item.to} to={item.to} end={item.exacto} className={enlaceDeMenu}>
                  {item.etiqueta}
                </NavLink>
              )
            )}
            {esKiosco ? (
              <span className="ml-3 flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white">
                <MonitorSmartphone size={14} aria-hidden="true" />
                Kiosco {kiosco}
              </span>
            ) : null}
          </nav>

          <button
            type="button"
            onClick={() => setMenuMovil((v) => !v)}
            aria-expanded={menuMovil}
            aria-controls="menu-movil"
            aria-label={menuMovil ? 'Cerrar el menú' : 'Abrir el menú'}
            className="flex h-12 w-12 items-center justify-center rounded-lg border border-border text-slate-700 transition-colors hover:border-primary hover:text-primary md:hidden"
          >
            {menuMovil ? <X size={24} /> : <Menu size={24} />}
          </button>
        </Container>

        {menuMovil ? (
          <nav id="menu-movil" aria-label="Menú principal" className="entrar border-t border-border bg-white md:hidden">
            <Container className="flex flex-col gap-1 py-3">
              {menu.map((item) =>
                item.hijos ? (
                  <div key={item.to} className="flex flex-col gap-1">
                    <p className="px-3 pt-2 text-xs font-bold uppercase tracking-wide text-slate-500">{item.etiqueta}</p>
                    {item.hijos.map(({ to, etiqueta, icono: Icono, exacto }) => (
                      <NavLink key={to} to={to} end={exacto} className={enlaceMovil}>
                        <Icono size={20} className="text-action" aria-hidden="true" />
                        {etiqueta}
                      </NavLink>
                    ))}
                  </div>
                ) : (
                  <NavLink key={item.to} to={item.to} end={item.exacto} className={enlaceMovil}>
                    {item.exacto ? <Home size={20} className="text-primary" aria-hidden="true" /> : null}
                    {item.etiqueta}
                  </NavLink>
                )
              )}
            </Container>
          </nav>
        ) : null}
      </div>
    </>
  );
}
