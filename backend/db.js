const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "data", "todo.sqlite");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function tableExists(tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function columnExists(tableName, columnName) {
  if (!tableExists(tableName)) {
    return false;
  }

  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function createAuthSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#64748b',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#0ea5e9',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      project_id INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS todo_labels (
      todo_id INTEGER NOT NULL,
      label_id INTEGER NOT NULL,
      PRIMARY KEY (todo_id, label_id),
      FOREIGN KEY(todo_id) REFERENCES todos(id) ON DELETE CASCADE,
      FOREIGN KEY(label_id) REFERENCES labels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(todo_id) REFERENCES todos(id) ON DELETE CASCADE
    );
  `);
}

function recreateLegacyTablesIfNeeded() {
  const todosHasUser = columnExists("todos", "user_id");
  const projectsHasUser = columnExists("projects", "user_id");
  const labelsHasUser = columnExists("labels", "user_id");

  if (todosHasUser && projectsHasUser && labelsHasUser) {
    return;
  }

  db.exec(`
    DROP TABLE IF EXISTS todo_labels;
    DROP TABLE IF EXISTS subtasks;
    DROP TABLE IF EXISTS todos;
    DROP TABLE IF EXISTS projects;
    DROP TABLE IF EXISTS labels;
  `);
}

function seedDefaultsForUser(userId) {
  const existingProjects = db
    .prepare("SELECT COUNT(*) as count FROM projects WHERE user_id = ?")
    .get(userId).count;

  if (existingProjects === 0) {
    const insertProject = db.prepare("INSERT INTO projects (user_id, name, color) VALUES (?, ?, ?)");
    insertProject.run(userId, "Personal", "#0ea5e9");
    insertProject.run(userId, "Work", "#10b981");
    insertProject.run(userId, "Learning", "#8b5cf6");
  }

  const existingLabels = db
    .prepare("SELECT COUNT(*) as count FROM labels WHERE user_id = ?")
    .get(userId).count;

  if (existingLabels === 0) {
    const insertLabel = db.prepare("INSERT INTO labels (user_id, name, color) VALUES (?, ?, ?)");
    insertLabel.run(userId, "Bug", "#ef4444");
    insertLabel.run(userId, "Feature", "#22c55e");
    insertLabel.run(userId, "Research", "#f59e0b");
  }
}

function initDb() {
  db.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  recreateLegacyTablesIfNeeded();
  createAuthSchema();
}

function withLabelsAndSubtasks(todoRows) {
  const labelStmt = db.prepare(
    `SELECT l.id, l.name, l.color
     FROM labels l
     JOIN todo_labels tl ON tl.label_id = l.id
     WHERE tl.todo_id = ?
     ORDER BY l.name ASC`
  );

  const subtaskStmt = db.prepare(
    `SELECT id, title, is_completed, created_at
     FROM subtasks
     WHERE todo_id = ?
     ORDER BY id ASC`
  );

  return todoRows.map((todo) => {
    const labels = labelStmt.all(todo.id);
    const subtasks = subtaskStmt.all(todo.id).map((subtask) => ({
      ...subtask,
      is_completed: Boolean(subtask.is_completed),
    }));

    return {
      ...todo,
      labels,
      subtasks,
      completion_ratio:
        subtasks.length === 0
          ? 0
          : Math.round(
              (subtasks.filter((item) => item.is_completed).length / subtasks.length) * 100
            ),
    };
  });
}

module.exports = {
  db,
  initDb,
  seedDefaultsForUser,
  withLabelsAndSubtasks,
};
