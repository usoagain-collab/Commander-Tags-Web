-- Speed: card_tags_for took about 400 ms per deck although its two queries take under 10 ms. As a plain SQL
-- function with an array slice in the filter it got a slow generic plan. Same output, now plpgsql with the ids
-- joined from a de-duplicated unnest, which plans as index lookups (the fix suggestion_pool needed in 0012).
-- Note for the migration runner: keep comments free of quote characters.

create or replace function public.card_tags_for(oracle_ids uuid[])
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  result jsonb;
begin
  with ids as (
    select distinct u.id from unnest(oracle_ids[1:400]) as u(id)
  )
  select jsonb_build_object(
    'o', coalesce((
      select jsonb_object_agg(oracle_id, slugs)
      from (
        select ct.oracle_id, jsonb_agg(t.slug order by t.slug) as slugs
        from ids
        join public.card_tags ct on ct.oracle_id = ids.id
        join public.tags t on t.id = ct.tag_id
        group by ct.oracle_id
      ) x
    ), '{}'::jsonb),
    'a', coalesce((
      select jsonb_object_agg(oracle_id, tags)
      from (
        select c.oracle_id, jsonb_agg(jsonb_build_array(t.slug, t.label, t.size) order by t.size, t.slug) as tags
        from ids
        join public.cards c on c.oracle_id = ids.id
        join public.illustration_tags it on it.illustration_id = c.default_illustration_id
        join public.tags t on t.id = it.tag_id
        group by c.oracle_id
      ) y
    ), '{}'::jsonb)
  ) into result;
  return result;
end;
$$;
grant execute on function public.card_tags_for(uuid[]) to anon, authenticated;
