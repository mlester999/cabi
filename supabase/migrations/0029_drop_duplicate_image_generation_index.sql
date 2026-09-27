begin;

-- The retained quota index has the same keys and predicate; remove the
-- duplicate created by the historical allowance migration.
drop index if exists public.image_generations_allowance_idx;

commit;
