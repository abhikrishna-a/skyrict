/*
 * PostgreSQL restore-drill parity kernel (REL-GATE-001, §4.2).
 *
 * Generated and executed IDENTICALLY against the source server and the PITR
 * scratch server. The output is a deterministic text fingerprint:
 *
 *   SELECT '<table>' || '|' || count(*) FROM public.<table>  (every table)
 *   SELECT 'alembic-identity:' || version_num FROM <identity db>.alembic_version
 *   SELECT 'alembic-core:'    || version_num FROM <core db>.alembic_version
 *   SELECT 'alembic-ai:'      || version_num FROM <ai db>.alembic_version
 *
 * Feed the sorted output to `Get-FileHash -Algorithm SHA256` (PowerShell) or
 * `sha256sum` on both runs; the hashes MUST match. Two fingerprints are taken
 * per drill:
 *   1. At T0 (immediately before `az postgres flexible-server restore
 *      --restore-point-in-time T0`), from the SOURCE server.
 *      Every query in this file must also run at drill time so row counts are
 *      stable between the two snapshots.
 *   2. At comparison time (~T0 + restore wall clock), from the SCRATCH server.
 *
 * Drift handling: if the two SOURCE fingerprints differ between T0 and
 * comparison time, the SCRATCH hash is only comparable if the drift is
 * accounted for (re-run the delta query set against both servers). A mismatch
 * with no source drift == drill FAILURE.
 *
 * Generate the per-table count statements by executing this file's generator
 * block against any live server, e.g.:
 *
 *   SELECT format('SELECT ''%s'' || ''|'' || count(*) FROM public.%I;',
 *                 tablename, tablename)
 *   FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
 *
 * The generator is intentionally kept in this file so the statement set is a
 * reviewable artifact, not an ad-hoc shell pipe.
 */

-- ---------------------------------------------------------------------------
-- 1. Table inventory for the parity statement set (against any live server).
-- ---------------------------------------------------------------------------
SELECT format('SELECT ''%s'' || ''|'' || count(*) FROM public.%I;', tablename, tablename)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ---------------------------------------------------------------------------
-- 2. Alembic head pins (run per database on the target server).
-- ---------------------------------------------------------------------------
-- identity:
SELECT 'alembic-identity:' || version_num FROM alembic_version;
-- core:
SELECT 'alembic-core:' || version_num FROM alembic_version;
-- ai-agent:
SELECT 'alembic-ai:' || version_num FROM alembic_version;

-- ---------------------------------------------------------------------------
-- 3. Structural fingerprint (pg_dump --schema-only is the canonical check;
--    this query is the fast in-SQL equivalent used as a first gate).
-- ---------------------------------------------------------------------------
SELECT 'relation:' || relname || ':' || pg_get_userbyid(relowner) || ':' || relkind
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'v', 'm', 'S', 'p')
ORDER BY relname;