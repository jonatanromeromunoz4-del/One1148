# Preparación para migrar a Python + MySQL + servidor propio

Documento vivo. No es un plan cerrado ni prescriptivo — es la base de partida:
qué hay hoy, cómo está montado, y qué habría que construir para dejar de
depender de Firebase. Está pensado para revisarlo juntos antes de poner
fecha a nada.

**Resumen de una línea:** hoy no hay "backend" propiamente dicho — el
navegador habla directamente con Firebase. Migrar significa levantar un
servidor Python en medio (con su propia base de datos MySQL) que haga de
intermediario entre el HTML/JS que ya existe y los datos.

---

## 1. Qué hay hecho ya de cara a esta migración

Antes de nada, dos cosas que ya se prepararon en el propio código, sin
esperar a que empiece la migración de verdad:

- **El HTML/CSS de la portada del autodiagnóstico ya no está incrustado
  dentro de `app.js`.** Vive en `css/autodiagnostico.css` (hoja de estilos
  normal) y `config/autodiagnostico-landing.json` (todo el copy: títulos,
  bullets, pasos, áreas, audiencia, textos). Cambiar un texto o un estilo
  ya no requiere tocar JavaScript. Esto es exactamente el formato que
  necesitaríais el día de mañana: una plantilla HTML/CSS servida por el
  backend, con los textos viniendo de una fuente de datos aparte (hoy un
  JSON, mañana una tabla `landing_config` o similar).
- El resto de la app (panel interno, CRM) sigue siendo un único `app.js`
  grande. No lo he tocado en esta pasada — separar TODO el HTML del panel
  interno en plantillas es un trabajo mucho mayor que merece su propia
  conversación, no algo para colar de paso.

## 2. Arquitectura actual (para que quede constancia)

```
Navegador (app.js, ~1.5 MB, todo el HTML se genera con JS)
        │
        │  SDK de Firebase (lectura/escritura directa, sin servidor propio)
        ▼
Firebase Realtime Database
   ├── holding-data/            (árbol privado, requiere login)
   │     └── usuarios/<uid>     (un solo nodo con TODO el estado de la app)
   ├── auditoriasPublicas/<token>   (escritura pública sin login)
   └── propuestasPublicas/<token>   (escritura pública sin login)

Hosting: Vercel (estático, sin servidor propio)
```

Puntos importantes para la migración:

- **Todo el estado de la app vive en un único objeto `data`** que se lee y
  se guarda entero contra `holding-data/usuarios/<uid>`. No hay "tablas"
  independientes hoy — hay un JSON gigante con ~35 colecciones dentro. Eso
  es lo primero que cambia con MySQL: cada colección pasa a ser su propia
  tabla relacional, con claves foráneas de verdad en vez de vivir todas
  dentro del mismo blob JSON.
- **Las dos escrituras públicas sin login** (`auditoriasPublicas`,
  `propuestasPublicas`) son las más delicadas de migrar, porque hoy
  cualquiera con el enlace puede escribir directamente en la base de datos
  sin pasar por ningún control del lado servidor — Firebase lo permite
  porque las reglas de seguridad están abiertas para esos dos nodos
  concretos. Con MySQL + Python esto se resuelve de forma más segura de
  raíz: el navegador ya no tendría credenciales de base de datos, solo
  hablaría con un endpoint HTTP controlado por vosotros.
- **No hay tiempo real "gratis".** El aviso automático de "ha llegado un
  autodiagnóstico nuevo" funciona hoy porque Firebase empuja los cambios
  al navegador solo. Con MySQL no viene de serie — hay que decidir entre
  sondeo periódico (el navegador pregunta cada X segundos), WebSockets, o
  simplemente aceptar que se refresca al abrir la pantalla. Lo trato en el
  apartado 6.

## 3. Inventario de datos — las 35 colecciones de hoy

Extraído directamente del código (no de memoria), contando cuántas veces
se usa cada una como pista de qué tan central es.

### 3.1 — Núcleo de Servicios Profesionales (detalle completo)

Estas son las que hemos construido y tocado a fondo esta sesión, así que
el detalle de campos está sacado literalmente del código, no adivinado.

**`contactosSP`** (83 usos — la tabla más central del CRM de Servicios Profesionales)

| Campo | Tipo probable | Notas |
|---|---|---|
| `id` | string (PK) | hoy `'crmsp' + timestamp` |
| `contacto`, `cif`, `telefono`, `email`, `direccion`, `poblacion` | string | datos de la empresa/persona |
| `numEmpleados` | int | |
| `etapa` | string/enum | Contacto Iniciado, En Negociación, Cliente Captado, Descartado... |
| `probabilidad` | string/enum | |
| `origen` | string | de dónde vino el contacto |
| `prescriptor` | string (FK → prescriptoresSP.nombre) | hoy es texto libre, no un id — a limpiar en la migración |
| `responsable` | string (FK → usuarios.nombre) | mismo caso, texto libre hoy |
| `fechaPropuesta`, `fechaProximaAccion` | date | |
| `motivoDescarte`, `motivoDetalle` | string | |
| `comentariosGenerales` | text | |
| `serviciosOfertados` | JSON/array | lista de servicios con precio — candidato a tabla propia `contactos_servicios_ofertados` |
| `seguimiento` | JSON/array | notas de seguimiento con fecha — candidato a tabla propia `contactos_seguimiento` |
| `importePropuesta` | decimal | |
| `auditoria`, `auditoriaRealizada` | JSON / bool | respuesta del autodiagnóstico interno |
| `publicToken` | string | token del enlace público de autodiagnóstico |
| `seguimientoAutodiagnostico` | string/enum | Enviado / Sin Respuesta / Solicita Llamada / Quiere Contratar |
| `propuestaAutoGenerada`, `propuestaAceptada`, `propuestaAceptadaFecha` | bool/date | |

**`leadsSP`** (34 usos)

Mismo patrón que `contactosSP` pero antes de convertirse en contacto:
`id`, `cif`, `contacto`, `telefono`, `email`, `direccion`, `poblacion`,
`responsable`, `origen`, `prescriptor`, `estado`, `notas`, `publicToken`,
`auditoriaPublicaCompletada`, `auditoriaPublicaRespuesta`,
`seguimientoAutodiagnostico`, `contactoCrmId` (FK → contactosSP.id, se
rellena al convertir).

**`prescriptoresSP`** (45 usos — las gestorías colaboradoras)

`id`, `nombre`, `cif`, `contacto`, `telefono`, `email`, `direccion`,
`poblacion`, `responsable`, `etapa` (Por Contactar / Contacto Iniciado /
Presentación Enviada / En Negociación / Colaborador Activo / Descartado),
`comisionPct`, `comentariosGenerales`, `seguimiento` (array),
`ofertaEnviada`, `fechaColaboradorActivo`, `fechaDescartada`.

**`crmSPActividad`** (35 usos — histórico de eventos, no una ficha)

Log de actividad con `id`, `contactoId` (FK), `tipo` (`nuevo_contacto` /
`seguimiento` / `conversion` / `descarte`), `fecha`, `comercial`, `origen`.
Esta es la que alimenta las estadísticas — en MySQL sería una tabla de
eventos con índice por `contactoId` y por `fecha`.

**`crmSPTarifas`** (13 usos) — overrides de precio sobre `SP_TARIFAS_2026`
(que hoy vive como constante en el propio JS, no en la base de datos).

**`crmSPOkrObjetivos`** / **`crmSPPresOkrObjetivos`** (7 y 5 usos) —
objetivos numéricos de los OKR de Servicios Profesionales y de Prescriptores.

**Nodos públicos** (fuera de `holding-data`, sin autenticación):

- **`auditoriasPublicas/<token>`** — la respuesta cruda que el cliente
  rellena en el autodiagnóstico público: `empresa`, `contacto`, `email`,
  `sector`, `tipoPersona`, `numTrabajadores`, `numUsuarios`,
  `manejaAlimentos`, `tieneWeb`, `serviciosInteres`, `fecha`, más
  `interesContratacion` / `interesContratacionFecha` que se añaden después
  si el cliente pulsa "quiero contratarlo".
- **`propuestasPublicas/<token>`** — la propuesta generada automáticamente
  a partir de esa respuesta, con el desglose de precios.

### 3.2 — Resto del holding (ya verificado con el mismo detalle)

Pasada de verificación hecha: los campos de abajo están sacados
literalmente de las funciones de guardado de cada módulo, igual que en el
apartado 3.1 — ya no son una descripción aproximada.

**`eventos`** (65 usos — Agenda, el módulo más usado de toda la app)

`id`, `titulo`, `fecha`, `hora`, `empresa`, `responsable`, `proyecto` (FK
opcional), `estado` (Pendiente/...), `notas`. Los módulos de Servicios
Profesionales y del CRM de Comunidades **crean eventos automáticamente**
al fijar una "próxima acción" en un contacto — en MySQL esto sería un
`INSERT` en `eventos` disparado desde el mismo endpoint que guarda el
contacto, no un trigger de base de datos (más fácil de seguir el rastro).

**`usuarios`** (53 usos)

Un registro por persona con acceso a la app: `nombre`, `email`, `rol`
(`viewer` / `editor` / `admin`), `empresaPrincipal` (empresa empleadora,
1 sola), y una lista de **empresas con acceso** (puede ver varias, aunque
solo pertenezca a una) — hoy vive como un array/objeto embebido dentro
del propio usuario; en MySQL es la tabla puente `usuarios_empresas` del
esquema del apartado 4. También existe `accesoMyA` (checkbox aparte para
el módulo M&A, que no depende de la empresa asignada). Es la única
colección con contraseña — hoy la gestiona Firebase Auth por completo, en
la migración habría que decidir la librería de hashing (bcrypt/argon2) y
si se reaprovechan las contraseñas actuales (no es posible sin pedir a
cada usuario que la resetee, porque Firebase no expone el hash).

**`contactos`** (41 usos) y **`crmActividad`** (38 usos) — CRM de Comunidades

Este es un negocio bastante más complejo de lo que reflejaba la primera
versión de este documento: venden servicios (CAE, Certificados, RGPD,
Pack completo, y el servicio "Aifink") a **Comunidades de Propietarios**,
captadas a través de **AAFF** (administradores de fincas, que actúan como
prescriptores). Campos de identidad: `id`, `empresa_cliente`, `contacto`,
`telefono`, `email_contacto`, `direccion`, `poblacion`, `provincia`, `cp`,
`etapa`, `origenLead`, `prescriptorVisalia`, `competidor`,
`precioCompetidor`, `responsable`, fechas (`fechaDemo`, `fechaPropuesta`,
`fechaContrato`, `fechaImplantacion`, `fechaProximaAccion`),
`comentariosGenerales`, `seguimiento` (array, igual patrón que en SP).

Además lleva **todo un cálculo de facturación y comisión** al cerrar como
"Cliente Captado": `comunidadesCaptadas`, y por cada servicio marcado
como contratado (`srv_cae`, `srv_certificados`, `srv_rgpd`,
`srv_cae_rgpd`, `srv_pack_completo`, `srv_aifink`) su precio
(`precioSrv_*`) y su cesión/comisión al AAFF (`cesionSrv_*`). De ahí se
derivan `totalFacturacionMM`, `totalFacturacionAifink`,
`totalFacturacionPrevista`, `comisionAAFF`, `comisionProveedorVisalia`,
`comisionPropia` — **hoy estos totales se calculan y se guardan ya
calculados**, no se recalculan cada vez que se leen. En MySQL habría que
decidir si se mantiene así (columnas calculadas guardadas) o se pasan a
calcular al vuelo desde una vista — mantenerlo como está hoy es más
simple y menos arriesgado para una primera migración.

`crmActividad` es el log de eventos de este módulo — mismo patrón exacto
que `crmSPActividad` (`id`, `contactoId`, `tipo`, `empresa`, `comercial`,
`origen`, `fecha`).

**`leads`** (37 usos) — leads del CRM de Comunidades, antes de convertirse en contacto

`id`, `origenLead`, `nombre`, `contacto`, `telefono`, `email`,
`direccion`, `poblacion`, `provincia`, `codigoPostal`,
`numeroColegiado`, `web`, `urlColReg` (estos tres últimos sugieren que
muchos leads vienen de colegios profesionales de administradores de
fincas), `prescriptor`, `comercial`, `estado`, `notas`, `contactoCrmId`
(se rellena al convertir — mismo patrón que `leadsSP.contactoCrmId`).

**`proyectos`** (34) / **`tareas`** (31) / **`estrategias`** (24) / **`okrs`** (28) — Dashboard Estratégico del holding

Jerarquía clara: Estrategia → Proyecto → Tarea, cada nivel con `empresa`,
`responsable`, `estado`, fechas. `estrategias`: `id`, `nombre`, `empresa`,
`responsable`, `estado`, `fecha`, `detalle`. `proyectos`: igual +
`estrategia` (FK) + `prioridad` + `fechaInicio`/`fechaFin` +
`descripcion`. `tareas`: igual + `proyecto` (FK) + `asignada` (en vez de
`responsable`) + `fechaProximaAccion` (dispara también un evento en
Agenda, igual que en Servicios Profesionales) + `comentarios`. `okrs`:
`titulo`, `empresa`, `responsable`, `periodo`, `estadoManual`, `proyecto`
(FK opcional), y `krs` — un **array anidado de key results** (cada uno
con su propio objetivo numérico) que en MySQL sería su propia tabla
`okrs_key_results` con FK a `okrs.id`.

**`prescriptores`** (22) — versión del CRM de Comunidades, distinta de `prescriptoresSP`

Mucho más simple que su equivalente de Servicios Profesionales: `nombre`,
`rol`, `zona`, `telefono`, `email`, `obs`. **No tiene campo `id`** — hoy
se identifica por su posición dentro del array (`idx`), no por un
identificador propio. Esto hay que arreglarlo ANTES de crear la tabla
MySQL (añadir un id estable a cada uno durante la migración de datos),
porque una tabla relacional sin clave primaria estable no es viable.
También se guarda con una llamada a Firebase distinta al resto
(`fbRef.child('prescriptores').set(...)` en vez del `saveData()`
genérico) — un patrón de escritura suelto a tener en cuenta.

**`fichajes`** (17) — registro horario

`id`, `uid` (FK → usuarios), `nombre`, `empresa` (desnormalizados en el
momento del fichaje, no se recalculan después — así el histórico no
cambia si el usuario cambia de empresa más tarde), `tipo` (entrada/
salida...), `modalidad`, `ts`/`tsCliente` (timestamp del servidor y del
cliente, para detectar desajustes de reloj), `anulado`, `origen`
(`correccion` cuando lo edita un admin a mano), `creadaPor`, `creadaTs`,
`motivo`, `notas`.

**`empresas`** (14) — ⚠️ un array plano de texto, no de objetos

```json
["Moretamar Inversiones","Grupo Moore 2019","Grupo Moore Market",
 "Yumgu International Group","Serfisan","Serfisit","Aifink Lab",
 "Moore Capital Partners","Inmensia Gestion","VGL Investments"]
```

Es literalmente una lista de nombres — no hay más campos (ni CIF, ni
dirección, nada). En MySQL sería `empresas(id, nombre)`, y todo el resto
de tablas que hoy guardan el NOMBRE de la empresa como texto libre
(`contactosSP.responsable`'s empresa, `eventos.empresa`, `tareas.empresa`,
etc.) pasarían a guardar `empresa_id` — el mismo tipo de limpieza de
texto-libre-a-FK que ya se comentaba en el apartado 4 para
`prescriptor`/`responsable`.

**`driveLinks`** (8) — objeto clave-valor, no array

```json
{"Inmensia Gestion": "https://drive.google.com/drive/folders/...",
 "Grupo Moore Market": "https://drive.google.com/drive/folders/..."}
```

Un enlace de Google Drive por empresa. En MySQL: tabla de 2 columnas
`(empresa_id, url)`.

**`leadsBBDDs`** (8) — grupos/segmentos con nombre propio para organizar leads

`id`, `nombre` (p.ej. "AAFF Girona", "AAFF Tarragona") — permite crear
listas de leads independientes entre sí, más allá de los grupos fijos de
la app. Los leads de `leadsSP`/`leads` probablemente necesiten un
`bbdd_id` (FK) para saber a qué grupo pertenecen — a confirmar mirando
cómo se filtra `leadsGrupoActivo` en el código.

**`ausencias`** (10) y **`incidencias`** (7) — solicitudes de empleados, con aprobación

Mismo patrón en ambas: `id`, `uid`, `nombre`, `empresa` (desnormalizados,
igual que en `fichajes`), datos propios (`tipo`+`fechaInicio`/`fechaFin`+
`motivo` en ausencias; `tipo`+`tipoFichaje`+`fecha`+`horaPropuesta`+
`descripcion` en incidencias), `estado` (`pendiente` hasta que un admin
la revisa), `creadoTs`.

**`festivos`** (9) — `id`, `fecha`, `nombre`, `ambito` (`nacional` o
`empresa`), `empresa` (solo si el ámbito es `empresa`), `creadoPor`,
`creadoTs`.

**`manuales`** / **`procesos`** (2/2) — ya migrados de 3 espacios fijos a
lista dinámica esta misma sesión: `id`, `titulo`, `url`, `empresa`
(etiqueta de visibilidad — ver los cambios de Configuración de un turno
anterior).

**`personas`** (11) — ⚠️ colección heredada, en proceso de desaparecer

Es un array de nombres antiguo, anterior a que existiera `usuarios` con
login real. El propio código la migra automáticamente a `usuarios` la
primera vez que carga (con la marca `_personasMigradas` para no repetir
la migración) y crea usuarios "fantasma" sin email real
(`_sinAuth: true`) para los nombres que no tenían cuenta. **No hace falta
tabla MySQL para esto** — solo replicar esa migración una vez, al
importar los datos históricos.

**`myaPipeline`** / **`myaInversores`** / **`myaSubadvisors`** (4/3/3) — módulo M&A (Moore Capital Partners)

Es el módulo con menos uso y el que menos se ha tocado esta sesión — no
he encontrado con confianza suficiente la función de guardado con su
lista de campos (a diferencia del resto de este documento, donde todo
sale del código, aquí prefiero decir claramente que hace falta revisarlo
antes de diseñar su tabla, en vez de adivinar campos).

**`crmOkrObjetivos`** (4) y **`visitas`** (2) — igual que M&A: uso bajo,
pendientes de una revisión de campos dedicada antes de migrar.

**`trazabilidad`** (1) — un único uso en todo el código; probablemente un
log puntual, a revisar si merece tabla propia o se puede prescindir de
ella.

## 4. Esquema MySQL propuesto (núcleo de Servicios Profesionales)

Solo las tablas centrales, como punto de partida — el resto del holding
seguiría el mismo patrón una vez verificados sus campos.

```sql
CREATE TABLE usuarios (
  id            VARCHAR(64)  PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  email         VARCHAR(160) UNIQUE NOT NULL,
  rol           ENUM('admin','editor','viewer') NOT NULL DEFAULT 'editor',
  password_hash VARCHAR(255) NOT NULL,   -- Firebase Auth desaparece; hay que
                                          -- decidir librería de hashing (p.ej. passlib/bcrypt)
  creado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usuarios_empresas (        -- antes era un array dentro del usuario
  usuario_id  VARCHAR(64) NOT NULL REFERENCES usuarios(id),
  empresa_id  VARCHAR(64) NOT NULL REFERENCES empresas(id),
  PRIMARY KEY (usuario_id, empresa_id)
);

CREATE TABLE prescriptores_sp (
  id                    VARCHAR(64) PRIMARY KEY,
  nombre                VARCHAR(160) NOT NULL,
  cif                   VARCHAR(20),
  contacto, telefono, email, direccion, poblacion  VARCHAR(160),
  responsable_id        VARCHAR(64) REFERENCES usuarios(id),
  etapa                 ENUM('Por Contactar','Contacto Iniciado','Presentación Enviada',
                              'En Negociación','Colaborador Activo','Descartado') NOT NULL,
  comision_pct          DECIMAL(5,2),
  comentarios_generales TEXT,
  oferta_enviada        DATE NULL,
  fecha_colaborador_activo DATE NULL,
  fecha_descartada         DATE NULL,
  creado_en             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prescriptores_sp_seguimiento (   -- antes era un array embebido
  id                VARCHAR(64) PRIMARY KEY,
  prescriptor_id    VARCHAR(64) NOT NULL REFERENCES prescriptores_sp(id),
  fecha             DATE NOT NULL,
  texto             TEXT,
  autor_id          VARCHAR(64) REFERENCES usuarios(id)
);

CREATE TABLE leads_sp (
  id                VARCHAR(64) PRIMARY KEY,
  cif, contacto, telefono, email, direccion, poblacion  VARCHAR(160),
  responsable_id    VARCHAR(64) REFERENCES usuarios(id),
  origen            VARCHAR(80),
  prescriptor_id    VARCHAR(64) REFERENCES prescriptores_sp(id),
  estado            VARCHAR(40) NOT NULL,
  notas             TEXT,
  public_token      VARCHAR(64) UNIQUE,
  contacto_crm_id   VARCHAR(64) REFERENCES contactos_sp(id) NULL,
  seguimiento_autodiagnostico ENUM('Enviado','Sin Respuesta','Solicita Llamada','Quiere Contratar') NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contactos_sp (
  id                    VARCHAR(64) PRIMARY KEY,
  cif, contacto, telefono, email, direccion, poblacion  VARCHAR(160),
  num_empleados         INT,
  etapa                 VARCHAR(40) NOT NULL,
  probabilidad          VARCHAR(40),
  origen                VARCHAR(80),
  prescriptor_id        VARCHAR(64) REFERENCES prescriptores_sp(id),
  responsable_id        VARCHAR(64) REFERENCES usuarios(id),
  fecha_propuesta       DATE,
  fecha_proxima_accion  DATE,
  motivo_descarte       VARCHAR(80),
  motivo_detalle        TEXT,
  comentarios_generales TEXT,
  importe_propuesta     DECIMAL(10,2),
  public_token          VARCHAR(64) UNIQUE,
  auditoria_realizada   BOOLEAN DEFAULT FALSE,
  seguimiento_autodiagnostico ENUM('Enviado','Sin Respuesta','Solicita Llamada','Quiere Contratar') NULL,
  propuesta_auto_generada  BOOLEAN DEFAULT FALSE,
  propuesta_aceptada       BOOLEAN DEFAULT FALSE,
  propuesta_aceptada_fecha DATETIME NULL,
  creado_en             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contactos_sp_servicios (   -- antes array `serviciosOfertados`
  id             VARCHAR(64) PRIMARY KEY,
  contacto_id    VARCHAR(64) NOT NULL REFERENCES contactos_sp(id),
  nombre_servicio VARCHAR(120),
  precio         DECIMAL(10,2)
);

CREATE TABLE contactos_sp_seguimiento (  -- antes array `seguimiento`
  id             VARCHAR(64) PRIMARY KEY,
  contacto_id    VARCHAR(64) NOT NULL REFERENCES contactos_sp(id),
  fecha          DATE NOT NULL,
  texto          TEXT,
  autor_id       VARCHAR(64) REFERENCES usuarios(id)
);

CREATE TABLE crm_sp_actividad (         -- log de eventos, para estadísticas
  id             VARCHAR(64) PRIMARY KEY,
  contacto_id    VARCHAR(64) NOT NULL REFERENCES contactos_sp(id),
  tipo           ENUM('nuevo_contacto','seguimiento','conversion','descarte') NOT NULL,
  fecha          DATE NOT NULL,
  comercial_id   VARCHAR(64) REFERENCES usuarios(id),
  origen         VARCHAR(80),
  INDEX idx_contacto (contacto_id),
  INDEX idx_fecha (fecha)
);

-- Los dos nodos públicos de Firebase pasan a ser tablas normales,
-- protegidas por un endpoint que valida el token en vez de reglas de
-- seguridad de Firebase:
CREATE TABLE autodiagnosticos_publicos (
  token                     VARCHAR(64) PRIMARY KEY,
  empresa, contacto, email  VARCHAR(160),
  sector, tipo_persona      VARCHAR(80),
  num_trabajadores, num_usuarios  INT,
  maneja_alimentos, tiene_web     BOOLEAN,
  servicios_interes         JSON,        -- MySQL 8 soporta JSON nativo; sirve para lista corta
  fecha                     DATE NOT NULL,
  interes_contratacion      BOOLEAN NULL,
  interes_contratacion_fecha DATETIME NULL
);

CREATE TABLE propuestas_publicas (
  token          VARCHAR(64) PRIMARY KEY REFERENCES autodiagnosticos_publicos(token),
  paquete_key    VARCHAR(40),
  desglose_json  JSON,
  total          DECIMAL(10,2),
  creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Nota importante:** hoy `prescriptor` y `responsable` en `contactosSP` /
`leadsSP` se guardan como **texto libre** (el nombre, no un id). Al pasar a
MySQL con claves foráneas de verdad, hay que decidir: o se migran esos
textos a ids buscando coincidencia exacta de nombre (riesgo: nombres
duplicados o con erratas quedarían huérfanos), o se mantiene una tabla
puente de normalización antes de activar las FK. Merece revisarlo con
calma antes de migrar datos reales.

## 5. Superficie de API a construir

Hoy no hay "API" — hay llamadas directas al SDK de Firebase desde
cualquier punto del JS. Los patrones que se repiten (y que serían
endpoints REST en Python) son:

- **`saveData(claves)`** — guarda partes de `data` contra
  `holding-data/usuarios/<uid>`. Es la función más usada de toda la app.
  En Python/MySQL esto deja de tener sentido tal cual (no se puede "guardar
  el árbol entero"): cada acción del usuario necesita su propio endpoint
  específico (`POST /api/contactos-sp`, `PUT /api/contactos-sp/<id>`,
  `POST /api/prescriptores-sp/<id>/seguimiento`, etc.) en vez de un único
  guardado genérico. Este es probablemente el cambio de mayor calado de
  toda la migración — no es un problema de sintaxis, es un cambio de
  modelo (de "guarda este blob" a "una operación por endpoint").
- **`loadData()`** — lectura inicial de todo el árbol al arrancar la app.
  Pasaría a ser una combinación de varios `GET /api/...` (probablemente
  uno por módulo que el usuario tenga abierto, no todo de golpe — buena
  oportunidad para cargar más rápido de lo que carga hoy).
- **Autenticación** (`firebase.auth()...`) — hoy la gestiona Firebase Auth
  por completo (login, sesión, tokens). Con servidor propio hay que
  construir esto desde cero: login con email/contraseña, sesión (cookie
  firmada o JWT), y decidir si se mantiene el login por email/contraseña
  o se aprovecha para añadir algo como Google OAuth.
- **Escrituras públicas sin login** (`enviarAuditoriaPublicaSP`,
  `respuestaInteresAutodiagnosticoPublicoSP`, aceptación de propuesta) —
  pasan a ser 2-3 endpoints POST concretos y validados en el servidor
  (comprobar que el token existe, limitar tamaño de los campos, evitar
  que alguien escriba en un token que no es el suyo) — esto es en
  realidad una mejora de seguridad respecto a hoy, no solo un cambio de
  tecnología.
- **El listener en tiempo real** (`iniciarEscuchaAuditoriasPublicasSP`,
  basado en `child_added`/`child_changed` de Firebase) no tiene
  equivalente directo en MySQL. Ver apartado siguiente.

## 6. Qué hacer con el "tiempo real"

Hoy, cuando un cliente rellena el autodiagnóstico, el equipo se entera al
momento (si tiene el panel abierto) porque Firebase empuja el cambio
solo. Con MySQL hay que elegir una alternativa — de más simple a más
compleja:

1. **Refrescar al entrar en la pantalla** (sin tiempo real de verdad). Es
   lo más simple de construir, y para un volumen de autodiagnósticos
   moderado probablemente es suficiente — el equipo ya revisa el panel
   varias veces al día.
2. **Sondeo periódico** (el navegador pregunta "¿hay algo nuevo?" cada
   30-60 segundos mientras la pestaña de Autodiagnóstico está abierta).
   Sencillo de construir, algo de carga extra en el servidor pero
   totalmente asumible a esta escala.
3. **WebSockets o Server-Sent Events** — tiempo real de verdad, como hoy,
   pero es la opción con más trabajo de construcción y mantenimiento.

Mi recomendación, sin conocer aún el volumen real de autodiagnósticos
diarios: empezar por la opción 1 o 2, y solo subir a WebSockets si de
verdad se echa en falta la inmediatez.

## 7. Plan de migración por fases (propuesta, no cerrada)

No os lo planteo como algo que haya que hacer todo de golpe. Un orden
razonable, de menor a mayor riesgo:

**Fase 0 — ya hecho:** separar HTML/CSS/config de la portada pública
(este documento certifica que ya está).

**Fase 1 — el módulo público del autodiagnóstico**, por ser el más
autocontenido (dos tablas, sin login, sin dependencias del resto del
CRM). Sirve como piloto real: monta el servidor Python, la base MySQL, y
los 2-3 endpoints públicos, sin tocar todavía el panel interno. Bajo
riesgo porque, si algo falla, el CRM interno (que sigue en Firebase)
sigue funcionando igual.

**Fase 2 — autenticación y el núcleo de Servicios Profesionales**
(`usuarios`, `contactos_sp`, `leads_sp`, `prescriptores_sp`,
`crm_sp_actividad`) — el módulo que hemos construido y probado a fondo
esta sesión, así que el esquema de datos ya está bastante maduro.

**Fase 3 — el resto del holding** (Agenda, CRM de Comunidades,
Dashboard/OKR, M&A, Documentación) — cada uno probablemente pueda migrar
de forma bastante independiente unos de otros, en el orden que tenga
sentido de negocio.

Durante la transición, lo más seguro es tener AMBOS sistemas
funcionando en paralelo por un tiempo (Firebase para lo no migrado
todavía, Python/MySQL para lo ya migrado), en vez de un corte único de
todo a la vez.

## 8. Lo que este documento NO resuelve todavía

Para ser honesto sobre los límites de esta preparación:

- No incluye elección de framework Python (Flask/FastAPI/Django) ni de
  hosting para el servidor propio — son decisiones vuestras, con
  implicaciones de coste y mantenimiento que no me corresponde decidir
  por vosotros.
- El apartado 3 ya cubre con detalle real de campos prácticamente todas
  las colecciones — el hueco que queda es concretamente el módulo M&A
  (`myaPipeline`, `myaInversores`, `myaSubadvisors`), `crmOkrObjetivos`,
  `visitas` y `trazabilidad`: uso bajo, y preferí decirlo claramente en
  vez de adivinar campos que no pude verificar en el código con la misma
  confianza que el resto.
- Quedan tres decisiones de limpieza de datos identificadas pero sin
  resolver, a valorar antes de migrar datos reales:
  1. `prescriptor`/`responsable` guardados como texto libre (nombre) en
     vez de id, en varias colecciones.
  2. `empresas` es hoy una simple lista de nombres, y todo el resto de
     colecciones que guardan el nombre de empresa como texto tendrían
     que pasar a usar su id.
  3. `prescriptores` (versión CRM de Comunidades) no tiene campo `id`
     propio — se identifica por posición en el array — hay que asignarle
     uno estable antes de poder crear su tabla.
- El esquema MySQL del apartado 4 en DDL completo solo cubre el núcleo de
  Servicios Profesionales; el resto de colecciones ya descritas en el
  apartado 3.2 seguirían el mismo patrón de traducción (array → tabla,
  array anidado → tabla con FK, objeto clave-valor → tabla de 2
  columnas) pero no las he escrito todas en SQL literal para no alargar
  este documento más de lo necesario.
- No he tocado el HTML del panel interno (CRM, Dashboard, etc.) — sigue
  generado desde `app.js`. Separarlo en plantillas es un trabajo bastante
  mayor que el de la portada pública y merece su propia planificación.
