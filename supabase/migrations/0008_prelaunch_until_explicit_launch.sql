begin;

-- 0007 originally seeded LIVE before the public launch decision was meant to
-- be explicit. Move that old implicit default back behind the prelaunch gate.
-- A future owner can still launch normally from /admin/settings, which writes
-- an explicit LIVE value after this migration has run.
update public.app_settings
set value_json = jsonb_set(value_json, '{mode}', '"PRELAUNCH"'::jsonb),
    updated_at = now()
where key = 'site_mode'
  and value_json->>'mode' = 'LIVE';

commit;
