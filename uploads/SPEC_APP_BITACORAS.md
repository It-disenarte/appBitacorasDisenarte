# Bitácora Diaria por Área — Diseñarte México

**Especificación de producto y diseño para construcción de PWA**

Versión 1.0 · Agosto 2026 · Área de Marketing e Innovación Digital

---

## 1. Qué es esto

Una **bitácora de trabajo diaria por área**. Durante el día, cualquier integrante del área (producción, diseño, instalación) abre la app y captura lo que hizo o lo que pasó —dictando por voz o escribiendo. Al cierre del turno, una IA toma todas esas entradas juntas y las convierte en una bitácora ordenada: actividades con título y descripción, más una conclusión del día.

El usuario revisa el resultado, corrige lo que haga falta y exporta un PDF que le manda al gerente. Ahí termina el flujo.

### Lo que la app NO hace

- ❌ No es un sistema de asistencia ni de horas trabajadas
- ❌ No mide desempeño individual ni genera rankings
- ❌ No liga actividades a clientes, proyectos ni cotizaciones
- ❌ No tiene panel de dirección ni dashboards: el gerente recibe un PDF, no entra a la app
- ❌ No tiene flujos de aprobación, firmas ni comentarios
- ❌ No manda notificaciones a nadie más que al propio usuario

**El entregable es un PDF.** Todo lo que no sirva para producir ese PDF, sobra.

### El rol de la IA

Dos tareas, ninguna más:

1. **Transcribir** las notas de voz a texto
2. **Estructurar** el conjunto de entradas del día en actividades y una conclusión

No evalúa, no califica, no sugiere mejoras, no detecta problemas. Redacta. Y todo lo que redacta es editable por el usuario antes de salir.

---

## 2. El usuario y su contexto

**Quién:** personal operativo de un área de Diseñarte México. Producción, diseño, instalación.

**Dónde:** taller, oficina, planta. Con red disponible.

**Cuándo:** en ratos sueltos durante el día, y una revisión al cierre del turno.

**El riesgo de adopción que el diseño debe combatir:**

Esta app le agrega una tarea al usuario, no se la quita. Si se percibe como vigilancia, la gente va a capturar "estuve trabajando" y la bitácora no servirá de nada. Dos decisiones de diseño lo contrarrestan:

- **Capturar debe costar menos de 20 segundos.** Mantener presionado, hablar, soltar. Si hay que escoger área, fecha y categoría antes de hablar, nadie lo hace.
- **El usuario recibe algo de vuelta.** Al final del día tiene su reporte ya redactado y presentable. La app le ahorra el reporte que de todos modos le iban a pedir.

**La bitácora es del área, no de las personas.** Internamente se guarda quién capturó cada entrada, pero el PDF habla del área en tercera persona: "se atendieron 4 órdenes de corte", nunca "Juan hizo esto". Reportar un problema no debe sentirse como autodelatarse.

---

## 3. Estructura

```
🏭 ÁREA               "Producción"
   │
   └── 📅 DÍA          "12 de agosto de 2026"
          │
          ├── 🎙️ Entrada 09:15 — audio (transcrita)
          ├── ✍️ Entrada 11:40 — texto
          ├── 🎙️ Entrada 14:02 — audio (transcrita)
          │
          └── 📋 BITÁCORA GENERADA
                 ├── Actividad 1: título + descripción
                 ├── Actividad 2: título + descripción
                 ├── Actividad 3: título + descripción
                 └── Conclusión del día
```

**Entradas append-only.** Nadie edita lo que capturó otro; cada quien solo agrega. Esto elimina los conflictos de escritura simultánea sin necesidad de bloqueos.

**La IA procesa el conjunto, nunca entrada por entrada.** Si alguien dice a las 9 "se atoró la impresora", otro a las 11 "ya vino el técnico" y otro a las 3 "quedó, terminamos", son tres entradas sueltas pero **una sola actividad**. Solo viendo todo junto se puede escribir: *"Falla en impresora — paro de 2 horas, resuelto con técnico externo, trabajo entregado."*

---

## 4. Estados del día

| Estado | Qué significa |
|---|---|
| **Abierto** | Se pueden agregar entradas. Es el estado durante la jornada. |
| **Generado** | Se cerró el día, la IA produjo la bitácora. Editable. |
| **Listo** | El usuario revisó. Se puede exportar y re-exportar libremente. |

**El cierre no depende de que alguien se acuerde.** Se cierra automáticamente a una hora fija configurable por área (fin de turno), y la IA genera la bitácora sola. También hay un botón manual de **Cerrar día** por si terminan antes.

Si nadie capturó nada, el día se cierra sin bitácora. No se inventa contenido.

---

## 5. Pantallas

### 5.1 Hoy — pantalla principal

Es la pantalla de arranque. Debe poder capturarse desde aquí sin navegar a ningún lado.

- Encabezado: nombre del área, fecha de hoy, estado del día
- **Botón de captura, grande y dominante**, fijo en la parte inferior
  - Mantener presionado → graba audio, muestra onda y contador
  - Soltar → se guarda y transcribe
  - Toque corto → abre el campo de texto
- Lista de entradas del día en orden cronológico, la más reciente arriba
  - Cada una con hora, inicial o avatar de quien capturó, y su texto
  - Las de audio con un botón de reproducir
  - Toque largo sobre una entrada propia → eliminar
- Estado de transcripción visible: procesando / listo / falló (con reintento)
- Si el día ya está cerrado, el botón de captura se reemplaza por **Ver bitácora**

### 5.2 Bitácora generada

- Encabezado con área y fecha
- **Actividades como tarjetas editables**, numeradas
  - Toca el título → se edita ahí mismo
  - Toca la descripción → se edita ahí mismo
  - Menú por tarjeta: eliminar, reordenar
  - Si la actividad salió de entradas de audio, botón para **escuchar los audios originales**
- **+ Agregar actividad** manual, para lo que se olvidó capturar
- **Conclusión** en un bloque destacado, editable como texto libre
- **Regenerar** — vuelve a pedirle a la IA que lo intente, con advertencia de que se pierden las ediciones
- Botón principal: **Exportar PDF**

> **Escuchar el audio original desde cada actividad es lo que hace confiable la revisión.** Sin eso, corregir es adivinar.

### 5.3 Historial

- Lista de días anteriores del área, agrupados por mes
- Cada renglón: fecha, número de actividades, estado
- Entrar a cualquiera para leer o re-exportar
- Buscador simple por texto

### 5.4 Exportar

Vista previa del PDF y dos acciones:

- **Descargar**
- **Compartir** (`navigator.share`) — manda el PDF directo a WhatsApp o correo sin pasar por la carpeta de descargas

El botón de exportar se habilita hasta que el usuario entró a la pantalla de bitácora. No es un bloqueo burocrático: es que el primer PDF con una barbaridad transcrita que llegue al gerente le quita credibilidad a la app entera.

---

## 6. El PDF

Nombre de archivo: `Bitacora_Produccion_2026-08-12.pdf`

**Estructura:**

- **Encabezado** — logo Diseñarte a color, nombre del área, fecha larga
- **Actividades** numeradas, cada una con su título en peso fuerte y su descripción debajo
- **Conclusión del día** en un bloque con fondo tenue y acento de marca a la izquierda
- **Pie** — quiénes capturaron durante el día (nombres, sin desglosar quién dijo qué), total de entradas, y la marca

Generado en el dispositivo con jsPDF. Sin acentos ni espacios en el nombre del archivo. Re-exportable cuantas veces se quiera.

---

## 7. Identidad visual

Basada en el Manual de Marca de Diseñarte México, aplicada sobre **Material Design 3**.

### 7.1 Material Design 3 con la marca

MD3 genera sus paletas tonales a partir de un color semilla. Aquí:

- **Seed color:** `#A53692` (morado corporativo)
- **Esquema:** claro por defecto, con soporte de tema oscuro

**Mapeo de roles MD3:**

| Rol MD3 | Color | Hex |
|---|---|---|
| `primary` | Morado corporativo | `#A53692` |
| `on-primary` | Blanco | `#FFFFFF` |
| `primary-container` | Morado muy claro | `#FBD9F2` |
| `secondary` | Turquesa | `#5CC6D0` |
| `secondary-container` | Turquesa claro | `#D4F2F5` |
| `tertiary` | Morado profundo | `#7C07A6` |
| `surface` | Blanco roto | `#FDF8FB` |
| `surface-variant` | Gris muy claro | `#F1EEF0` |
| `outline` | Gris corporativo | `#96989A` |
| `on-surface` | Grafito | `#1D1B1E` |
| `error` | Rojo MD3 | `#B3261E` |

**Componentes MD3 a usar:**

- **FAB extendido** para el botón de captura (es la acción dominante de la app)
- **Cards** con elevación nivel 1 para entradas y actividades
- **Top app bar** tipo *small*, que colapsa al hacer scroll
- **Navigation bar** inferior de 3 destinos: Hoy · Historial · Perfil
- **Filled buttons** para acciones principales, **outlined** para secundarias
- **Text fields** tipo *outlined* para la edición en línea
- **Snackbars** para confirmaciones, nunca diálogos para cosas menores
- **Bottom sheets** para el editor de texto y las opciones de exportación

**Ripple, elevación y transiciones de MD3 tal cual.** No inventar interacciones nuevas: la gracia de Material es que ya se sabe usar.

### 7.2 Tipografía

El manual de marca especifica **Creato Display** y **Walkway**. Como no están en Google Fonts:

```css
font-family: 'Creato Display', 'Outfit', Roboto, system-ui, sans-serif;
```

`Outfit` es el sustituto más cercano a Creato Display. Si se consiguen las licencias, se carga la real y Outfit queda de fallback.

**Escala tipográfica MD3 aplicada:**

| Rol MD3 | Uso en la app | Tamaño / peso |
|---|---|---|
| `headline-small` | Título de pantalla | 24 px / 600 |
| `title-medium` | Título de actividad | 16 px / 600 |
| `body-large` | Descripción de actividad | 16 px / 400 |
| `body-medium` | Texto de entrada | 14 px / 400 |
| `label-large` | Botones | 14 px / 500 |
| `label-small` | Hora, metadatos | 11 px / 500 |

### 7.3 Logotipo

Se entregan `COLOR.png`, `NEGRO.png`, `BLANCO.png` y `OUTLINE.png`.

- **Splash y encabezado del PDF:** versión a color
- **Top app bar sobre morado:** versión blanca
- Área de protección de 1x alrededor, libre de otros elementos
- No distorsionar, no recolorear, no cambiar tipografía, no reordenar

### 7.4 Tono de la interfaz

Es una herramienta de trabajo de fin de turno, no una app de productividad motivacional.

- Sin frases de ánimo, sin rachas, sin gamificación, sin emojis en la interfaz
- Estados vacíos que invitan a actuar sin regañar: *"Aún no hay entradas de hoy. Mantén presionado para dictar la primera."*
- Errores que explican qué pasó y cómo seguir: *"No se pudo transcribir. El audio está guardado — reintentar o escribir el texto."*
- Verbos en activa, mismo nombre de la acción en todo el flujo: si el botón dice **Exportar PDF**, el mensaje de confirmación dice **PDF exportado**

---

## 8. Responsive

La app se usa en celular la mayor parte del tiempo, pero también en la computadora del taller para la revisión de fin de día. Debe funcionar bien en los tres tamaños:

### Móvil (< 600 px) — prioritario

- Una sola columna
- Navigation bar inferior de 3 destinos
- FAB de captura fijo abajo a la derecha, por encima del contenido
- El editor de texto abre como bottom sheet
- Áreas táctiles mínimo **48×48 px**
- Padding lateral de 16 px
- Contenido que respeta el *safe area* del notch y la barra de gestos

### Tablet (600–1024 px)

- Navigation rail lateral en vez de barra inferior
- Padding de 24 px
- En la pantalla de bitácora, las tarjetas de actividad a ancho máximo de 720 px, centradas
- Diálogos en vez de bottom sheets

### Escritorio (> 1024 px)

- Navigation rail expandido con etiquetas
- **Dos paneles** en la pantalla de bitácora: entradas crudas a la izquierda, actividades generadas a la derecha. Permite corregir comparando contra lo que se dijo.
- Contenido con ancho máximo de 1200 px, centrado
- Atajos de teclado: `Espacio` para grabar, `Esc` para cancelar, `Ctrl+S` para guardar edición
- Foco de teclado siempre visible

**Ninguna función puede existir solo en un tamaño.** Si algo se puede hacer en escritorio, se puede hacer en celular, aunque sea con más toques.

**Respetar `prefers-reduced-motion`** desactivando las transiciones de MD3 cuando esté activo.

---

## 9. Stack técnico

- **React + Vite**, PWA instalable
- **Material Web Components** o **MUI v6** con el tema MD3 configurado con el seed `#A53692`
- **Supabase** — Postgres, Auth y Storage
  - Auth solo para saber a qué área pertenece cada usuario
  - Un solo rol de usuario: no hay jerarquías dentro de la app
  - Row Level Security filtrando por área
- **Gemini Flash** — recibe el audio nativamente para transcribir; procesa el conjunto de entradas para estructurar
- **jsPDF** para el PDF, generado en el dispositivo
- **MediaRecorder API** para el audio
- **Cron** (Supabase Edge Function programada) para el cierre automático del día

### Sobre el prompt de Gemini

Incluir un **glosario del negocio** en el prompt del sistema: materiales (trovicel, vinil, lona, acrílico, PVC), procesos (corte, laminado, rotulación, instalación) y nombres de clientes frecuentes. Sin el glosario, la transcripción escribe "trovi cel" y "vibro acústic". Con él, la calidad sube muchísimo.

**Salida en JSON estricto**, nunca prosa libre:

```json
{
  "actividades": [
    { "titulo": "", "descripcion": "" }
  ],
  "conclusion": "",
  "entidades_detectadas": []
}
```

`entidades_detectadas` guarda nombres propios que aparezcan (clientes, proveedores, equipos). **No se muestra en la interfaz ni se convierte en feature.** Se guarda porque cuesta cero ahora y es imposible de recuperar después: el día que se quiera buscar todo lo dicho sobre un cliente en el último año, el dato ya está.

### Reglas que no se negocian

- **El audio original nunca se borra**, aunque la transcripción se haya editado
- **Si la transcripción falla, el usuario escribe a mano y sigue.** Nunca bloquear el flujo por un error de IA
- **Todo lo que genera la IA es editable** antes de salir en el PDF

---

## 10. Modelo de datos

```js
Area {
  id, nombre, hora_cierre_automatico
}

Dia {
  id, area_id, fecha,
  estado: 'abierto' | 'generado' | 'listo',
  cerrado_en, revisado_en
}

Entrada {
  id, dia_id, usuario_id, hora,
  tipo: 'audio' | 'texto',
  contenido,          // texto escrito o transcripción editada
  transcripcion_raw,  // lo que devolvió la IA, sin editar
  audio_url
}

Bitacora {
  id, dia_id,
  actividades: [{ titulo, descripcion, entradas_ref[] }],
  conclusion,
  entidades_detectadas: [],
  generado_en, editado_en
}
```

`entradas_ref` liga cada actividad con las entradas que la originaron. Es lo que permite escuchar los audios originales desde la pantalla de revisión.

---

## 11. Prioridad de construcción

**Fase 1 — MVP**
1. Auth y asignación de área
2. Captura por texto
3. Captura por audio con transcripción
4. Cierre manual del día y generación con IA
5. Pantalla de revisión editable
6. Exportar PDF

**Fase 2 — Operación diaria**
7. Cierre automático por hora
8. Historial y búsqueda
9. Compartir nativo
10. Reproducir audios desde la actividad

**Fase 3 — Pulido**
11. Layout de dos paneles en escritorio
12. Tema oscuro
13. Agregar y reordenar actividades manualmente

**Probar la Fase 1 con un área real durante dos semanas antes de construir la Fase 2.** El área con más movimiento, no la más entusiasta.

---

## 12. Criterios de aceptación

- [ ] Capturar una entrada por voz toma menos de 20 segundos desde abrir la app
- [ ] Toda actividad y la conclusión se pueden editar antes de exportar
- [ ] Se puede escuchar el audio original desde cada actividad
- [ ] Si la transcripción falla, el usuario puede escribir el texto y continuar
- [ ] El PDF se entiende completo sin abrir la app
- [ ] El PDF nunca atribuye actividades a personas individuales
- [ ] Dos personas capturando al mismo tiempo no se pisan
- [ ] El día se cierra solo aunque nadie toque el botón
- [ ] Funciona en celular, tablet y escritorio sin perder funciones
- [ ] Todas las áreas táctiles miden mínimo 48×48 px
- [ ] El foco de teclado es visible en toda la app
- [ ] `prefers-reduced-motion` desactiva las transiciones

---

*Diseñarte México · Marketing e Innovación Digital · disenartemx.com*
