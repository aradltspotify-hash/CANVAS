import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "http";
import { z } from "zod";

const CANVAS_DOMAIN = process.env.CANVAS_DOMAIN;
const CANVAS_TOKEN  = process.env.CANVAS_TOKEN;

if (!CANVAS_DOMAIN || !CANVAS_TOKEN) {
  console.error("❌  Define CANVAS_DOMAIN y CANVAS_TOKEN en las variables de entorno");
  process.exit(1);
}

const BASE = `https://${CANVAS_DOMAIN}/api/v1`;
const HEADERS = {
  Authorization: `Bearer ${CANVAS_TOKEN}`,
  "Content-Type": "application/json",
};

async function canvasGet(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) throw new Error(`Canvas API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function canvasPost(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Canvas API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function canvasPut(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: "PUT", headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Canvas API ${res.status}: ${await res.text()}`);
  return res.json();
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "canvas-mcp", version: "1.0.0" });

server.tool("list_courses", "Lista los cursos del usuario en Canvas",
  { enrollment_state: z.enum(["active","invited","completed","all"]).optional() },
  async ({ enrollment_state = "active" }) => {
    const courses = await canvasGet("/courses", { enrollment_state, per_page: 50, include: "total_students" });
    return ok(courses.map(c => ({ id: c.id, name: c.name, course_code: c.course_code, total_students: c.total_students })));
  }
);

server.tool("get_course", "Obtiene los detalles de un curso",
  { course_id: z.number() },
  async ({ course_id }) => ok(await canvasGet(`/courses/${course_id}`, { include: "total_students,syllabus_body" }))
);

server.tool("list_assignments", "Lista las tareas de un curso",
  { course_id: z.number(), order_by: z.enum(["position","name","due_at"]).optional(), bucket: z.enum(["past","overdue","undated","ungraded","upcoming","future"]).optional() },
  async ({ course_id, order_by, bucket }) => {
    const assignments = await canvasGet(`/courses/${course_id}/assignments`, { per_page: 100, order_by, bucket });
    return ok(assignments.map(a => ({ id: a.id, name: a.name, due_at: a.due_at, points_possible: a.points_possible })));
  }
);

server.tool("get_assignment", "Detalle de una tarea",
  { course_id: z.number(), assignment_id: z.number() },
  async ({ course_id, assignment_id }) => ok(await canvasGet(`/courses/${course_id}/assignments/${assignment_id}`))
);

server.tool("list_submissions", "Lista entregas de una tarea con calificaciones",
  { course_id: z.number(), assignment_id: z.number(), include_unsubmitted: z.boolean().optional() },
  async ({ course_id, assignment_id, include_unsubmitted }) => {
    const subs = await canvasGet(`/courses/${course_id}/assignments/${assignment_id}/submissions`, { per_page: 100, include: include_unsubmitted ? "user,unsubmitted" : "user" });
    return ok(subs.map(s => ({ student_id: s.user_id, student_name: s.user?.name, score: s.score, grade: s.grade, late: s.late, missing: s.missing })));
  }
);

server.tool("grade_submission", "Califica a un alumno en una tarea",
  { course_id: z.number(), assignment_id: z.number(), student_id: z.number(), score: z.number(), comment: z.string().optional() },
  async ({ course_id, assignment_id, student_id, score, comment }) => {
    const body = { submission: { posted_grade: score } };
    if (comment) body.comment = { text_comment: comment };
    const result = await canvasPut(`/courses/${course_id}/assignments/${assignment_id}/submissions/${student_id}`, body);
    return ok({ success: true, student_id, score, result });
  }
);

server.tool("get_student_grades", "Resumen de notas del curso",
  { course_id: z.number() },
  async ({ course_id }) => {
    const enrollments = await canvasGet(`/courses/${course_id}/enrollments`, { type: "StudentEnrollment", per_page: 100, include: "grades" });
    return ok(enrollments.map(e => ({ student_id: e.user_id, student_name: e.user?.name, current_score: e.grades?.current_score, final_score: e.grades?.final_score })));
  }
);

server.tool("list_announcements", "Lista anuncios de cursos",
  { course_ids: z.array(z.number()), active_only: z.boolean().optional() },
  async ({ course_ids, active_only }) => ok(await canvasGet("/announcements", { context_codes: course_ids.map(id => `course_${id}`).join(","), per_page: 50, active_only }))
);

server.tool("create_announcement", "Publica un anuncio en un curso",
  { course_id: z.number(), title: z.string(), message: z.string(), delayed_post_at: z.string().optional(), notify_users: z.boolean().optional() },
  async ({ course_id, title, message, delayed_post_at, notify_users }) => {
    const body = { title, message, is_announcement: true, published: true };
    if (delayed_post_at) body.delayed_post_at = delayed_post_at;
    if (notify_users !== undefined) body.notify_users = notify_users;
    const result = await canvasPost(`/courses/${course_id}/discussion_topics`, body);
    return ok({ success: true, announcement_id: result.id, title: result.title, html_url: result.html_url });
  }
);

server.tool("list_files", "Lista archivos de un curso",
  { course_id: z.number(), content_types: z.string().optional(), search_term: z.string().optional() },
  async ({ course_id, content_types, search_term }) => {
    const files = await canvasGet(`/courses/${course_id}/files`, { per_page: 100, content_types, search_term });
    return ok(files.map(f => ({ id: f.id, display_name: f.display_name, content_type: f.content_type, size: f.size, url: f.url })));
  }
);

server.tool("list_students", "Lista alumnos de un curso",
  { course_id: z.number() },
  async ({ course_id }) => {
    const students = await canvasGet(`/courses/${course_id}/users`, { enrollment_type: "student", per_page: 100 });
    return ok(students.map(s => ({ id: s.id, name: s.name, email: s.email })));
  }
);

const PORT = process.env.PORT || 8080;

const httpServer = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, server: "canvas-mcp", canvas: CANVAS_DOMAIN }));
    return;
  }
  if (req.url === "/mcp") {
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`✅  Canvas MCP server en puerto ${PORT}`);
  console.log(`    Canvas domain: ${CANVAS_DOMAIN}`);
});
