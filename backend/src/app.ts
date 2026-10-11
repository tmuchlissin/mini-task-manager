import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { pool } from "./db.js";
import { broadcastTaskChange, presenceRouter } from "./presence.js";
import { actors, statuses } from "./constants.js";

export const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/presence", presenceRouter);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AsyncRoute = (request: Request, response: Response) => Promise<void>;
const route = (handler: AsyncRoute) => (request: Request, response: Response, next: NextFunction) => {
  Promise.resolve(handler(request, response)).catch(next);
};

function validActor(value: unknown): value is (typeof actors)[number] {
  return typeof value === "string" && actors.some((actor) => actor === value);
}

function validId(request: Request, response: Response): boolean {
  if (uuidPattern.test(request.params.id)) return true;
  response.status(400).json({ error: "Invalid task id" });
  return false;
}

app.get("/api/health", route(async (_request, response) => {
  await pool.query("SELECT 1");
  response.json({ status: "ok" });
}));

app.get("/api/actors", (_request, response) => { response.json(actors); });

app.get("/api/tasks", route(async (request, response) => {
  const includeDeleted = request.query.includeDeleted === "true";
  const result = await pool.query(
    `SELECT id, title, description, status, created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
     FROM tasks WHERE ($1::boolean OR deleted_at IS NULL) ORDER BY created_at ASC, id ASC`,
    [includeDeleted]
  );
  response.json(result.rows);
}));

app.post("/api/tasks", route(async (request, response) => {
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body?.description === "string" ? request.body.description.trim() : "";
  const actor = request.body?.actor;
  if (!title || title.length > 120 || description.length > 1000 || !validActor(actor)) {
    response.status(400).json({ error: "Title (1–120 characters), description (up to 1000 characters), and a valid actor are required" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const task = await client.query(
      `INSERT INTO tasks(title, description) VALUES ($1, $2)
       RETURNING id, title, description, status, created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`,
      [title, description]
    );
    await client.query(
      `INSERT INTO audit_logs(task_id, actor, action, from_status, to_status, task_title, task_description)
       VALUES ($1, $2, 'created', NULL, 'to_do', $3, $4)`,
      [task.rows[0].id, actor, title, description]
    );
    await client.query("COMMIT");
    broadcastTaskChange();
    response.status(201).json(task.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}));

app.put("/api/tasks/:id", route(async (request, response) => {
  if (!validId(request, response)) return;
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body?.description === "string" ? request.body.description.trim() : "";
  const actor = request.body?.actor;
  if (!title || title.length > 120 || description.length > 1000 || !validActor(actor)) {
    response.status(400).json({ error: "Title (1–120 characters), description (up to 1000 characters), and a valid actor are required" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, title, description, status, created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM tasks WHERE id = $1 FOR UPDATE`, [request.params.id]
    );
    if (!current.rowCount || current.rows[0].deletedAt) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Task not found" });
      return;
    }
    if (current.rows[0].title === title && current.rows[0].description === description) {
      await client.query("COMMIT");
      response.json({ ...current.rows[0], unchanged: true });
      return;
    }
    const updated = await client.query(
      `UPDATE tasks SET title = $2, description = $3, updated_at = now() WHERE id = $1
       RETURNING id, title, description, status, created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`,
      [request.params.id, title, description]
    );
    await client.query(
      `INSERT INTO audit_logs(task_id, actor, action, previous_title, previous_description, task_title, task_description)
       VALUES ($1, $2, 'details_changed', $3, $4, $5, $6)`,
      [request.params.id, actor, current.rows[0].title, current.rows[0].description, title, description]
    );
    await client.query("COMMIT");
    broadcastTaskChange();
    response.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}));

app.put("/api/tasks/:id/status", route(async (request, response) => {
  if (!validId(request, response)) return;
  const { status, actor } = request.body ?? {};
  if (!statuses.some((item) => item === status) || !validActor(actor)) {
    response.status(400).json({ error: "Valid status and actor are required" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT id, title, description, status, deleted_at FROM tasks WHERE id = $1 FOR UPDATE", [request.params.id]
    );
    if (!current.rowCount || current.rows[0].deleted_at) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Task not found" });
      return;
    }
    const task = current.rows[0];
    if (task.status === status) {
      await client.query("COMMIT");
      response.json({ id: task.id, title: task.title, status: task.status, unchanged: true });
      return;
    }
    if (statuses.indexOf(status) !== statuses.indexOf(task.status) + 1) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Status must move to the next step" });
      return;
    }
    const updated = await client.query(
      `UPDATE tasks SET status = $2, updated_at = now() WHERE id = $1
       RETURNING id, title, description, status, created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`,
      [task.id, status]
    );
    await client.query(
      `INSERT INTO audit_logs(task_id, actor, action, from_status, to_status, task_title, task_description)
       VALUES ($1, $2, 'status_changed', $3, $4, $5, $6)`,
      [task.id, actor, task.status, status, task.title, task.description]
    );
    await client.query("COMMIT");
    broadcastTaskChange();
    response.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}));

app.delete("/api/tasks/:id", route(async (request, response) => {
  if (!validId(request, response)) return;
  const actor = request.body?.actor;
  if (!validActor(actor)) {
    response.status(400).json({ error: "Valid actor is required" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT id, title, description, status, deleted_at FROM tasks WHERE id = $1 FOR UPDATE", [request.params.id]);
    if (!current.rowCount || current.rows[0].deleted_at) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Task not found" });
      return;
    }
    const task = current.rows[0];
    await client.query("UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id = $1", [task.id]);
    await client.query(
      `INSERT INTO audit_logs(task_id, actor, action, from_status, to_status, task_title, task_description)
       VALUES ($1, $2, 'deleted', $3, NULL, $4, $5)`,
      [task.id, actor, task.status, task.title, task.description]
    );
    await client.query("COMMIT");
    broadcastTaskChange();
    response.status(204).send();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}));

app.get("/api/tasks/:id/audit-logs", route(async (request, response) => {
  if (!validId(request, response)) return;
  const task = await pool.query("SELECT id FROM tasks WHERE id = $1", [request.params.id]);
  if (!task.rowCount) {
    response.status(404).json({ error: "Task not found" });
    return;
  }
  const result = await pool.query(
    `SELECT id, task_id AS "taskId", actor, action, from_status AS "fromStatus",
       to_status AS "toStatus", previous_title AS "previousTitle", previous_description AS "previousDescription",
       task_title AS "taskTitle", task_description AS "taskDescription", occurred_at AS "occurredAt"
     FROM audit_logs WHERE task_id = $1 ORDER BY occurred_at ASC, id ASC`,
    [request.params.id]
  );
  response.json(result.rows);
}));

app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  response.status(500).json({ error: "Internal server error" });
});
