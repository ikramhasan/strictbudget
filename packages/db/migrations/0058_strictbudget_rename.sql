-- The product was renamed from everycent to strictbudget. Each everycent_* function is recreated
-- as strictbudget_* (its body reading the strictbudget.* settings and calling the renamed
-- functions), every trigger is recreated against it, and the old functions are dropped.
DO $$
DECLARE
  f record;
  t record;
BEGIN
  FOR f IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname LIKE 'everycent\_%'
  LOOP
    EXECUTE replace(pg_get_functiondef(f.oid), 'everycent', 'strictbudget');
  END LOOP;

  FOR t IN
    SELECT tg.oid, tg.tgname, tg.tgrelid::regclass AS rel
    FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE NOT tg.tgisinternal AND p.proname LIKE 'everycent\_%'
  LOOP
    EXECUTE replace(pg_get_triggerdef(t.oid), 'everycent', 'strictbudget');
    EXECUTE format('DROP TRIGGER %I ON %s', t.tgname, t.rel);
  END LOOP;

  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname LIKE 'everycent\_%'
  LOOP
    EXECUTE format('DROP FUNCTION %s', f.sig);
  END LOOP;
END $$;
--> statement-breakpoint
UPDATE oauth_client SET scopes = array_replace(array_replace(scopes,
  'everycent:read', 'strictbudget:read'), 'everycent:write', 'strictbudget:write')
WHERE scopes && ARRAY['everycent:read', 'everycent:write'];
--> statement-breakpoint
UPDATE oauth_consent SET scopes = array_replace(array_replace(scopes,
  'everycent:read', 'strictbudget:read'), 'everycent:write', 'strictbudget:write')
WHERE scopes && ARRAY['everycent:read', 'everycent:write'];
--> statement-breakpoint
UPDATE oauth_refresh_token SET scopes = array_replace(array_replace(scopes,
  'everycent:read', 'strictbudget:read'), 'everycent:write', 'strictbudget:write')
WHERE scopes && ARRAY['everycent:read', 'everycent:write'];
--> statement-breakpoint
UPDATE oauth_access_token SET scopes = array_replace(array_replace(scopes,
  'everycent:read', 'strictbudget:read'), 'everycent:write', 'strictbudget:write')
WHERE scopes && ARRAY['everycent:read', 'everycent:write'];
--> statement-breakpoint
UPDATE ai_chat_thread
SET messages = replace(messages::text, 'everycent-attachment:', 'strictbudget-attachment:')::jsonb
WHERE messages::text LIKE '%everycent-attachment:%';
--> statement-breakpoint
UPDATE oauth_resource SET allowed_scopes = array_replace(array_replace(allowed_scopes,
  'everycent:read', 'strictbudget:read'), 'everycent:write', 'strictbudget:write')
WHERE allowed_scopes && ARRAY['everycent:read', 'everycent:write'];
--> statement-breakpoint
UPDATE budget SET import_source = regexp_replace(import_source, '^ynab(-files)?:', 'external\1:')
WHERE import_source ~ '^ynab(-files)?:';
