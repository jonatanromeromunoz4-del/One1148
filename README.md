# Moore Market — Panel Estratégico

PWA estática (HTML + CSS + JS, sin build) para el panel interno de Moore Market.

## Estructura

```
index.html          punto de entrada
app.js               toda la lógica (Firebase, CRM, M&A, OKRs, agenda...)
style.css             estilos
manifest.json         manifest de la PWA
service-worker.js      caché offline
icons/                 iconos de la PWA (varios tamaños)
vendor/                librerías de terceros vendorizadas (Chart.js, jsPDF,
                       Firebase compat SDK, Tabler Icons) — ya no se cargan
                       desde CDN públicos
vercel.json            cabecera no-cache para el service worker
```

## Importante antes de usarlo con datos reales

- **Reglas de seguridad de Firebase**: revisa cuanto antes las Reglas de la
  Realtime Database en la consola de Firebase — son la única barrera real
  de acceso a los datos (ver el Informe Técnico, secciones 3.1 y 4).
- **Firebase**: la app sincroniza sus datos contra Realtime Database usando
  la configuración que ya está en `app.js` (`FIREBASE_CONFIG`). Si es un
  proyecto de Firebase que ya existe y no quieres que esta preview escriba
  sobre esos datos, cambia esa configuración por un proyecto de pruebas (o
  revisa las reglas de acceso de esa base de datos) antes de compartir la URL.
- **Service worker / caché**: si después de desplegar cambios no ves las
  novedades reflejadas, sube el número de `CACHE_NAME` en
  `service-worker.js` (ya está explicado en un comentario justo ahí).

## Desplegar en GitHub + Vercel (previsualización rápida)

### 1. Subir a GitHub

```bash
cd moore-market
git init
git add .
git commit -m "Primer despliegue"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/moore-market.git
git push -u origin main
```

(Si no tienes el repo creado aún, créalo antes vacío en github.com — sin
README ni .gitignore, para no chocar con este primer commit.)

### 2. Importar en Vercel

1. Entra en [vercel.com](https://vercel.com) → **Add New… → Project**.
2. Selecciona el repositorio que acabas de subir.
3. Framework Preset: deja **"Other"** (es un sitio estático, no hace falta build).
   - Build Command: (vacío)
   - Output Directory: (vacío / raíz del repo)
4. Deploy. En 1-2 minutos tendrás una URL tipo `https://moore-market-xxxx.vercel.app` para ver cómo queda.

Cada vez que hagas `git push` a `main`, Vercel vuelve a desplegar solo.
