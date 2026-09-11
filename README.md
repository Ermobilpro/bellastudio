# Salón de Uñas — Reservas

App de reservas para un salón de uñas/keratina: clientas se registran y agendan citas online (10:00 am–7:00 pm), el equipo gestiona su agenda, y la administradora ve el calendario del mes completo, maneja empleadas/servicios y recibe ideas de crecimiento según sus propios datos.

## Estructura

- `src/App.jsx` — toda la interfaz (React).
- `server.js` — servidor Express: sirve la app y expone `/api/data` (guarda todo en `data.json`).
- `vite.config.js` — configuración del frontend.

## Correr en local

```bash
npm install
npm run dev        # frontend en http://localhost:5173 (proxy hacia /api)
```

En otra terminal, para probar también el backend:

```bash
npm run build
npm start           # sirve todo en http://localhost:3000
```

## Subir a GitHub

```bash
git init
git add .
git commit -m "App de reservas del salón"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

(Crea antes el repositorio vacío en github.com — con tu usuario y el nombre que prefieras.)

## Desplegar en Railway

1. Entra a [railway.app](https://railway.app) e inicia sesión con tu cuenta de GitHub.
2. "New Project" → "Deploy from GitHub repo" → elige este repositorio.
3. Railway detecta `railway.json` automáticamente: instala dependencias, compila (`npm run build`) y arranca con `npm start`. No necesitas configurar nada más.
4. Cuando termine el despliegue, Railway te da una URL pública (algo como `tu-app.up.railway.app`) — esa es la que compartes con tus clientas.

### Importante sobre los datos

Este proyecto guarda toda la información (clientas, citas, empleadas, servicios) en un archivo `data.json` en el propio servidor. Railway por defecto usa almacenamiento **efímero**: si vuelves a desplegar la app, ese archivo se puede borrar y perder la información.

Para que los datos queden seguros de verdad, antes de usarla en producción con clientas reales:
- Agrega un **Volume** en Railway (Settings → Volumes) montado en la carpeta del proyecto, así `data.json` sobrevive a los despliegues, o
- Pide que se migre `data.json` a una base de datos real (por ejemplo PostgreSQL, que Railway también ofrece con un clic) — es un cambio pequeño sobre `server.js`.

### Seguridad

El PIN de acceso de clientas y equipo es una clave simple guardada en texto plano — suficiente para empezar a operar, pero no es un sistema de autenticación seguro. Si más adelante vas a manejar pagos en línea, conviene migrar a un proveedor de autenticación real.
