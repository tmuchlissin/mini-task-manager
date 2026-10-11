CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  status text NOT NULL DEFAULT 'to_do' CHECK (status IN ('to_do', 'pending', 'in_progress', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  actor text NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'title_changed', 'details_changed', 'status_changed', 'deleted')),
  from_status text CHECK (from_status IS NULL OR from_status IN ('to_do', 'pending', 'in_progress', 'done')),
  to_status text CHECK (to_status IS NULL OR to_status IN ('to_do', 'pending', 'in_progress', 'done')),
  previous_title text,
  previous_description text,
  task_title text NOT NULL,
  task_description text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (action = 'created' AND from_status IS NULL AND to_status = 'to_do') OR
    (action = 'title_changed' AND from_status IS NULL AND to_status IS NULL AND previous_title IS NOT NULL AND previous_title <> task_title) OR
    (action = 'details_changed' AND from_status IS NULL AND to_status IS NULL AND previous_title IS NOT NULL) OR
    (action = 'status_changed' AND from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status) OR
    (action = 'deleted' AND from_status IS NOT NULL AND to_status IS NULL)
  )
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_description_check;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_description_length_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_description_length_check CHECK (length(description) <= 1000);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_title text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_description text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS task_description text;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_check;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_shape_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check
  CHECK (action IN ('created', 'title_changed', 'details_changed', 'status_changed', 'deleted'));
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_shape_check CHECK (
  (action = 'created' AND from_status IS NULL AND to_status = 'to_do') OR
  (action = 'title_changed' AND from_status IS NULL AND to_status IS NULL AND previous_title IS NOT NULL AND previous_title <> task_title) OR
  (action = 'details_changed' AND from_status IS NULL AND to_status IS NULL AND previous_title IS NOT NULL AND (previous_title <> task_title OR previous_description IS DISTINCT FROM task_description)) OR
  (action = 'status_changed' AND from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status) OR
  (action = 'deleted' AND from_status IS NOT NULL AND to_status IS NULL)
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
