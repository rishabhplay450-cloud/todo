const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { db, initDb, seedDefaultsForUser, withLabelsAndSubtasks } = require("./db");

initDb();

const app = express();
const port = process.env.PORT || 4000;
const jwtSecret = process.env.JWT_SECRET || "dev-change-this-secret";
const corsOrigin = process.env.CORS_ORIGIN || "*";

app.use(
  cors({
    origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((item) => item.trim()),
  })
);
app.use(express.json());

function normalizeDateValue(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: "7d" });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = { id: Number(payload.id), email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function parseIntId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

function assertProjectOwnership(projectId, userId) {
  if (!projectId) {
    return true;
  }
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId);
  return Boolean(project);
}

function assertLabelOwnership(labelIds, userId) {
  if (!labelIds || labelIds.length === 0) {
    return true;
  }

  const placeholders = labelIds.map(() => "?").join(",");
  const count = db
    .prepare(`SELECT COUNT(*) as count FROM labels WHERE user_id = ? AND id IN (${placeholders})`)
    .get(userId, ...labelIds).count;

  return count === labelIds.length;
}

const signupSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(255),
  password: z.string().min(6).max(120),
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(120),
});

const todoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().nullable(),
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  due_date: z.string().min(1).optional().nullable(),
  project_id: z.number().int().positive().optional().nullable(),
  label_ids: z.array(z.number().int().positive()).default([]),
  subtasks: z.array(z.object({ title: z.string().min(1).max(200) })).default([]),
});

const projectSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#([0-9A-Fa-f]{6})$/).default("#64748b"),
});

const labelSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#([0-9A-Fa-f]{6})$/).default("#0ea5e9"),
});

app.get("/health", (_, res) => {
  res.json({ ok: true, service: "todo-backend" });
});

app.post("/api/auth/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const name = parsed.data.name.trim();
  const email = parsed.data.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  try {
    const result = db
      .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
      .run(name, email, passwordHash);

    const userId = Number(result.lastInsertRowid);
    seedDefaultsForUser(userId);

    const user = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(userId);
    const token = createToken(user);

    return res.status(201).json({ token, user });
  } catch {
    return res.status(409).json({ error: "Email already exists" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const user = db
    .prepare("SELECT id, name, email, password_hash FROM users WHERE email = ?")
    .get(email);

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const isValid = await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = createToken(user);
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
  });
});

app.use("/api", authMiddleware);

app.get("/api/auth/me", (req, res) => {
  const user = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  return res.json({ user });
});

app.get("/api/meta", (req, res) => {
  const projects = db
    .prepare("SELECT id, name, color FROM projects WHERE user_id = ? ORDER BY name ASC")
    .all(req.user.id);
  const labels = db
    .prepare("SELECT id, name, color FROM labels WHERE user_id = ? ORDER BY name ASC")
    .all(req.user.id);
  return res.json({ projects, labels });
});

app.post("/api/projects", (req, res) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { name, color } = parsed.data;

  try {
    const result = db
      .prepare("INSERT INTO projects (user_id, name, color) VALUES (?, ?, ?)")
      .run(req.user.id, name.trim(), color);

    const project = db
      .prepare("SELECT id, name, color FROM projects WHERE id = ? AND user_id = ?")
      .get(result.lastInsertRowid, req.user.id);

    return res.status(201).json(project);
  } catch {
    return res.status(409).json({ error: "Project already exists" });
  }
});

app.delete("/api/projects/:id", (req, res) => {
  const projectId = parseIntId(req.params.id);
  if (!projectId) {
    return res.status(400).json({ error: "Invalid project id" });
  }

  const result = db
    .prepare("DELETE FROM projects WHERE id = ? AND user_id = ?")
    .run(projectId, req.user.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Project not found" });
  }

  return res.status(204).send();
});

app.post("/api/labels", (req, res) => {
  const parsed = labelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { name, color } = parsed.data;

  try {
    const result = db
      .prepare("INSERT INTO labels (user_id, name, color) VALUES (?, ?, ?)")
      .run(req.user.id, name.trim(), color);

    const label = db
      .prepare("SELECT id, name, color FROM labels WHERE id = ? AND user_id = ?")
      .get(result.lastInsertRowid, req.user.id);

    return res.status(201).json(label);
  } catch {
    return res.status(409).json({ error: "Label already exists" });
  }
});

app.delete("/api/labels/:id", (req, res) => {
  const labelId = parseIntId(req.params.id);
  if (!labelId) {
    return res.status(400).json({ error: "Invalid label id" });
  }

  const result = db
    .prepare("DELETE FROM labels WHERE id = ? AND user_id = ?")
    .run(labelId, req.user.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Label not found" });
  }

  return res.status(204).send();
});

app.get("/api/todos", (req, res) => {
  const {
    search,
    status,
    priority,
    projectId,
    labelId,
    sortBy = "created_at",
    sortOrder = "desc",
    overdue,
  } = req.query;

  const sortColumns = {
    created_at: "t.created_at",
    updated_at: "t.updated_at",
    due_date: "t.due_date",
    priority: "t.priority",
    title: "t.title",
  };
  const safeSortBy = sortColumns[String(sortBy)] || "t.created_at";
  const safeSortOrder = String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

  const whereClauses = ["t.user_id = ?"];
  const values = [req.user.id];

  if (search) {
    whereClauses.push("(t.title LIKE ? OR IFNULL(t.description, '') LIKE ?)");
    values.push(`%${search}%`, `%${search}%`);
  }

  if (status) {
    whereClauses.push("t.status = ?");
    values.push(status);
  }

  if (priority) {
    whereClauses.push("t.priority = ?");
    values.push(priority);
  }

  if (projectId) {
    whereClauses.push("t.project_id = ?");
    values.push(Number(projectId));
  }

  if (labelId) {
    whereClauses.push(
      "EXISTS (SELECT 1 FROM todo_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.todo_id = t.id AND tl.label_id = ? AND l.user_id = ?)"
    );
    values.push(Number(labelId), req.user.id);
  }

  if (String(overdue).toLowerCase() === "true") {
    whereClauses.push("t.due_date IS NOT NULL AND t.status != 'done' AND datetime(t.due_date) < datetime('now')");
  }

  const rows = db
    .prepare(
      `SELECT
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.due_date,
        t.created_at,
        t.updated_at,
        t.completed_at,
        t.project_id,
        p.name as project_name,
        p.color as project_color
      FROM todos t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY ${safeSortBy} ${safeSortOrder}, t.id DESC`
    )
    .all(...values);

  const todos = withLabelsAndSubtasks(rows);
  return res.json({ todos, total: todos.length });
});

app.post("/api/todos", (req, res) => {
  const parsed = todoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { title, description, status, priority, due_date, project_id, label_ids, subtasks } = parsed.data;

  if (!assertProjectOwnership(project_id, req.user.id)) {
    return res.status(400).json({ error: "Invalid project" });
  }

  if (!assertLabelOwnership(label_ids, req.user.id)) {
    return res.status(400).json({ error: "One or more labels are invalid" });
  }

  const normalizedDueDate = normalizeDateValue(due_date);

  const transaction = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO todos (user_id, title, description, status, priority, due_date, project_id, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`
      )
      .run(
        req.user.id,
        title.trim(),
        description ?? null,
        status,
        priority,
        normalizedDueDate,
        project_id ?? null,
        status === "done" ? new Date().toISOString() : null
      );

    const todoId = Number(result.lastInsertRowid);

    if (label_ids.length > 0) {
      const insertLabel = db.prepare("INSERT OR IGNORE INTO todo_labels (todo_id, label_id) VALUES (?, ?)");
      for (const labelId of label_ids) {
        insertLabel.run(todoId, labelId);
      }
    }

    if (subtasks.length > 0) {
      const insertSubtask = db.prepare("INSERT INTO subtasks (todo_id, title) VALUES (?, ?)");
      for (const subtask of subtasks) {
        insertSubtask.run(todoId, subtask.title.trim());
      }
    }

    return todoId;
  });

  const todoId = transaction();
  const row = db
    .prepare(
      `SELECT
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.due_date,
        t.created_at,
        t.updated_at,
        t.completed_at,
        t.project_id,
        p.name as project_name,
        p.color as project_color
      FROM todos t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ? AND t.id = ?`
    )
    .all(req.user.id, todoId);

  return res.status(201).json(withLabelsAndSubtasks(row)[0]);
});

app.put("/api/todos/:id", (req, res) => {
  const todoId = parseIntId(req.params.id);
  if (!todoId) {
    return res.status(400).json({ error: "Invalid todo id" });
  }

  const parsed = todoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { title, description, status, priority, due_date, project_id, label_ids } = parsed.data;

  const existing = db
    .prepare("SELECT id FROM todos WHERE id = ? AND user_id = ?")
    .get(todoId, req.user.id);
  if (!existing) {
    return res.status(404).json({ error: "Todo not found" });
  }

  if (!assertProjectOwnership(project_id, req.user.id)) {
    return res.status(400).json({ error: "Invalid project" });
  }

  if (!assertLabelOwnership(label_ids, req.user.id)) {
    return res.status(400).json({ error: "One or more labels are invalid" });
  }

  const normalizedDueDate = normalizeDateValue(due_date);

  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE todos
       SET title = ?, description = ?, status = ?, priority = ?, due_date = ?,
           project_id = ?, updated_at = CURRENT_TIMESTAMP,
           completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE NULL END
       WHERE id = ? AND user_id = ?`
    ).run(
      title.trim(),
      description ?? null,
      status,
      priority,
      normalizedDueDate,
      project_id ?? null,
      status,
      todoId,
      req.user.id
    );

    db.prepare("DELETE FROM todo_labels WHERE todo_id = ?").run(todoId);

    if (label_ids.length > 0) {
      const insertLabel = db.prepare("INSERT OR IGNORE INTO todo_labels (todo_id, label_id) VALUES (?, ?)");
      for (const labelId of label_ids) {
        insertLabel.run(todoId, labelId);
      }
    }
  });

  transaction();

  const row = db
    .prepare(
      `SELECT
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.due_date,
        t.created_at,
        t.updated_at,
        t.completed_at,
        t.project_id,
        p.name as project_name,
        p.color as project_color
      FROM todos t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ? AND t.id = ?`
    )
    .all(req.user.id, todoId);

  return res.json(withLabelsAndSubtasks(row)[0]);
});

app.patch("/api/todos/:id/toggle", (req, res) => {
  const todoId = parseIntId(req.params.id);
  if (!todoId) {
    return res.status(400).json({ error: "Invalid todo id" });
  }

  const todo = db
    .prepare("SELECT id, status FROM todos WHERE id = ? AND user_id = ?")
    .get(todoId, req.user.id);
  if (!todo) {
    return res.status(404).json({ error: "Todo not found" });
  }

  const nextStatus = todo.status === "done" ? "todo" : "done";
  db.prepare(
    `UPDATE todos
     SET status = ?, updated_at = CURRENT_TIMESTAMP,
         completed_at = CASE WHEN ? = 'done' THEN CURRENT_TIMESTAMP ELSE NULL END
     WHERE id = ? AND user_id = ?`
  ).run(nextStatus, nextStatus, todoId, req.user.id);

  const row = db
    .prepare(
      `SELECT
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.due_date,
        t.created_at,
        t.updated_at,
        t.completed_at,
        t.project_id,
        p.name as project_name,
        p.color as project_color
      FROM todos t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ? AND t.id = ?`
    )
    .all(req.user.id, todoId);

  return res.json(withLabelsAndSubtasks(row)[0]);
});

app.delete("/api/todos/:id", (req, res) => {
  const todoId = parseIntId(req.params.id);
  if (!todoId) {
    return res.status(400).json({ error: "Invalid todo id" });
  }

  const result = db
    .prepare("DELETE FROM todos WHERE id = ? AND user_id = ?")
    .run(todoId, req.user.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Todo not found" });
  }

  return res.status(204).send();
});

app.post("/api/todos/:id/subtasks", (req, res) => {
  const todoId = parseIntId(req.params.id);
  if (!todoId) {
    return res.status(400).json({ error: "Invalid todo id" });
  }

  const parsed = z.object({ title: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const todo = db
    .prepare("SELECT id FROM todos WHERE id = ? AND user_id = ?")
    .get(todoId, req.user.id);
  if (!todo) {
    return res.status(404).json({ error: "Todo not found" });
  }

  const result = db
    .prepare("INSERT INTO subtasks (todo_id, title) VALUES (?, ?)")
    .run(todoId, parsed.data.title.trim());

  db.prepare("UPDATE todos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(todoId);

  const subtask = db
    .prepare("SELECT id, todo_id, title, is_completed, created_at FROM subtasks WHERE id = ?")
    .get(result.lastInsertRowid);

  return res.status(201).json({ ...subtask, is_completed: Boolean(subtask.is_completed) });
});

app.patch("/api/subtasks/:id/toggle", (req, res) => {
  const subtaskId = parseIntId(req.params.id);
  if (!subtaskId) {
    return res.status(400).json({ error: "Invalid subtask id" });
  }

  const subtask = db
    .prepare(
      `SELECT s.id, s.todo_id, s.is_completed
       FROM subtasks s
       JOIN todos t ON t.id = s.todo_id
       WHERE s.id = ? AND t.user_id = ?`
    )
    .get(subtaskId, req.user.id);

  if (!subtask) {
    return res.status(404).json({ error: "Subtask not found" });
  }

  const nextValue = subtask.is_completed ? 0 : 1;
  db.prepare("UPDATE subtasks SET is_completed = ? WHERE id = ?").run(nextValue, subtaskId);
  db.prepare("UPDATE todos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(subtask.todo_id);

  return res.json({ id: subtaskId, is_completed: Boolean(nextValue) });
});

app.delete("/api/subtasks/:id", (req, res) => {
  const subtaskId = parseIntId(req.params.id);
  if (!subtaskId) {
    return res.status(400).json({ error: "Invalid subtask id" });
  }

  const subtask = db
    .prepare(
      `SELECT s.id, s.todo_id
       FROM subtasks s
       JOIN todos t ON t.id = s.todo_id
       WHERE s.id = ? AND t.user_id = ?`
    )
    .get(subtaskId, req.user.id);

  if (!subtask) {
    return res.status(404).json({ error: "Subtask not found" });
  }

  db.prepare("DELETE FROM subtasks WHERE id = ?").run(subtaskId);
  db.prepare("UPDATE todos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(subtask.todo_id);

  return res.status(204).send();
});

app.use((error, _, res, __) => {
  console.error(error);
  return res.status(500).json({ error: "Unexpected server error" });
});

app.listen(port, () => {
  console.log(`Todo backend running on http://localhost:${port}`);
});
