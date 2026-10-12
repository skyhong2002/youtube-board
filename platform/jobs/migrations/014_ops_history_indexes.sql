-- Bounded operator metadata history. No source tables or stored journal bodies change.
CREATE INDEX IF NOT EXISTS ops_job_history ON ts_job_runs(job_key,updated_at,execution_key);
CREATE INDEX IF NOT EXISTS ops_ai_history ON ts_ai_runs(workflow,updated_at,run_id);
CREATE INDEX IF NOT EXISTS ops_notification_history ON ts_notification_runs(workflow,updated_at,run_id);
CREATE INDEX IF NOT EXISTS ops_vocabulary_history ON ts_vocabulary_runs(created_at,id);
