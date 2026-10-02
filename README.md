# Bitácora Diaria por Área — Diseñarte México

PWA sin build step que corre en el **VPS con Easypanel** (contenedor Docker con `servidor.mjs`). Cada persona entra
con su cuenta y sus bitácoras se guardan en **PostgreSQL**; también se copian en el dispositivo para seguir
capturando sin internet.

## Desplegar en Easypanel

1. **DNS:** crea un registro `A` del subdominio (p. ej. `bitacora.disenartemx.com`) hacia la IP del VPS.
2. **Easypanel → tu proyecto → + Service → App**, nombre `bitacora`.
3. **Source → GitHub:** repo `It-disenarte/appBitacorasDisenarte`, rama `main`.
   **Build:** `Dockerfile` (está en la raíz). Activa **Auto Deploy** para que cada push despliegue solo.
4. **Environment:**

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | `postgres://USUARIO:CONTRASEÑA@NOMBRE_DEL_SERVICIO_POSTGRES:5432/BASE` (host **interno** de Easypanel) |
   | `GEMINI_API_KEY` | tu API key de Google AI Studio |
   | `GEMINI_MODEL` | opcional |

   Usa el host interno que Easypanel muestra en el servicio de Postgres (`proyecto_servicio`): así la base
   **no necesita ningún puerto público**.
5. **Domains:** agrega el subdominio, puerto **3000**, HTTPS activado (Easypanel saca el certificado solo).
   HTTPS es obligatorio: sin él no funcionan el micrófono, la instalación ni el modo sin internet.
6. **Deploy.** Revisa `https://TU-SUBDOMINIO/api/estado`: debe decir `baseDeDatos: Conectada…`.
7. **Abre la app de inmediato:** aparece la **Configuración inicial**, donde capturas tu nombre, correo y
   contraseña de administrador. Esa pantalla desaparece para siempre al existir la primera cuenta.
8. Entra a **Usuarios** (menú) y crea las cuentas del equipo. Cada una recibe una contraseña temporal que la
   app pide cambiar en el primer acceso.

La app crea sus tablas sola (`bitacora_usuarios`, `bitacora_sesiones`, `bitacora_dias`); el prefijo permite compartir
la base con otras apps. `GET /api/salud` es el chequeo de vida del contenedor.

Sin `GEMINI_API_KEY` la app funciona igual: la transcripción marca error (el audio se conserva y se puede escribir
a mano) y al cerrar el día se arma un borrador con las entradas tal cual, editable antes de exportar.

> Las funciones de `/api` siguen siendo compatibles con Vercel (`vercel.json`), por si algún día se quiere volver.

## Probar en tu computadora

```
npm install
cp .env.example .env      # llena DATABASE_URL (y GEMINI_API_KEY si quieres IA)
npm start                 # http://localhost:3000
```

## Cuentas y datos

- **Roles:** `admin` (captura sus bitácoras y administra usuarios) y `usuario` (solo sus bitácoras).
  Siempre queda al menos un admin activo; nadie puede quitarse el rol ni desactivarse a sí mismo.
- **Sesión:** cookie HttpOnly de 30 días que se renueva sola; las contraseñas se guardan con scrypt.
  Tras 5 intentos fallidos la cuenta se bloquea 10 minutos (restablecer la contraseña la desbloquea).
- **Sincronización:** cada cambio se guarda en el dispositivo y se sube a los pocos segundos. Sin internet se
  acumula y se sube al volver la conexión. Si dos dispositivos editan el mismo día, gana el cambio más reciente.
- **Audios:** se quedan en el dispositivo donde se grabaron (IndexedDB); en el servidor va el texto.
- Las bitácoras que había en un dispositivo antes de las cuentas pasan solas a la primera cuenta que entra en él.

## Archivos

```
index.html               shell: menú lateral morado (escritorio) y barra superior + cajón (celular)
styles.css               línea de diseño unificada de Diseñarte (estándar: Cotizador), solo tema claro
app.js                   toda la app (acceso, router, captura, sincronización, usuarios, PDF, asistente)
api/_servidor.js         Postgres, sesiones, contraseñas y validación
api/sesion.js            estado de la sesión, entrar y salir
api/configuracion-inicial.js  crea el primer admin (solo mientras no hay cuentas)
api/cuenta.js            nombre, área y cambio de contraseña propios
api/usuarios.js          panel de administración (solo admin)
api/dias.js              bitácoras de la cuenta
api/transcribir.js       audio → texto (Gemini), requiere sesión
api/generar.js           entradas del día → actividades + conclusión, requiere sesión
api/cierre.js            conclusión del día, requiere sesión
api/_gemini.js           cliente + glosario del negocio
servidor.mjs             servidor Node (VPS y local): sirve la app y las funciones de /api
Dockerfile               imagen que construye Easypanel
sw.js                    service worker, funciona offline (sube CACHE al cambiar archivos)
manifest.webmanifest     instalable
fonts/                   Poppins incluida (woff2 para la interfaz, TTF para el PDF)
img/textura.jpg          textura de fondo del manual (al 7 %)
icons/, favicon.ico      hoja morada con libreta; se generan con `node scripts/iconos.cjs`
```

## Qué falta respecto al spec

- **Audios en el servidor:** hoy solo viajan para transcribirse; el archivo se queda en el dispositivo.
- **Bitácoras compartidas por área:** cada cuenta tiene las suyas; el admin todavía no ve las de los demás.
- **Logo en PDF**: el encabezado del PDF usa texto y el filete de marca; el ícono de la app está en `/icons/`.

## Atajos (escritorio)

`Espacio` grabar / detener · `Esc` cancelar grabación · `Ctrl+S` guardar edición

La grabación es de un toque: se abre la grabadora, se detiene con **Detener y guardar** o se descarta con la **X**.
