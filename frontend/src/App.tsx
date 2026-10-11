import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";

const statuses = ["to_do", "pending", "in_progress", "done"] as const;
type Status = (typeof statuses)[number];
type Task = { id: string; title: string; description: string; status: Status; createdAt: string; updatedAt: string; deletedAt: string | null };
type AuditLog = { id: string; taskId: string; actor: string; action: "created" | "title_changed" | "details_changed" | "status_changed" | "deleted"; fromStatus: Status | null; toStatus: Status | null; previousTitle: string | null; previousDescription: string | null; taskTitle: string; taskDescription: string | null; occurredAt: string };
type LiveCursor = { clientId: string; actor: string; taskId: string; x: number; y: number; sequence: number };
const labels: Record<Status, string> = { to_do: "To Do", pending: "Pending", in_progress: "In Progress", done: "Done" };
type Theme = "light" | "dark";

function initialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem("mini-task-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* Storage may be unavailable in private browsing. */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

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
  if (log.action === "created") return `created task “${log.taskTitle}”`;
  if (log.action === "deleted") return `deleted task “${log.taskTitle}”`;
  if (log.action === "title_changed") return `renamed “${log.previousTitle}” to “${log.taskTitle}”`;
  if (log.action === "details_changed") {
    const titleChanged = log.previousTitle !== log.taskTitle;
    const descriptionChanged = (log.previousDescription ?? "") !== (log.taskDescription ?? "");
    if (titleChanged && descriptionChanged) return `updated the title and description`;
    if (titleChanged) return `renamed “${log.previousTitle}” to “${log.taskTitle}”`;
    return `updated the description`;
  }
  return `changed the status from ${labels[log.fromStatus!]} to ${labels[log.toStatus!]}`;
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [actor, setActor] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage.setItem("mini-task-theme", theme); }
    catch { /* The selected theme still applies for this session. */ }
  }, [theme]);

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
      await api<Task>("/api/tasks", { method: "POST", body: JSON.stringify({ title, description, actor }) });
      setTitle("");
      setDescription("");
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
    if (!window.confirm(`Delete “${task.title}”? Its history will be preserved.`)) return;
    void run(async () => {
      await api<void>(`/api/tasks/${task.id}`, { method: "DELETE", body: JSON.stringify({ actor }) });
      await refresh();
      if (selected?.id === task.id) setLogs(await api<AuditLog[]>(`/api/tasks/${task.id}/audit-logs`));
    });
  }

  async function openHistory(task: Task) {
    setSelected(task);
    setEditTitle(task.title);
    setEditDescription(task.description);
    setLogs([]);
    try { setLogs(await api<AuditLog[]>(`/api/tasks/${task.id}/audit-logs`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to load history"); }
  }

  async function updateDetails(event: FormEvent) {
    event.preventDefault();
    if (!selected || selected.deletedAt) return;
    setBusy(true); setError("");
    try {
      const updated = await api<Task>(`/api/tasks/${selected.id}`, { method: "PUT", body: JSON.stringify({ title: editTitle, description: editDescription, actor }) });
      setSelected(updated);
      setEditTitle(updated.title);
      setEditDescription(updated.description);
      await refresh();
      setLogs(await api<AuditLog[]>(`/api/tasks/${updated.id}/audit-logs`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to update task"); }
    finally { setBusy(false); }
  }

  const active = tasks.filter((task) => !task.deletedAt);
  const archived = tasks.filter((task) => task.deletedAt);

  return (
    <main>
      <header className="page-header">
        <div><p className="eyebrow">INTERNAL WORKSPACE</p><h1>Mini Task Manager</h1><p>Manage tasks and track every change clearly.</p></div>
        <div className="header-actions">
          <span className="count">{active.length} active {active.length === 1 ? "task" : "tasks"}</span>
          <button type="button" className="theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} aria-pressed={theme === "dark"}>
            {theme === "light" ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8a8.5 8.5 0 1 0 11.4 11.4Z" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <section className="toolbar" aria-label="Create task">
        <div className="toolbar-heading">
          <h2>New task</h2>
          <p>Add a task to the board</p>
        </div>
        <form onSubmit={create}>
          <div className="form-row">
            <div className="field-group title-field">
              <label htmlFor="task-title">Task title</label>
              <input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Prepare invoice" required />
            </div>
            <div className="field-group description-field">
              <label htmlFor="task-description">Description</label>
              <input id="task-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="Add context (optional)" />
            </div>
            <div className="actor-control"><label htmlFor="actor">Acting as</label><select id="actor" value={actor} onChange={(event) => setActor(event.target.value)} disabled={busy}>{actors.map((name) => <option key={name}>{name}</option>)}</select></div>
            <button type="submit" disabled={busy || !actor}>Add task</button>
          </div>
        </form>
      </section>

      <p className="board-hint"><span className="desktop-hint">Drag a card to the next column to change its status. </span><span className="mobile-hint">Use the button on a card to change its status. </span>The selected user will appear in its history.</p>

      {error && <p className="error" role="alert">{error} <button type="button" onClick={() => void refresh().catch((cause: Error) => setError(cause.message))}>Try again</button></p>}
      {loading ? <p>Loading tasks...</p> : <section className="board" ref={boardRef} aria-label="Task board">
        {statuses.map((status) => {
          const columnTasks = active.filter((task) => task.status === status);
          const draggingTask = tasks.find((task) => task.id === draggedId);
          const eligible = canDrop(draggingTask, status);
          return <div className={`column ${status}${eligible ? " drop-eligible" : ""}${overStatus === status ? " drop-over" : ""}`} key={status}
            onDragOver={(event) => dragOver(event, status)}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOverStatus(null); }}
            onDrop={(event) => drop(event, status)}>
            <div className="column-heading"><h2>{labels[status]}</h2><span>{columnTasks.length}</span></div>
            <div className="cards">{columnTasks.length ? columnTasks.map((task) => <article className={`card${draggedId === task.id ? " dragging" : ""}`} key={task.id} tabIndex={0}
              draggable={!busy && status !== "done"}
              onClick={(event) => { if (!(event.target as HTMLElement).closest("button")) void openHistory(task); }}
              onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); void openHistory(task); } }}
              onDragStart={(event) => startDrag(event, task)}
              onDrag={(event) => publishCursor(event, task)}
              onDragEnd={endDrag}>
              <h3>{task.title}</h3>
              {task.description && <p className="card-description">{task.description}</p>}
              <p className="card-date">Created {new Date(task.createdAt).toLocaleDateString("en-US")}</p>
              <div className="card-actions">
                <div className="card-secondary-actions">
                  <button type="button" className="text-button" onClick={() => void openHistory(task)}>History</button>
                  <button type="button" className="delete-button" onClick={() => remove(task)} disabled={busy} aria-label={`Delete ${task.title}`}>Delete</button>
                </div>
                {status !== "done" && <button type="button" className="advance-button" onClick={() => advance(task)} disabled={busy} aria-label={`Move to ${labels[statuses[statuses.indexOf(status) + 1]]}`}>
                  {labels[statuses[statuses.indexOf(status) + 1]]} <span aria-hidden="true">→</span>
                </button>}
              </div>
            </article>) : <p className="empty">No tasks yet</p>}</div>
          </div>;
        })}
        {liveCursors.map((cursor) => {
          const task = tasks.find((item) => item.id === cursor.taskId);
          const color = ["#0a8eaa", "#7047bd", "#009f93"][Math.max(0, actors.indexOf(cursor.actor)) % 3];
          return <div className="live-cursor" key={cursor.clientId} style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}>
            <svg width="19" height="23" viewBox="0 0 19 23" aria-hidden="true"><path d="M1 1v18l4.5-4.5 3.5 7 3-1.5-3.5-7H17L1 1Z" fill={color} stroke="white" strokeWidth="1.5" /></svg>
            <span style={{ backgroundColor: color }}>{cursor.actor}{task ? ` · ${task.title}` : " is moving a task"}</span>
          </div>;
        })}
      </section>}

      <section className="archive"><button type="button" className="archive-toggle" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>{showArchived ? "Hide" : "Show"} deleted tasks ({archived.length})</button>
        {showArchived && <div className="archive-list">{archived.length ? archived.map((task) => <div key={task.id}><span>{task.title}</span><button type="button" className="text-button" onClick={() => void openHistory(task)}>View history</button></div>) : <p>No deleted tasks yet.</p>}</div>}
      </section>

      {selected && <div className="overlay" onClick={() => setSelected(null)}><aside className="history" aria-label="Task history" onClick={(event) => event.stopPropagation()}>
        <div className="history-heading"><div><p className="eyebrow">AUDIT LOG</p><h2>{selected.title}</h2><p>{selected.deletedAt ? "Task deleted" : `Status: ${labels[selected.status]}`}</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Close history">×</button></div>
        {!selected.deletedAt && <form className="edit-task" onSubmit={updateDetails}>
          <label htmlFor="edit-title">Task title</label>
          <input id="edit-title" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={120} required />
          <label htmlFor="edit-description">Description</label>
          <textarea id="edit-description" value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={1000} rows={5} placeholder="Add task details..." />
          <button type="submit" disabled={busy || (editTitle.trim() === selected.title && editDescription.trim() === selected.description)}>Save changes</button>
        </form>}
        <ol className="timeline">{logs.map((log) => <li key={log.id}><p><strong>{log.actor}</strong> {describe(log)}</p><time dateTime={log.occurredAt}>{new Date(log.occurredAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</time></li>)}</ol>
      </aside></div>}
    </main>
  );
}
