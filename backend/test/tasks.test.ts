import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

let server: Server;
let baseUrl: string;

before(async () => {
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}

test("status transitions, idempotence, soft delete, and immutable audit history", async () => {
  const title = `Integration test ${crypto.randomUUID()}`;
  const created = await request("/tasks", "POST", { title, actor: "john.doe" });
  assert.equal(created.status, 201);
  const id = created.data.id as string;

  const renamedTitle = `${title} renamed`;
  const renamed = await request(`/tasks/${id}`, "PUT", { title: renamedTitle, actor: "alex.lee" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.title, renamedTitle);
  const repeatedRename = await request(`/tasks/${id}`, "PUT", { title: renamedTitle, actor: "alex.lee" });
  assert.equal(repeatedRename.status, 200);
  assert.equal(repeatedRename.data.unchanged, true);

  const invalid = await request(`/tasks/${id}/status`, "PUT", { status: "done", actor: "john.doe" });
  assert.equal(invalid.status, 409);

  const pending = await request(`/tasks/${id}/status`, "PUT", { status: "pending", actor: "jane.smith" });
  assert.equal(pending.status, 200);
  assert.equal(pending.data.status, "pending");

  const repeated = await request(`/tasks/${id}/status`, "PUT", { status: "pending", actor: "jane.smith" });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.data.unchanged, true);

  const beforeDelete = await request(`/tasks/${id}/audit-logs`);
  assert.deepEqual(beforeDelete.data.map((log: { action: string }) => log.action), ["created", "title_changed", "status_changed"]);
  assert.equal(beforeDelete.data[1].previousTitle, title);
  assert.equal(beforeDelete.data[1].taskTitle, renamedTitle);
  assert.equal(beforeDelete.data[2].fromStatus, "to_do");
  assert.equal(beforeDelete.data[2].toStatus, "pending");
  assert.equal(beforeDelete.data[2].actor, "jane.smith");

  const progressing = await request(`/tasks/${id}/status`, "PUT", { status: "in_progress", actor: "alex.lee" });
  assert.equal(progressing.status, 200);
  const done = await request(`/tasks/${id}/status`, "PUT", { status: "done", actor: "john.doe" });
  assert.equal(done.status, 200);
  const backward = await request(`/tasks/${id}/status`, "PUT", { status: "pending", actor: "john.doe" });
  assert.equal(backward.status, 409);
  const completedLogs = await request(`/tasks/${id}/audit-logs`);
  assert.deepEqual(completedLogs.data.filter((log: { action: string }) => log.action === "status_changed")
    .map((log: { toStatus: string }) => log.toStatus), ["pending", "in_progress", "done"]);
  assert.deepEqual(completedLogs.data.map((log: { occurredAt: string }) => log.occurredAt),
    [...completedLogs.data.map((log: { occurredAt: string }) => log.occurredAt)].sort());

  await assert.rejects(
    pool.query("UPDATE audit_logs SET actor = 'other' WHERE id = $1", [beforeDelete.data[2].id]),
    /append-only/
  );
  await assert.rejects(
    pool.query("DELETE FROM audit_logs WHERE id = $1", [beforeDelete.data[2].id]),
    /append-only/
  );
  await assert.rejects(pool.query("TRUNCATE audit_logs"), /append-only/);

  const removed = await request(`/tasks/${id}`, "DELETE", { actor: "alex.lee" });
  assert.equal(removed.status, 204);
  const active = await request("/tasks");
  assert.equal(active.data.some((task: { id: string }) => task.id === id), false);
  const archived = await request("/tasks?includeDeleted=true");
  assert.equal(archived.data.some((task: { id: string; deletedAt: string | null }) => task.id === id && task.deletedAt), true);
  const afterDelete = await request(`/tasks/${id}/audit-logs`);
  assert.deepEqual(afterDelete.data.map((log: { action: string }) => log.action),
    ["created", "title_changed", "status_changed", "status_changed", "status_changed", "deleted"]);
});
