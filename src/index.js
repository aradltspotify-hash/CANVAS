import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "http";
import { z } from "zod";

const CANVAS_DOMAIN = process.env.CANVAS_DOMAIN; // e.g. "miescuela.instructure.com"
const CANVAS_TOKEN  = process.env.CANVAS_TOKEN;   // API token de Canvas

if (!CANVAS_DOMAIN || !CANVAS_TOKEN) {
  console.error("❌  Define CANVAS_DOMAIN y CANVAS_TOKEN en las variables de entorno");
  process.exit(1);
}

const BASE = `https://${CANVAS_DOMAIN}/api/v1`;
const HEADERS = {
  Authorization: `Bearer ${CANVAS_TOKEN}`,
  "Content-Type": "application/json",
};

// ── helpers ──────────────────────────────────────────────────────────────────

async function canvasGet(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) throw new Error(`Canvas API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function canvasPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Canvas API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function canvasPut(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Canvas API ${res.status}: ${await res.text()}`);
  return res.json();
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// ── server ────────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "canvas-mcp",
  version: "1.0.0",
});

// ── COURSES ──────────────────────────────────────────────────────────────────

server.tool(
  "list_courses",
  "Lista los cursos del usuario en Canvas",
  {
    enrollment_state: z.enum(["active", "invited", "completed", "all"]).optional()
      .describe("Filtra por estado de inscripción (por defecto: active)"),
  },
  async ({ enrollment_state = "active" }) => {
    const courses = await canvasGet("/courses", {
      enrollment_state,
      per_page: 50,
      include: "total_students",
    });
    return ok(courses.map(c => ({
      id: c.id,
      name: c.name,
      course_code: c.course_code,
      workflow_state: c.workflow_state,
      total_students: c.total_students,
    })));
  }
);

server.tool(
  "get_course",
  "Obtiene los detalles de un curso específico",
  { course_id: z.number().describe("ID del curso") },
  async ({ course_id }) => {
    const course = await canvasGet(`/courses/${course_id}`, { include: "total_students,syllabus_body" });
    return ok(course);
  }
);

// ── ASSIGNMENTS ───────────────────────────────────────────────────────────────

server.tool(
  "list_assignments",
  "Lista las tareas de un curso",
  {
    course_id: z.number().describe("ID del curso"),
    order_by: z.enum(["position", "name", "due_at"]).optional(),
    bucket: z.enum(["past", "overdue", "undated", "ungraded", "upcoming", "future"]).optional()
      .describe("Filtra tareas por estado temporal"),
  },
  async ({ course_id, order_by, bucket }) => {
    const assignments = await canvasGet(`/courses/${course_id}/assignments`, {
      per_page: 100,
      order_by,
      bucket,
    });
    return ok(assignments.map(a => ({
      id: a.id,
      name: a.name,
      due_at: a.due_at,
      points_possible: a.points_possible,
      submission_types: a.submission_types,
      grading_type: a.grading_type,
    })));
  }
);

server.tool(
  "get_assignment",
  "Obtiene el detalle de una tarea incluyendo instrucciones",
  {
    course_id: z.number().describe("ID del curso"),
    assignment_id: z.number().describe("ID de la tarea"),
  },
  async ({ course_id, assignment_id }) => {
    const a = await canvasGet(`/courses/${course_id}/assignments/${assignment_id}`);
    return ok(a);
  }
);

// ── GRADES ────────────────────────────────────────────────────────────────────

server.tool(
  "list_submissions",
  "Lista las entregas de una tarea con sus calificaciones",
  {
    course_id: z.number().describe("ID del curso"),
    assignment_id: z.number().describe("ID de la tarea"),
    include_unsubmitted: z.boolean().optional().describe("Incluir alumnos sin entregar"),
  },
  async ({ course_id, assignment_id, include_unsubmitted }) => {
    const params = {
      per_page: 100,
      include: "user",
    };
    if (include_unsubmitted) params.include = "user,unsubmitted";
    const subs = await canvasGet(`/courses/${course_id}/assignments/${assignment_id}/submissions`, params);
    return ok(subs.map(s => ({
      student_id: s.user_id,
      student_name: s.user?.name,
      submitted_at: s.submitted_at,
      score: s.score,
      grade: s.grade,
      late: s.late,
      missing: s.missing,
      workflow_state: s.workflow_state,
    })));
  }
);

server.tool(
  "grade_submission",
  "Califica o actualiza la nota de un alumno en una tarea",
  {
    course_id: z.number().describe("ID del curso"),
    assignment_id: z.number().describe("ID de la tarea"),
    student_id: z.number().describe("ID del alumno (user_id)"),
    score: z.number().describe("Puntaje numérico a asignar"),
    comment: z.string().optional().describe("Comentario de retroalimentación"),
  },
  async ({ course_id, assignment_id, student_id, score, comment }) => {
    const body = { submission: { posted_grade: score } };
    if (comment) body.comment = { text_comment: comment };
    const result = await canvasPut(
      `/courses/${course_id}/assignments/${assignment_id}/submissions/${student_id}`,
      body
    );
    return ok({ success: true, student_id, score, assignment_id, result });
  }
);

server.tool(
  "get_student_grades",
  "Obtiene el resumen de notas de todos los alumnos en un curso",
  { course_id: z.number().describe("ID del curso") },
  async ({ course_id }) => {
    const enrollments = await canvasGet(`/courses/${course_id}/enrollments`, {
      type: "StudentEnrollment",
      per_page: 100,
      include: "grades",
    });
    return ok(enrollments.map(e => ({
      student_id: e.user_id,
      student_name: e.user?.name,
      current_score: e.grades?.current_score,
      final_score: e.grades?.final_score,
      current_grade: e.grades?.current_grade,
      final_grade: e.grades?.final_grade,
    })));
  }
);

// ── ANNOUNCEMENTS ─────────────────────────────────────────────────────────────

server.tool(
  "list_announcements",
  "Lista los anuncios de uno o varios cursos",
  {
    course_ids: z.array(z.number()).describe("Array con IDs de cursos"),
    active_only: z.boolean().optional(),
  },
  async ({ course_ids, active_only }) => {
    const context_codes = course_ids.map(id => `course_${id}`);
    const announcements = await canvasGet("/announcements", {
      context_codes: context_codes.join(","),
      per_page: 50,
      active_only,
    });
    return ok(announcements);
  }
);

server.tool(
  "create_announcement",
  "Publica un nuevo anuncio en un curso",
  {
    course_id: z.number().describe("ID del curso"),
    title: z.string().describe("Título del anuncio"),
    message: z.string().describe("Cuerpo del anuncio (acepta HTML)"),
    delayed_post_at: z.string().optional().describe("Fecha/hora para publicar (ISO 8601, opcional)"),
    notify_users: z.boolean().optional().describe("Notificar a los alumnos por email"),
  },
  async ({ course_id, title, message, delayed_post_at, notify_users }) => {
    const body = {
      title,
      message,
      is_announcement: true,
      published: true,
    };
    if (delayed_post_at) body.delayed_post_at = delayed_post_at;
    if (notify_users !== undefined) body.notify_users = notify_users;
    const result = await canvasPost(`/courses/${course_id}/discussion_topics`, body);
    return ok({ success: true, announcement_id: result.id, title: result.title, html_url: result.html_url });
  }
);

// ── FILES ─────────────────────────────────────────────────────────────────────

server.tool(
  "list_files",
  "Lista los archivos de un curso",
  {
    course_id: z.number().describe("ID del curso"),
    content_types: z.string().optional().describe("Filtra por tipo MIME, ej: 'application/pdf'"),
    search_term: z.string().optional().describe("Buscar por nombre de archivo"),
  },
  async ({ course_id, content_types, search_term }) => {
    const files = await canvasGet(`/courses/${course_id}/files`, {
      per_page: 100,
      content_types,
      search_term,
    });
    return ok(files.map(f => ({
      id: f.id,
      display_name: f.display_name,
      filename: f.filename,
      content_type: f.content_type,
      size: f.size,
      created_at: f.created_at,
      url: f.url,
    })));
  }
);

server.tool(
  "list_folders",
  "Lista las carpetas de archivos de un curso",
  { course_id: z.number().describe("ID del curso") },
  async ({ course_id }) => {
    const folders = await canvasGet(`/courses/${course_id}/folders`);
    return ok(folders.map(f => ({
      id: f.id,
      name: f.name,
      full_name: f.full_name,
      files_count: f.files_count,
    })));
  }
);

server.tool(
  "get_file",
  "Obtiene los metadatos y URL de descarga de un archivo",
  { file_id: z.number().describe("ID del archivo") },
  async ({ file_id }) => {
    const file = await canvasGet(`/files/${file_id}`);
    return ok(file);
  }
);

// ── MODULES ────────────────────────────────────────────────────────────────────

server.tool(
  "list_modules",
  "Lista los módulos de un curso",
  { course_id: z.number().describe("ID del curso") },
  async ({ course_id }) => {
    const modules = await canvasGet(`/courses/${course_id}/modules`, {
      per_page: 50,
      include: "items",
    });
    return ok(modules);
  }
);

// ── STUDENTS ────────────────────────────────────────────────────────────────────

server.tool(
  "list_students",
  "Lista los alumnos inscritos en un curso",
  { course_id: z.number().describe("ID del curso") },
  async ({ course_id }) => {
    const students = await canvasGet(`/courses/${course_id}/users`, {
      enrollment_type: "student",
      per_page: 100,
    });
    return ok(students.map(s => ({ id: s.id, name: s.name, email: s.email })));
  }
);

// ── HTTP Transport ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8080;

const httpServer = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, server: "canvas-mcp", canvas: CANVAS_DOMAIN }));
    return;
  }

  if (req.url === "/mcp") {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(PORT, () => {
  console.log(`✅  Canvas MCP server escuchando en http://localhost:${PORT}/mcp`);
  console.log(`    Canvas domain: ${CANVAS_DOMAIN}`);
});
