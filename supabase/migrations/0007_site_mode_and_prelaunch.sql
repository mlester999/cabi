begin;

-- Public launch state for the Cabi application.
--
-- Precedence is: SITE_MODE / NEXT_PUBLIC_SITE_MODE environment override, then
-- this row, then the built-in LIVE default. The owner changes this row
-- from /admin/settings, so PRELAUNCH -> LIVE needs no redeploy.
--
-- The product opens directly into Cabi. Prelaunch and maintenance remain
-- explicit owner-controlled modes rather than an accidental deployment default.
insert into public.app_settings (key, value_json) values
  ('site_mode', '{"mode":"LIVE"}'::jsonb)
on conflict (key) do nothing;

-- Owner-editable copy and switches for the public prelaunch page. Every value
-- has a safe in-code default, so an empty row still renders a finished page
-- without inventing a contract address, price, or release date.
insert into public.app_settings (key, value_json) values
  ('prelaunch_config', '{
    "headline": "Cabi is getting ready.",
    "subheadline": "Your Cat Partner Unit is still working on the tech.",
    "description": "Soon you''ll be able to talk with Cabi, build your friendship, save your memories, connect your wallet, and learn about Clank.trade and $CPU.",
    "statusLabel": "CABI SYSTEM",
    "announcement": "",
    "xUrl": "",
    "communityUrl": "",
    "showSocial": true,
    "showCpu": true,
    "cpuStatus": "PRELAUNCH",
    "featureChips": ["Chat", "Memory", "Wallet", "Clank.trade"]
  }'::jsonb)
on conflict (key) do nothing;

-- Guard both rows against a malformed write from any service caller. These
-- checks stay strictly looser than the Zod schema in the admin route; they only
-- block values that would make the public page render something untrue.
alter table public.app_settings
  drop constraint if exists app_settings_site_mode_shape;

alter table public.app_settings
  add constraint app_settings_site_mode_shape check (
    key <> 'site_mode'
    or (
      jsonb_typeof(value_json) = 'object'
      and value_json ? 'mode'
      and value_json->>'mode' in ('PRELAUNCH', 'LIVE', 'MAINTENANCE')
    ) is true
  );

alter table public.app_settings
  drop constraint if exists app_settings_prelaunch_shape;

alter table public.app_settings
  add constraint app_settings_prelaunch_shape check (
    key <> 'prelaunch_config'
    or ((
      jsonb_typeof(value_json) = 'object'
      and value_json ?& array['headline','subheadline','description','statusLabel','showCpu','showSocial','cpuStatus','featureChips']
      and jsonb_typeof(value_json->'featureChips') = 'array'
      and value_json->>'cpuStatus' in ('PRELAUNCH', 'LIVE')
      and jsonb_typeof(value_json->'showCpu') = 'boolean'
      and jsonb_typeof(value_json->'showSocial') = 'boolean'
    ) is true)
  );

commit;
