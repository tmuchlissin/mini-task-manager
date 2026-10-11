import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { broadcastTaskChange } from "../src/presence.js";

let server: Server;
let baseUrl: string;
const streams: AbortController[] = [];
const buffers = new Map<ReadableStreamDefaultReader<Uint8Array>, string>();

before(async () => {
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  baseUrl = `http://127.0.0.1:${address.port}/api/presence`;
});

after(async () => {
  streams.forEach((controller) => controller.abort());
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

async function subscribe() {
  const controller = new AbortController();
  streams.push(controller);
  const response = await fetch(baseUrl, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  return response.body!.getReader();
}

async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let buffer = buffers.get(reader) ?? "";
  for (;;) {
    const separator = buffer.indexOf("\n\n");
    if (separator >= 0) {
      const message = buffer.slice(0, separator);
      buffers.set(reader, buffer.slice(separator + 2));
      const event = message.match(/^event: (.+)$/m)?.[1];
      const data = message.match(/^data: (.+)$/m)?.[1];
      return { event, data: JSON.parse(data ?? "null") };
    }
    const result = await reader.read();
    if (result.done) throw new Error("SSE stream closed unexpectedly");
    buffer += new TextDecoder().decode(result.value);
  }
}

test("two subscribers see live cursor movement, removal, and task updates", async () => {
  const first = await subscribe();
  const second = await subscribe();
  assert.deepEqual((await nextEvent(first)).data, []);
  assert.deepEqual((await nextEvent(second)).data, []);

  const clientId = crypto.randomUUID();
  const position = { clientId, actor: "jane.smith", taskId: crypto.randomUUID(), x: 0.4, y: 0.6, sequence: 1 };
  const started = await fetch(baseUrl, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(position)
  });
  assert.equal(started.status, 204);
  const firstUpdate = await nextEvent(first);
  const secondUpdate = await nextEvent(second);
  assert.equal(firstUpdate.event, "cursors");
  assert.deepEqual(firstUpdate.data, [position]);
  assert.deepEqual(secondUpdate.data, [position]);

  broadcastTaskChange();
  assert.equal((await nextEvent(first)).event, "tasks-changed");
  assert.equal((await nextEvent(second)).event, "tasks-changed");

  const stopped = await fetch(baseUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, active: false, sequence: 2 })
  });
  assert.equal(stopped.status, 204);
  assert.deepEqual((await nextEvent(first)).data, []);
  assert.deepEqual((await nextEvent(second)).data, []);
  const latePosition = await fetch(baseUrl, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(position)
  });
  assert.equal(latePosition.status, 204);
  const lateSubscriber = await subscribe();
  assert.deepEqual((await nextEvent(lateSubscriber)).data, []);
});
