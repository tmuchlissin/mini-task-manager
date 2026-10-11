import { Router, type Response } from "express";
import { actors } from "./constants.js";

type Cursor = {
  clientId: string;
  actor: string;
  taskId: string;
  x: number;
  y: number;
  sequence: number;
  expiresAt: number;
};

const cursors = new Map<string, Cursor>();
const versions = new Map<string, { sequence: number; expiresAt: number }>();
const subscribers = new Set<Response>();
const cursorLifetimeMs = 5_000;

export const presenceRouter = Router();

function send(response: Response, event: string, payload: unknown) {
  try {
    response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch {
    subscribers.delete(response);
  }
}

function broadcast(event: string, payload: unknown) {
  for (const response of subscribers) send(response, event, payload);
}

function publishCursors() {
  broadcast("cursors", [...cursors.values()].map(({ expiresAt: _expiresAt, ...cursor }) => cursor));
}

export function broadcastTaskChange() {
  broadcast("tasks-changed", {});
}

const cleanup = setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, cursor] of cursors) {
    if (cursor.expiresAt < now) {
      cursors.delete(id);
      changed = true;
    }
  }
  for (const [id, version] of versions) {
    if (version.expiresAt < now) versions.delete(id);
  }
  if (changed) publishCursors();
}, 1_000);
cleanup.unref();

presenceRouter.get("/", (request, response) => {
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.flushHeaders();
  subscribers.add(response);
  send(response, "cursors", [...cursors.values()].map(({ expiresAt: _expiresAt, ...cursor }) => cursor));
  request.on("close", () => subscribers.delete(response));
});

presenceRouter.post("/", (request, response) => {
  const { clientId, actor, taskId, x, y, active, sequence } = request.body ?? {};
  if (typeof clientId !== "string" || !/^[0-9a-f-]{36}$/i.test(clientId)) {
    response.status(400).json({ error: "Invalid client id" });
    return;
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    response.status(400).json({ error: "Invalid cursor sequence" });
    return;
  }
  const previous = versions.get(clientId);
  if (previous && sequence <= previous.sequence) {
    response.status(204).send();
    return;
  }
  if (active === false) {
    versions.set(clientId, { sequence, expiresAt: Date.now() + cursorLifetimeMs });
    if (cursors.delete(clientId)) publishCursors();
    response.status(204).send();
    return;
  }
  if (!actors.some((name) => name === actor) || typeof taskId !== "string" || taskId.length > 100 ||
      typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1 ||
      typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > 1) {
    response.status(400).json({ error: "Invalid cursor data" });
    return;
  }
  versions.set(clientId, { sequence, expiresAt: Date.now() + cursorLifetimeMs });
  cursors.set(clientId, { clientId, actor, taskId, x, y, sequence, expiresAt: Date.now() + cursorLifetimeMs });
  publishCursors();
  response.status(204).send();
});
