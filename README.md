# Biblioteca «Francisco Rolando Velázquez González»: autoservicio y kioscos

Complemento digital de la biblioteca de la Facultad de Ciencias Jurídicas y Sociales (USAC), según su propuesta de modernización:

- **Catálogo (OPAC)** de tesis, con ficha, documento digital (acceso y descarga, solo consulta o sin acceso) y código QR.
- **Reserva de espacios de estudio** (cubículos, estaciones y sala de lectura), con plano de la sala.
- **Solicitud de solvencia**.
- **Comprobantes** en pantalla (con el mismo diseño que el correo), impresos (hoja carta en el sitio, ticket de 80 mm en el kiosco) y por correo.
- **Kioscos táctiles** con cierre de sesión por inactividad y candado de pantalla.
- **Panel del personal** con cuatro roles y estadísticas de uso (`/privateAccess`).

```
backend/    API en Express (datos en archivos JSON dentro de backend/data)
frontend/   Sitio y panel en React + Vite + Tailwind
```

## Para trabajar en tu equipo

Hace falta Node 20.12 o más nuevo.

```bash
cd backend  && npm install && cp .env.example .env   # en Windows: copy .env.example .env  (escribe tus claves en .env)
cd frontend && npm install
```

En dos terminales:

```bash
cd backend  && npm run dev     # API en http://localhost:4001
cd frontend && npm run dev     # sitio en http://localhost:5174 (reenvía /api al backend)
```

El panel está en `http://localhost:5174/privateAccess`. Sus cuatro cuentas iniciales (`admin`, `circulacion`, `tesis` y `consulta`)
toman la clave de `CLAVE_ADMIN`, `CLAVE_CIRCULACION`, `CLAVE_TESIS` y `CLAVE_CONSULTA` en `backend/.env`. Si alguna queda
vacía, el servidor genera una clave temporal y la muestra en su consola. Esas variables solo crean las cuentas la primera vez:
después vale la clave que cada persona ponga desde el panel. **`backend/.env` no se sube a git.** Las demás cuentas se crean desde
el panel («Cuentas del personal»).

### Pruebas

```bash
cd frontend && npm run build   # algunas pruebas usan el sitio compilado
cd backend  && npm test        # todas; «npm test -- horas url-qr» corre solo esas y «-- --detalle» muestra cada comprobación
```

Cada prueba arranca su propio servidor en un puerto libre, con datos temporales y claves de prueba: no toca los datos de desarrollo
ni manda nada a internet (el correo se prueba con servidores falsos). Para correrlas contra PostgreSQL define `DATABASE_URL_PRUEBA`
con una base solo de pruebas (su nombre debe llevar «prueba» o «test»; se vacía antes de cada prueba): así corre también el grupo
`postgres`, que prueba el almacenamiento en la base de datos (filas por registro, turno entre copias, caída y recuperación,
importador). Están en `backend/pruebas`.

## Para publicarlo

1. Compila el sitio: `cd frontend && npm install && npm run build` (genera `frontend/dist`).
2. En el servidor: `cd backend && npm install --omit=dev`, copia `.env.example` como `.env`, completa las claves y agrega
   `NODE_ENV=production`. Con eso el mismo servidor entrega el sitio compilado y la API: `node server.js` (o un servicio que lo
   mantenga encendido, como pm2 o systemd).
3. Detrás de nginx u otro proxy con HTTPS, define `TRUST_PROXY=1` para que los límites de uso y el candado de los kioscos vean la
   dirección real de cada equipo.
4. **Respalda los datos.** Con `DATABASE_URL` están en PostgreSQL (ver «Base de datos» más abajo); sin ella, en `backend/data` (o la
   carpeta de `DATA_DIR`): reservas, solicitudes, cuentas, catálogo, horarios y actividad. Las sesiones del panel también se
   guardan: reiniciar el servidor no saca al personal.
5. Correo: sin configurarlo, los comprobantes por correo no salen (quedan simulados); ver «Correo» más abajo.
6. Logo: el archivo es `frontend/public/logo-biblioteca.png` (y `icono-biblioteca.png` para la pestaña del navegador).

Todos los ajustes del servidor están explicados en `backend/.env.example`.

### Con Docker (Railway, Render, Fly.io o un servidor propio)

El `Dockerfile` de la raíz arma una sola imagen con el servidor y el sitio ya compilado:

```bash
docker build -t biblioteca-opac .
docker run -p 4001:4001 -v biblioteca-datos:/data --env-file backend/.env biblioteca-opac
```

Una plataforma que construye desde GitHub solo necesita apuntar a este repositorio: detecta el `Dockerfile` y usa el puerto de
la variable `PORT`.

- **Datos.** Con `DATABASE_URL` van a PostgreSQL y no hace falta ningún volumen. Sin ella quedan en `/data` (`DATA_DIR`): ahí hay
  que montar un volumen persistente y respaldarlo, porque sin volumen cada despliegue empieza de cero. Al apagar el servidor
  (`SIGTERM`) se guarda lo pendiente.
- **Claves.** Define `CLAVE_ADMIN`, `CLAVE_CIRCULACION`, `CLAVE_TESIS` y `CLAVE_CONSULTA` como variables de la plataforma, nuevas y
  largas (no uses las de pruebas). Si falta alguna, el servidor inventa una temporal y la escribe en sus registros. Solo sirven para
  crear las cuentas la primera vez: después vale la clave que cada persona ponga desde el panel (`RESTABLECER_CLAVES=1` las vuelve a
  aplicar una vez, para una clave olvidada).
- **Proxy.** Detrás del proxy de la plataforma define `TRUST_PROXY=1`; si no, los límites de uso ven una sola «persona» (el
  proxy) y bloquean a todos a la vez.
- **Kioscos.** `KIOSCOS_IP` solo sirve si el servidor ve la dirección propia de cada kiosco (servidor dentro de la misma red). En
  la nube todos los equipos de la facultad salen con la misma dirección pública: déjalo vacío. El candado de pantalla del kiosco y
  el inicio de sesión del panel siguen protegiendo.
- **Una sola instancia.** El servidor trabaja con sus datos en memoria: no se puede escalar a varias copias. Con la base de datos, una segunda copia espera su turno (ver «Base de datos»).
- **Primer arranque.** El catálogo trae siete tesis de ejemplo; en **Catálogo → Importar** se marca «Reemplazar todo el catálogo»
  para dejar solo el real.
- **Salud.** `/health` responde `ok` cuando el servidor está listo.

### Base de datos (PostgreSQL, Supabase)

Sin configurar nada, el servidor guarda todo en archivos JSON (`backend/data`): sirve para desarrollar. Con `DATABASE_URL` guarda en una
base de datos PostgreSQL (Supabase, Render, la de tu computadora...): los datos sobreviven a cada publicación del servidor y no hace
falta un disco.

- **Qué se guarda.** Cada tipo de dato (cuentas, horarios, configuración, actividad...) es una fila de `biblioteca.almacen`, en formato
  JSON. Las listas largas (las tesis del catálogo con sus QR, las reservas, las solicitudes de solvencia y los eventos de las
  estadísticas) van en `biblioteca.registros`, con **una fila por registro**: cambiar una reserva escribe esa fila y no todas. El servidor
  trabaja con todo en memoria y guarda un instante después de cada cambio (al apagarlo guarda lo que quede). El esquema se crea solo al
  arrancar (`backend/sql/esquema.sql`).
- **Cuánto aguanta.** Medido con 30 000 tesis (unos 37 MB) y la base en la misma computadora: arrancar toma cerca de un segundo (con una base remota,
  más: hay que traerlas todas) y guardar un cambio menos de medio segundo; el
  servidor usa unos 190 MB de memoria. El tope real es la memoria del servidor (512 MB en Render gratis), no los 500 MB de Supabase.
- **Si vienes de una versión anterior** (cada lista dentro de su documento), el servidor la pasa sola a filas en el primer arranque y lo
  dice en la consola. Después de eso una versión anterior ya no puede leer la base: para volver atrás, restaura un respaldo.
- **Verlos como tablas.** El esquema trae vistas de solo lectura (`v_reservas`, `v_tesis`, `v_solicitudes_solvencia`, `v_cuentas`,
  `v_actividad`, `v_eventos`, `v_cierres`): ábrelas en pgAdmin (Schemas → biblioteca → Views) o en el Table Editor de Supabase y
  expórtalas a CSV. No se edita ahí: los cambios se hacen desde el panel.
- **Privacidad.** Todo vive en el esquema `biblioteca`, que la API pública de Supabase no expone, y se le quita el acceso a los roles
  públicos. Las cuentas se ven sin su clave cifrada.
- **UTF8.** La base debe ser UTF8; si no, el servidor no arranca y explica cómo crearla (en pgAdmin: clic derecho en Databases →
  Create → Database → pestaña Definition: Encoding UTF8, Template template0, Collation C, Character type C).
- **Conexión.** Va cifrada, salvo hacia `localhost`. Con Supabase usa la cadena «Session pooler» (puerto 5432): la conexión directa
  solo funciona por IPv6. Sirve cualquier PostgreSQL que dé una `DATABASE_URL`.
- **Una sola copia a la vez.** El servidor toma un «turno» en la base (un candado de PostgreSQL). Una segunda copia espera hasta que la
  primera termine (al publicar una versión nueva conviven unos segundos) o se rinde con un aviso a los `ESPERA_DEL_TURNO_S` segundos;
  mientras espera, responde que se está iniciando.
- **Si la base se cae.** El servidor sigue atendiendo con lo que tiene en memoria, avisa en la consola y en el panel y guarda lo
  pendiente solo cuando la base vuelve.
- **Pasar lo que ya tenías.** `npm run importar` (dentro de `backend`) sube a la base los archivos de `backend/data`, de otra carpeta o
  un respaldo (el .json descargado del panel o el .zip que llega por correo). No pisa lo que ya hay salvo con `--forzar`, y se niega si hay un servidor encendido.
- **Respaldo.** En el panel, **Datos y respaldo** (solo el administrador) muestra dónde está guardado todo y descarga un respaldo en
  JSON (sin las claves de las cuentas). Las bases gratuitas no suelen ofrecer copias descargables (la de Supabase tampoco): por eso
  conviene el respaldo automático.
- **Respaldo automático por correo.** Con `RESPALDO_CORREO` (y el correo configurado, ver «Correo») el servidor manda solo, cada 7 días
  (`RESPALDO_DIAS`), un .zip con el respaldo y un LEEME que explica cómo restaurarlo. En **Datos y respaldo** se ve a quién va, cuándo
  salió el último, cuándo toca el próximo y el último error, y hay un botón para enviarlo ahora y comprobar que llega. Lleva datos de
  estudiantes: que sea un correo de la biblioteca. Para restaurar: `npm run importar -- respaldo.zip --forzar` con el servidor apagado.

#### Probar en tu computadora con pgAdmin

1. En pgAdmin: clic derecho en **Databases** → **Create** → **Database**. Nombre `biblioteca`; pestaña **Definition**: Encoding `UTF8`,
   Template `template0`, Collation `C`, Character type `C`. **Save**.
2. En `backend/.env` (no se sube a git) escribe `DATABASE_URL=postgresql://postgres:TU_CLAVE@localhost:5432/biblioteca`, con la clave que
   le pusiste a PostgreSQL al instalarlo.
3. `cd backend && npm run dev`. La consola debe decir `datos: PostgreSQL (localhost:5432/biblioteca)`.
4. En pgAdmin, refresca la base: **Schemas → biblioteca → Tables** (`almacen`) y **Views** (clic derecho en `v_reservas` → View/Edit Data → All
   Rows). Para pasar lo que ya tenías en `backend/data`: `npm run importar` con el servidor apagado.

### Publicar en Render

Render construye el `Dockerfile` desde GitHub y le da a la biblioteca una dirección con HTTPS. [`render.yaml`](render.yaml) deja el
servicio casi listo.

1. **La base de datos (Supabase).** En supabase.com crea, en tu cuenta, un proyecto gratuito (región *East US, North Virginia*) y guarda
   la contraseña de la base. En el proyecto, botón **Connect** → **Session pooler**: copia la cadena
   (`postgresql://postgres.<proyecto>:[YOUR-PASSWORD]@aws-...pooler.supabase.com:5432/postgres`) y cambia `[YOUR-PASSWORD]` por tu
   contraseña (si lleva símbolos como `#` o `@`, escríbelos con `%` y su código). No uses la conexión directa: solo funciona por IPv6.
2. **El código en GitHub.** Render publica la rama que elijas: sube la rama que lleva todo (por ejemplo `render/s5`).
3. **Render.** En dashboard.render.com: **New → Blueprint**, conecta tu GitHub, elige este repositorio y esa rama, y escribe lo que
   pide: `DATABASE_URL` (la cadena del paso 1) las cuatro claves del panel (`CLAVE_ADMIN`, `CLAVE_CIRCULACION`, `CLAVE_TESIS` y
   `CLAVE_CONSULTA`: nuevas y largas) y las del correo con Gmail (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` y
   `CORREO_REMITENTE`, copiadas de `backend/.env` después de correr `npm run token-gmail`). **Apply**.
4. **Primer arranque.** El primer build tarda varios minutos. En **Logs** debe aparecer `datos: PostgreSQL (...)`. Si la clave de la base
   es incorrecta o la base no es UTF8, el mensaje dice qué corregir.
5. **Entra al panel.** `https://<tu-servicio>.onrender.com/privateAccess` con el usuario `admin` y la clave de `CLAVE_ADMIN`. En **Datos y
   respaldo** debe decir «Base de datos PostgreSQL» y «Conectada».
6. **Correo.** En Render gratis los puertos SMTP están bloqueados: por eso se usa la API de Gmail (ver «Correo con Gmail»). En el
   panel, sección **Correo**, pulsa **Comprobar la conexión** y manda un correo de prueba.
7. **Respaldo automático.** Con el correo ya funcionando, agrega `RESPALDO_CORREO` con el correo de la biblioteca: cada semana llegará
   ahí un .zip con todo lo guardado. Compruébalo en **Datos y respaldo → Enviar respaldo ahora**.

Lo que conviene saber del plan gratuito ([documentación de Render](https://render.com/docs/free)):

- El servicio se duerme tras 15 minutos sin visitas y la siguiente tarda cerca de un minuto en abrir; al despertar lee otra vez los datos
  de la base. Con un plan de pago no se duerme.
- Para que no se duerma, el servidor se visita solo (`/health`) cada 10 minutos por su dirección pública (`RENDER_EXTERNAL_URL`, que
  Render ya define): no necesita cuentas ni servicios externos. `KEEPALIVE=0` lo apaga. Solo funciona mientras está despierto; si ya se
  durmió, la primera visita de cualquier persona lo despierta.
- Las sesiones del panel se guardan en la base: si el servicio se duerme o se publica una versión, el personal sigue dentro (hasta
  que su sesión venza, a las 8 horas).
- Son 750 horas gratis al mes por espacio de trabajo: un solo servicio encendido todo el mes cabe.
- La base gratuita de Render caduca a los 30 días; por eso se usa Supabase, que además pausa los proyectos gratuitos tras una semana sin
  actividad (mientras haya visitas, no pasa).
- Las claves `CLAVE_*` solo crean las cuentas la primera vez. Después cada persona cambia la suya con «Cambiar mi clave» y esa es la que
  vale, aunque el servidor se reinicie. Si alguien olvida la suya, el administrador le pone otra en «Cuentas del personal»; y si es la
  del administrador, define `RESTABLECER_CLAVES=1` y `CLAVE_ADMIN` con la clave nueva, deja que reinicie, entra y **quita
  `RESTABLECER_CLAVES`** (mientras siga puesta, cada reinicio vuelve a poner las claves de las variables).

#### Ver los datos de Supabase con pgAdmin

Clic derecho en **Servers** → **Register** → **Server**. **General**: un nombre, por ejemplo «Biblioteca (Supabase)». **Connection**: Host =
el de la cadena (`aws-...pooler.supabase.com`), Port `5432`, Maintenance database `postgres`, Username `postgres.<proyecto>`, la contraseña
de tu base y «Save password». **Parameters**: SSL mode `require`. **Save**. Luego, **Databases → postgres → Schemas → biblioteca → Views**.

### Correo

Los comprobantes de reservas y de solicitudes de solvencia llegan por correo (con el comprobante en HTML y en texto). Hay cuatro modos y
el servidor elige según sus variables (modelo en `backend/.env.example`):

- **API de Gmail** (`CORREO_API=gmail`, con `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` y `GMAIL_REFRESH_TOKEN`): gratis con una cuenta
  de Gmail normal (unos 500 correos al día) y va por HTTPS, así que funciona en Render y Railway. Ver «Correo con Gmail» abajo.
- **API de otro servicio de correo** (`CORREO_API=brevo` o `resend`, con `CORREO_API_KEY`). Railway (planes Free, Trial y Hobby) y
  Render (servicios gratuitos) bloquean los puertos SMTP, y la API va por HTTPS.
- **SMTP** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`): Gmail, Microsoft 365 o el servidor de la universidad. Gmail y
  Microsoft 365 piden una «contraseña de aplicación».
- **Simulado** (sin nada configurado): los correos se arman pero no salen. La pantalla de comprobante lo explica a quien lo pide.

`CORREO_REMITENTE` es la dirección desde la que se envía (en la API debe estar verificada en el servicio). En el panel, **Correo**
(solo el administrador), se ve cómo quedó, se comprueba la conexión (SMTP o Gmail), se manda un correo de prueba y se ven los últimos
envíos con sus errores. Si el correo falla, la reserva o la solicitud siguen adelante: la persona tiene su comprobante en pantalla.

Si la persona dejó su correo, el comprobante sale **solo al confirmar** y la pantalla dice cómo le fue (enviado, en camino, falló o
correo apagado); el campo para mandarlo aparece solo si no dejó correo, si el envío falló o si lo quiere en otro correo. El
comprobante en pantalla tiene el mismo diseño y los mismos datos que el correo (franja azul con la biblioteca, línea roja, los datos y
las indicaciones). **Imprimir comprobante** imprime esa misma hoja en tamaño carta; en el kiosco imprime el ticket angosto de 80 mm
para la impresora térmica.

#### Correo con Gmail (gratis y sin que venza el token)

Se hace una sola vez, con la cuenta de Gmail que enviará los correos (mejor una de la biblioteca que una personal):

1. **Proyecto.** En [Google Cloud Console](https://console.cloud.google.com/) crea un proyecto (por ejemplo «Biblioteca correo»). No
   pide tarjeta: la API de Gmail es gratuita.
2. **Activar la API.** **APIs y servicios → Biblioteca**, busca **Gmail API** y pulsa **Habilitar**.
3. **Pantalla de consentimiento.** **APIs y servicios → Pantalla de consentimiento de OAuth** (o **Google Auth Platform**): tipo
   **Externo**, nombre de la app «Biblioteca», tu correo como soporte y contacto. En **Permisos** (Data access) no hace falta agregar nada.
4. **Publicar la app (lo que evita que el token venza).** En **Público** (Audience) pulsa **Publicar app** para pasarla a **En producción**.
   Si se queda en **Prueba**, Google anula el refresh token **a los 7 días** y el correo deja de salir. No hace falta pedir la
   verificación de Google: como la usa solo tu cuenta, basta con aceptar el aviso «Google no verificó esta app» (Avanzado → Ir a
   Biblioteca).
5. **Credenciales.** **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**, tipo **App de escritorio**.
   Descarga el JSON (botón de descarga) y guárdalo fuera del repositorio.
6. **Generar el token.** En tu computadora:

   ```bash
   cd backend
   npm run token-gmail -- ruta/al/client_secret_XXXX.json
   ```

   Se abre el navegador: entra con la cuenta de Gmail y acepta «Enviar correo electrónico en tu nombre». El script escribe en
   `backend/.env` `CORREO_API=gmail`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` y `CORREO_REMITENTE` (si no
   estaba), y los muestra en la consola. Si ya pusiste `GMAIL_CLIENT_ID` y `GMAIL_CLIENT_SECRET` en `.env`, basta `npm run token-gmail`.
7. **Publicado.** En Render, **Environment**, agrega esas mismas cinco variables y guarda (se reinicia solo). En el panel, **Correo →
   Comprobar la conexión** debe decir «Google aceptó las credenciales de tu-cuenta@gmail.com»; después manda un correo de prueba.

El servidor guarda en memoria el token de acceso (dura una hora) y pide otro solo antes de que venza: no hay que hacer nada más. El
refresh token sigue sirviendo indefinidamente salvo que: la app vuelva a **Prueba**; se quite el acceso en
[myaccount.google.com/permissions](https://myaccount.google.com/permissions); se cambie la contraseña de la cuenta; o pasen 6 meses
sin usarlo. En esos casos el panel lo dice («Google ya no acepta GMAIL_REFRESH_TOKEN») y basta repetir el paso 6. `CORREO_REMITENTE`
debe ser esa misma cuenta (o un alias suyo configurado en Gmail); el nombre entre comillas es el que verá quien reciba el correo.

### Cargar el catálogo

En el panel, **Catálogo → Importar**: sube la hoja de cálculo del catálogo en CSV (hay una plantilla para descargar) o agrega
las tesis una por una. El código de cada tesis no se cambia después: está impreso en el QR de su etiqueta. Las columnas `url`
(la URL de la tesis) y `acceso` (descarga, consulta o sin acceso) son opcionales: con ellas cada tesis llega con su documento digital.

### Datos importantes de las tesis

Código, título, autor y año son obligatorios. Además, en **Configuración → Datos importantes de las tesis** el administrador marca qué
otros datos debe tener una tesis completa (director, páginas, temas, resumen, signatura; de entrada, los cuatro primeros). Una tesis
que llega sin alguno se registra igual, porque a veces la entregan así, pero en el catálogo del panel queda marcada «Incompleta: falta
…», se puede filtrar con «Les faltan datos importantes» y el resumen dice cuántas hay. El formulario marca esos datos como
«Importante» y avisa antes de guardar si falta alguno; la importación dice cuántas filas llegaron incompletas.

### Buscar en el catálogo

La búsqueda (la del sitio y la del panel) no distingue tildes, eñes ni mayúsculas, y no pide escribir el título exacto: basta con
algunas palabras, en cualquier orden («conciliacion familia» encuentra «La conciliación extrajudicial… en los procesos de familia»).
El autor se puede escribir con el apellido primero («Fonseca, Mariana»). Un código con guion o punto («T-2021-00045») se busca como un
bloque, así encuentra su tesis y no otras. Los resultados salen del año más reciente al más antiguo.

### Agregar una tesis y su código QR

En **Catálogo → Agregar tesis** se escriben los datos de la tesis y su **URL** (el enlace de su versión digital). Con esa URL el
sistema genera el código QR de la etiqueta: se ve al instante en el formulario, se puede descargar como imagen (PNG) y, al
guardar, imprimir la etiqueta de contraportada. El nivel de acceso (descarga, solo consulta o sin acceso) se elige en el mismo
formulario.

El código puede llevar a tres destinos:

- **Al documento, con el enlace corto de la biblioteca** (lo que sale por defecto): el código lleva `https://<tu-sitio>/r/<código>`
  y el servidor abre la URL de la tesis que esté guardada en ese momento. Si la URL cambia, la etiqueta ya impresa sigue sirviendo, y
  cada escaneo se cuenta en las estadísticas. Necesita que el sitio esté en línea (y en la misma dirección: si cambias de dominio,
  conserva el anterior o reimprime).
- **Al documento, con su URL tal cual**: el código lleva escrita la URL. Sirve aunque este sitio no esté en línea, pero si la URL
  cambia hay que reimprimir la etiqueta y no se cuentan los escaneos.
- **A la ficha de la tesis en este sistema**: una dirección estable; se cuentan los escaneos y el sistema controla el acceso
  (propuesta, sección 4.3).

El destino se cambia tesis por tesis en **Códigos QR**. Si la tesis no tiene URL, está «sin acceso digital» o su código está
desactivado, el código siempre lleva a la ficha. El código QR que se ve en la ficha pública es el mismo que va impreso en la etiqueta.
Las tesis que ya tenían su código con la URL tal cual siguen así: las etiquetas impresas no cambian.

**Enlaces rotos.** El servidor revisa solo que la URL de cada tesis siga respondiendo: cada hora pasa por las que toca (las nuevas o
con la URL cambiada, las correctas una vez por semana y las rotas cada día), a un pedido por segundo para no cargar al sitio donde están
los documentos. En **Códigos QR** se ve cuántos enlaces están rotos, se filtran y hay un botón «Revisar ahora»; el resumen del panel y
el menú avisan de los rotos, y la actividad anota cuáles dejaron de responder o volvieron a funcionar. Antes de dar un enlace por roto
lo intenta dos veces, y si el sitio contesta pero rechaza las revisiones automáticas (errores 401, 403 o 429) lo marca «No se pudo
comprobar» en vez de «roto», para abrirlo a mano. `VERIFICAR_ENLACES_DIAS` cambia cada cuántos días (0 la apaga).

Mientras una tesis no tiene URL, su documento digital es un PDF de ejemplo que el sistema arma con los datos del catálogo: portada
con el logo, ficha, resumen con palabras clave, cómo citarla y condiciones de uso, con encabezado y número de página (y una marca de
agua «solo consulta» si ese es su nivel de acceso). Al escribir la URL, el documento y el QR pasan a ese archivo.

### Dirección y redes de la biblioteca

La dirección, el enlace «Cómo llegar» y las redes (Facebook, Instagram y YouTube) que se ven en la franja superior, en el inicio
(«Horarios y ubicación») y en el pie están en `frontend/src/shared/config/library.js`. En un kiosco no se muestran los enlaces a
otros sitios.

### Horarios de reserva

En el panel, **Horarios y cierres** (solo el administrador): las horas en que se aceptan reservas por día de la semana y los días
de cierre. Solo se ofrecen horas enteras que caben completas dentro de un tramo.

### Reservas por horas (todos los lugares de estudio)

Los cubículos, las estaciones y las sillas de la sala de lectura se reservan igual, por horas enteras: la persona toca el lugar en el
plano y escribe de qué hora a qué hora lo necesita (por ejemplo, de 10:00 a 13:00). Si ya está reservado en esas horas, la pantalla avisa
(«Este cubículo ya está reservado. Intenta con otro cubículo o cambia la hora»; lo mismo para estaciones y sillas) y no deja confirmar.
La reserva debe ser de horas seguidas dentro del horario del día: no cruza la pausa del mediodía. Una persona no puede tener dos
lugares reservados a la misma hora. En **Configuración** el administrador fija cuántas horas puede reservar una persona por vez y en
total al día entre todos los lugares (al empezar, 8 y 8).

### Atención de las reservas (personal)

En el panel, **Reservas** (administración y circulación) muestra cuánto lugar queda de cada tipo, quién está adentro y a quién se
espera, y cada reserva con el lugar que tomó («Cubículo 3», «Estación 12», «Mesa 2 · Silla 3»). Con cada una el personal puede:

- **Llegó**: sella el ingreso.
- **No llegó**: libera el lugar ahora mismo, por ejemplo si la persona avisó que no vendrá. Si nadie lo hace, el sistema lo libera solo
  pasado el tiempo de tolerancia.
- **Se fue**: sella la salida. Si la persona se va antes de que termine su hora, las horas que no usó quedan libres para que otra
  persona las reserve (la hora que ya empezó cuenta como usada y siempre se conserva al menos una), y su tope de horas del día baja
  con ellas. Una reserva en uso se da por finalizada sola cuando termina su hora.
- **Cancelar**: cancela una reserva vigente. Las ya finalizadas, liberadas o canceladas no se tocan: son el historial.

Si la persona dejó su correo al reservar, se entera por correo de que su reserva se canceló o se liberó. Todo queda en la actividad del
personal.

**Penalización por no presentarse.** Si alguien no llega a su reserva y el sistema la libera sola al pasar la tolerancia, esa persona
queda **48 horas sin poder reservar** ningún lugar de estudio (contadas desde que venció la tolerancia), y las otras reservas que tenía
para ese tiempo se cancelan para que otra persona use el lugar. Al intentar reservar se le dice hasta cuándo; si dejó su correo, le
llega un aviso. En **Reservas** aparece la lista «Sin poder reservar por no presentarse» con el botón **Quitar penalización** (por
ejemplo, si avisó y no se registró el aviso), y al buscar su carné se ve el aviso. Si el personal libera la reserva a mano con
**No llegó** (avisó que no vendría), no hay penalización. Las horas se cambian en **Configuración** (0 la apaga).

**Plano y boleta de uso.** Cada reserva de la tabla muestra un plano pequeño de la sala con su lugar marcado en rojo. Arriba, en
**Boleta de uso: buscar por carné**, el personal escribe el carné del estudiante que llega, ve sus reservas con el plano y pulsa
**Imprimir boleta**. La boleta es la misma hoja que la biblioteca usa en papel, con el nombre, el carné, el lugar, la fecha y el horario
ya llenos:

- **Cubículos** (hoja carta): «Reserva de Cubículo», con la tabla del equipo en buen o mal estado (pizarrón, mesa, sillas, marcadores,
  almohadilla, pared, casillero, aire acondicionado, paredes de vidrio), las normas de uso (la tolerancia sale de la configuración),
  las firmas, los documentos de préstamo y el día y las horas que reservó (solo su horario, no el de toda la semana).
- **Estaciones y sala de lectura** (media carta): el número de la estación (o la mesa y la silla), los accesorios, los documentos de
  préstamo, las horas de entrada y salida, las condiciones de uso y las firmas.

Lo que el sistema no sabe (celular, llave, jornada o semestre, el documento que se deja y las horas reales) queda en blanco para
llenarlo a mano. El equipo de cada tipo de lugar se ajusta en `frontend/src/features/reservas/equipoDeLosLugares.js`.

## Kioscos

Cada kiosco abre el sitio con su número: `https://tu-servidor/?kiosco=1`, `?kiosco=2`... Con eso el sitio:

- muestra una pantalla de bienvenida y pide la pantalla completa con el primer toque (y la vuelve a pedir si se sale de ella);
- cierra la sesión y borra lo escrito tras 90 segundos sin tocar la pantalla (con un aviso de 15 segundos), o si la pestaña
  queda oculta o pierde el foco;
- bloquea menú contextual, selección de texto, zoom, atajos de las herramientas del navegador, enlaces a otros sitios y ventanas
  nuevas, y no ofrece descargas;
- cuenta cada kiosco en las estadísticas;
- no puede abrir el panel del personal (`/privateAccess`).

**Una página web no puede, por sí sola, impedir que alguien cambie de ventana o escriba otra dirección.** Para un candado
completo el equipo debe estar configurado como kiosco:

- **Navegador en modo kiosco.** En Chrome o Edge, por ejemplo:
  `chrome.exe --kiosk "https://tu-servidor/?kiosco=1" --incognito --noerrdialogs --disable-infobars --disable-pinch --overscroll-history-navigation=0 --kiosk-printing`
  (`--kiosk-printing` imprime el ticket en la impresora predeterminada sin pedir confirmación).
- **Sistema operativo.** En Windows, usa «acceso asignado» (modo kiosco de una sola aplicación) con una cuenta sin privilegios; en
  Linux, una sesión que arranque solo el navegador. Así no hay barra de tareas, ni Alt+Tab, ni escritorio.
- **Red.** Define `KIOSCOS_IP` en `backend/.env` con las direcciones fijas de los kioscos: el servidor les niega el panel del
  personal, su API y el inicio de sesión, aunque alguien escriba la dirección.
- **Salida del personal.** Para quitar el modo kiosco de una pestaña (mantenimiento), abre `/?kiosco=salir`. Cerrar el navegador
  del kiosco requiere el teclado del equipo.

## Roles del panel

| Rol | Qué puede hacer |
| --- | --- |
| Administrador | Todo: cuentas del personal, configuración (tolerancia, penalización, horas de las reservas y pausas), horarios y cierres, catálogo, actividad |
| Personal de circulación | Reservas, solicitudes de solvencia y usuarios |
| Personal de tesis | Catálogo, documentos digitales y códigos QR |
| Consulta | Solo estadísticas |

El servidor comprueba el rol en cada petición; ocultar una sección en el panel es solo comodidad.

### Estadísticas por período

En **Estadísticas** (administración y consulta) se elige qué período ver: **Día**, **Semana** (de lunes a domingo), **Mes** o **Año**,
con flechas para ir al anterior o al siguiente y un atajo para volver al actual; **Todo** lo registrado, o **Entre fechas** (desde y
hasta, los dos días incluidos). Abre en el mes en curso. Las reservas cuentan por el día en que se usa el lugar; las búsquedas,
consultas, accesos por QR, comprobantes, solicitudes y sesiones de kiosco, por el día en que ocurrieron (hora de Guatemala). Además de
los totales, la demanda por hora y por día y las tesis más consultadas del período, la tarjeta **Cómo terminaron las reservas** dice
cuántas se atendieron, cuántas personas no se presentaron, cuántas se cancelaron o liberó el personal, las horas reservadas y qué
porcentaje de quienes reservaron llegó. La API es `GET /api/admin/estadisticas?desde=2026-10-01&hasta=2026-10-31` (sin fechas, todo).

### Protección de rutas

- **En el navegador**, una guardia corre antes de mostrar cualquier página de `/privateAccess/...`: sin sesión manda al inicio de sesión (y al
  entrar vuelve a la página que se quería ver), con una sesión que el servidor ya no reconoce la cierra y avisa, y con una sección que
  el rol no puede ver redirige al resumen con un aviso. Una pestaña de kiosco no entra al panel.
- **En el servidor**, toda ruta del personal exige una sesión y el rol correcto (401 sin sesión, 403 con otro rol); con `KIOSCOS_IP`
  los kioscos ni siquiera llegan al panel ni a su API. Las respuestas de la API del personal no se guardan en cachés y el panel no se
  indexa en buscadores (`X-Robots-Tag` y `robots.txt`).
- La dirección del panel se define en `frontend/src/shared/config/rutas.js` y en `backend/utils/rutas.js` (las dos deben coincidir, y
  hay que volver a compilar el sitio). `/admin` ya no existe. Un nombre poco evidente evita visitas por costumbre, pero lo que protege
  el panel es el inicio de sesión y los roles: este repositorio es público y el nombre se puede leer en él.
- Las sesiones se guardan (de cada una, solo la huella de su ficha de acceso: con lo guardado no se puede entrar), así que sobreviven a
  un reinicio del servidor. Se cierran al salir, al cambiar la clave, el rol o el estado de la cuenta, y al restablecer claves.
- **Protecciones del navegador.** Cada página del sitio lleva una política de contenido (CSP): el navegador solo ejecuta los scripts que
  sirve este servidor y solo deja que la página hable con él, así que un script colado en una página no corre ni puede mandar datos
  afuera. Lo permitido es lo que el sitio usa (sus archivos, las tipografías de Google Fonts y el visor del documento de la tesis); si
  se agrega algo de otro origen (un mapa, un video), hay que sumarlo en `POLITICA_DE_CONTENIDO` (`backend/server.js`). Cuando la visita
  llega por HTTPS se manda además HSTS, para que el navegador no vuelva a HTTP (detrás de un proxy hace falta `TRUST_PROXY`).
  `CSP=0` y `HSTS=0` las apagan.
- Las sesiones duran 8 horas, se cierran tras 20 minutos sin actividad y una cuenta se bloquea 5 minutos después de 5 intentos
  fallidos.
