import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";

const statuses = ["to_do", "pending", "in_progress", "done"] as const;
type Status = (typeof statuses)[number];
type Task = { id: string; title: string; status: Status; createdAt: string; updatedAt: string; deletedAt: string | null };
type AuditLog = { id: string; taskId: string; actor: string; action: "created" | "status_changed" | "deleted"; fromStatus: Status | null; toStatus: Status | null; taskTitle: string; occurredAt: string };
type LiveCursor = { clientId: string; actor: string; taskId: string; x: number; y: number; sequence: number };
const labels: Record<Status, string> = { to_do: "To Do", pending: "Pending", in_progress: "In Progress", done: "Done" };

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function describe(log: AuditLog): string {
  if (log.action === "created") return `membuat task “${log.taskTitle}”`;
  if (log.action === "deleted") return `menghapus task “${log.taskTitle}”`;
  return `mengubah status dari ${labels[log.fromStatus!]} ke ${labels[log.toStatus!]}`;
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [actor, setActor] = useState("");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<Status | null>(null);
  const [liveCursors, setLiveCursors] = useState<LiveCursor[]>([]);
  const boardRef = useRef<HTMLElement>(null);
  const clientId = useRef(crypto.randomUUID());
  const lastCursorUpdate = useRef(0);
  const cursorSequence = useRef(0);

  async function refresh() {
    const rows = await api<Task[]>("/api/tasks?includeDeleted=true");
    setTasks(rows);
    setSelected((current) => current ? rows.find((task) => task.id === current.id) ?? null : null);
  }

  useEffect(() => {
    Promise.all([api<Task[]>("/api/tasks?includeDeleted=true"), api<string[]>("/api/actors")])
      .then(([rows, users]) => { setTasks(rows); setActors(users); setActor(users[0] ?? ""); })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const stream = new EventSource("/api/presence");
    stream.addEventListener("cursors", (event) => {
      const cursors = JSON.parse(event.data) as LiveCursor[];
      setLiveCursors(cursors.filter((cursor) => cursor.clientId !== clientId.current));
    });
    stream.addEventListener("tasks-changed", () => {
      void refresh().catch((cause: Error) => setError(cause.message));
    });
    const stopOnLeave = () => stopPresence();
    window.addEventListener("pagehide", stopOnLeave);
    return () => {
      stream.close();
      window.removeEventListener("pagehide", stopOnLeave);
      stopPresence();
    };
  }, []);

  function stopPresence() {
    void fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: clientId.current, active: false, sequence: ++cursorSequence.current }),
      keepalive: true
    }).catch(() => {});
  }

  function publishCursor(event: DragEvent<HTMLElement>, task: Task, force = false) {
    const board = boardRef.current;
    if (!board || event.clientX <= 0 || event.clientY <= 0) return;
    const now = Date.now();
    if (!force && now - lastCursorUpdate.current < 80) return;
    lastCursorUpdate.current = now;
    const rect = board.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    void fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: clientId.current, actor, taskId: task.id, x, y, sequence: ++cursorSequence.current })
    }).catch(() => {});
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Terjadi kesalahan"); }
    finally { setBusy(false); }
  }

  function create(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api<Task>("/api/tasks", { method: "POST", body: JSON.stringify({ title, actor }) });
      setTitle("");
      await refresh();
    });
  }

  function moveToStatus(task: Task, next: Status) {
    if (busy || statuses.indexOf(next) !== statuses.indexOf(task.status) + 1) return;
    void run(async () => {
      await api<Task>(`/api/tasks/${task.id}/status`, { method: "PUT", body: JSON.stringify({ status: next, actor }) });
      await refresh();
      if (selected?.id === task.id) setLogs(await api<AuditLog[]>(`/api/tasks/${task.id}/audit-logs`));
    });
  }

  function advance(task: Task) {
    const next = statuses[statuses.indexOf(task.status) + 1];
    if (next) moveToStatus(task, next);
  }

  function canDrop(task: Task | undefined, target: Status): task is Task {
    return !!task && !busy && statuses.indexOf(target) === statuses.indexOf(task.status) + 1;
  }

  function startDrag(event: DragEvent<HTMLElement>, task: Task) {
    event.dataTransfer.setData("application/x-mini-task-id", task.id);
    event.dataTransfer.effectAllowed = "move";
    setDraggedId(task.id);
    publishCursor(event, task, true);
  }

  function endDrag() {
    setDraggedId(null);
    setOverStatus(null);
    stopPresence();
  }

  function dragOver(event: DragEvent<HTMLElement>, target: Status) {
    const task = tasks.find((item) => item.id === draggedId);
    if (task) publishCursor(event, task);
    if (!canDrop(task, target)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (overStatus !== target) setOverStatus(target);
  }

  function drop(event: DragEvent<HTMLElement>, target: Status) {
    event.preventDefault();
    const id = event.dataTransfer.getData("application/x-mini-task-id");
    const task = tasks.find((item) => item.id === id);
    endDrag();
    if (canDrop(task, target)) moveToStatus(task, target);
  }

  function remove(task: Task) {
    if (!window.confirm(`Hapus “${task.title}”? Riwayatnya tetap tersimpan.`)) return;
    void run(async () => {
      await api<void>(`/api/tasks/${task.id}`, { method: "DELETE", body: JSON.stringify({ actor }) });
      await refresh();
      if (selected?.id === task.id) setLogs(await api<AuditLog[]>(`/api/tasks/${task.id}/audit-logs`));
    });
  }

  async function openHistory(task: Task) {
    setSelected(task);
    setLogs([]);
    try { setLogs(await api<AuditLog[]>(`/api/tasks/${task.id}/audit-logs`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Gagal memuat riwayat"); }
  }

  const active = tasks.filter((task) => !task.deletedAt);
  const archived = tasks.filter((task) => task.deletedAt);

  return (
    <main>
      <header className="page-header">
        <div><p className="eyebrow">INTERNAL WORKSPACE</p><h1>Mini Task Manager</h1><p>Kelola task dan lihat setiap perubahan dengan jelas.</p></div>
        <span className="count">{active.length} task aktif</span>
      </header>

      <section className="toolbar" aria-label="Buat task">
        <form onSubmit={create}>
          <label htmlFor="task-title">Task baru</label>
          <div className="form-row">
            <input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Contoh: Prepare Invoice" required />
            <button type="submit" disabled={busy || !actor}>Tambah task</button>
          </div>
        </form>
        <div className="actor-control"><label htmlFor="actor">Bertindak sebagai</label><select id="actor" value={actor} onChange={(event) => setActor(event.target.value)} disabled={busy}>{actors.map((name) => <option key={name}>{name}</option>)}</select></div>
      </section>

      <p className="board-hint"><span className="desktop-hint">Geser kartu ke kolom berikutnya untuk mengubah status. </span><span className="mobile-hint">Gunakan tombol pada kartu untuk mengubah status. </span>Actor yang dipilih akan tercatat di riwayat.</p>

      {error && <p className="error" role="alert">{error} <button type="button" onClick={() => void refresh().catch((cause: Error) => setError(cause.message))}>Coba muat ulang</button></p>}
      {loading ? <p>Memuat task...</p> : <section className="board" ref={boardRef} aria-label="Task board">
        {statuses.map((status) => {
          const columnTasks = active.filter((task) => task.status === status);
          const draggingTask = tasks.find((task) => task.id === draggedId);
          const eligible = canDrop(draggingTask, status);
          return <div className={`column ${status}${eligible ? " drop-eligible" : ""}${overStatus === status ? " drop-over" : ""}`} key={status}
            onDragOver={(event) => dragOver(event, status)}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOverStatus(null); }}
            onDrop={(event) => drop(event, status)}>
            <div className="column-heading"><h2>{labels[status]}</h2><span>{columnTasks.length}</span></div>
            <div className="cards">{columnTasks.length ? columnTasks.map((task) => <article className={`card${draggedId === task.id ? " dragging" : ""}`} key={task.id}
              draggable={!busy && status !== "done"}
              onDragStart={(event) => startDrag(event, task)}
              onDrag={(event) => publishCursor(event, task)}
              onDragEnd={endDrag}>
              <h3>{task.title}</h3><p>Dibuat {new Date(task.createdAt).toLocaleDateString("id-ID")}</p>
              <div className="card-actions">
                <button type="button" className="text-button" onClick={() => void openHistory(task)}>Riwayat</button>
                {status !== "done" && <button type="button" onClick={() => advance(task)} disabled={busy}>Ke {labels[statuses[statuses.indexOf(status) + 1]]} →</button>}
                <button type="button" className="delete-button" onClick={() => remove(task)} disabled={busy} aria-label={`Hapus ${task.title}`}>Hapus</button>
              </div>
            </article>) : <p className="empty">Belum ada task</p>}</div>
          </div>;
        })}
        {liveCursors.map((cursor) => {
          const task = tasks.find((item) => item.id === cursor.taskId);
          const color = ["#4469ee", "#9b6be8", "#e47758"][Math.max(0, actors.indexOf(cursor.actor)) % 3];
          return <div className="live-cursor" key={cursor.clientId} style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}>
            <svg width="19" height="23" viewBox="0 0 19 23" aria-hidden="true"><path d="M1 1v18l4.5-4.5 3.5 7 3-1.5-3.5-7H17L1 1Z" fill={color} stroke="white" strokeWidth="1.5" /></svg>
            <span style={{ backgroundColor: color }}>{cursor.actor}{task ? ` · ${task.title}` : " sedang memindahkan"}</span>
          </div>;
        })}
      </section>}

      <section className="archive"><button type="button" className="archive-toggle" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>{showArchived ? "Sembunyikan" : "Lihat"} task dihapus ({archived.length})</button>
        {showArchived && <div className="archive-list">{archived.length ? archived.map((task) => <div key={task.id}><span>{task.title}</span><button type="button" className="text-button" onClick={() => void openHistory(task)}>Lihat riwayat</button></div>) : <p>Belum ada task yang dihapus.</p>}</div>}
      </section>

      {selected && <div className="overlay" onClick={() => setSelected(null)}><aside className="history" aria-label="Riwayat task" onClick={(event) => event.stopPropagation()}>
        <div className="history-heading"><div><p className="eyebrow">AUDIT LOG</p><h2>{selected.title}</h2><p>{selected.deletedAt ? "Task dihapus" : `Status: ${labels[selected.status]}`}</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Tutup riwayat">×</button></div>
        <ol className="timeline">{logs.map((log) => <li key={log.id}><p><strong>{log.actor}</strong> {describe(log)}</p><time dateTime={log.occurredAt}>{new Date(log.occurredAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</time></li>)}</ol>
      </aside></div>}
    </main>
  );
}
