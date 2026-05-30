# Canvas MCP Server

Servidor MCP que conecta Claude con Canvas LMS.

## Herramientas disponibles

| Herramienta | Descripción |
|---|---|
| `list_courses` | Lista tus cursos |
| `get_course` | Detalles de un curso |
| `list_assignments` | Tareas de un curso |
| `get_assignment` | Detalle de una tarea |
| `list_submissions` | Entregas con notas |
| `grade_submission` | Calificar un alumno |
| `get_student_grades` | Resumen de notas del curso |
| `list_announcements` | Ver anuncios |
| `create_announcement` | Publicar un anuncio |
| `list_files` | Archivos del curso |
| `list_folders` | Carpetas del curso |
| `get_file` | Metadatos de un archivo |
| `list_modules` | Módulos del curso |
| `list_students` | Alumnos inscritos |

---

## Paso 1 — Obtener tu token de Canvas

1. Entra a tu Canvas → **Configuración de cuenta** → **Integraciones aprobadas**
2. Haz clic en **"+ Nuevo token de acceso"**
3. Copia el token (solo se muestra una vez)

---

## Paso 2 — Desplegar en Railway (gratis)

### Opción A: Desde GitHub (recomendado)

1. Sube este proyecto a un repositorio GitHub
2. Ve a [railway.app](https://railway.app) → **New Project → Deploy from GitHub**
3. Selecciona tu repo
4. En **Variables de entorno** agrega:
   ```
   CANVAS_DOMAIN = miescuela.instructure.com
   CANVAS_TOKEN  = tu_token_aqui
   PORT          = 3000
   ```
5. Railway te dará una URL pública como:
   `https://canvas-mcp-production.up.railway.app`

### Opción B: Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway variables set CANVAS_DOMAIN=miescuela.instructure.com
railway variables set CANVAS_TOKEN=tu_token
```

---

## Paso 3 — Conectar en Claude

1. Abre Claude.ai → **Configuración** → **Conectores**
2. Haz clic en **"Agregar conector personalizado"**
3. Ingresa la URL de tu servidor:
   ```
   https://tu-proyecto.up.railway.app/mcp
   ```
4. ¡Listo! Claude ahora puede hablar con Canvas.

---

## Uso local (desarrollo)

```bash
npm install

CANVAS_DOMAIN=miescuela.instructure.com \
CANVAS_TOKEN=tu_token \
npm start
```

El servidor queda en `http://localhost:3000/mcp`.

Para conectarlo localmente a Claude Desktop, usa un túnel:
```bash
npx localtunnel --port 3000
```

---

## Ejemplos de uso en Claude

Una vez conectado, puedes pedirle a Claude cosas como:

- *"¿Cuáles son mis cursos activos?"*
- *"Lista las tareas del curso 12345 con fecha de entrega esta semana"*
- *"Muéstrame las notas de la tarea 'Examen parcial'"*
- *"Califica al alumno 9876 con 85 puntos y agrega el comentario 'Buen trabajo'"*
- *"Publica un anuncio en el curso 12345 sobre el cambio de horario"*
- *"¿Qué archivos PDF hay en el curso de Matemáticas?"*
