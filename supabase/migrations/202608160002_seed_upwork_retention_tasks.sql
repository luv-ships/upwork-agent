-- Keep enum creation and first use in separate committed migrations. PostgreSQL
-- does not permit a freshly added enum value to be used before its transaction
-- commits.

insert into public.workflow_tasks (
  workspace_id,
  kind,
  payload,
  dedupe_key,
  priority,
  run_at,
  max_attempts
)
select
  connection.workspace_id,
  'purge-upwork-data'::public.workflow_task_kind,
  jsonb_build_object(
    'connectionId', connection.id,
    'scheduleVersion', connection.purge_schedule_version,
    'runSequence', connection.next_purge_sequence
  ),
  concat(
    'purge-upwork-data:',
    connection.workspace_id,
    ':',
    connection.id,
    ':',
    connection.purge_schedule_version,
    ':',
    connection.next_purge_sequence
  ),
  100,
  connection.next_purge_at,
  10
from public.upwork_connections as connection
on conflict (kind, dedupe_key) do nothing;
