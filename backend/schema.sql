CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'to_do' CHECK (status IN ('to_do', 'pending', 'in_progress', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  actor text NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'status_changed', 'deleted')),
  from_status text CHECK (from_status IS NULL OR from_status IN ('to_do', 'pending', 'in_progress', 'done')),
  to_status text CHECK (to_status IS NULL OR to_status IN ('to_do', 'pending', 'in_progress', 'done')),
  task_title text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (action = 'created' AND from_status IS NULL AND to_status = 'to_do') OR
    (action = 'status_changed' AND from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status) OR
    (action = 'deleted' AND from_status IS NOT NULL AND to_status IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS audit_logs_task_order_idx ON audit_logs(task_id, occurred_at, id);

CREATE OR REPLACE FUNCTION reject_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate
BEFORE TRUNCATE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_mutation();
