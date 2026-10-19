-- Phase 3d: Broad mode needs each tag's parents. The oracle tree ships whole (oracle_tag_tree, ~4,600 tags);
-- the art tree is bigger (~11,600 tags, ~20k links), so the editor asks only for the art tags its deck uses
-- plus everything above them.
-- Returns [[slug, label, size, [parent slugs]], ...] for the given art tags and all their ancestors.

create or replace function public.art_tag_ancestry(slugs text[])
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with recursive up(id) as (
    select t.id from public.tags t where t.kind = 'art' and t.slug = any(slugs[1:2000])
    union
    select l.parent_id from public.tag_links l join up on l.child_id = up.id
  )
  select coalesce(jsonb_agg(jsonb_build_array(
           t.slug, t.label, t.size,
           coalesce((select jsonb_agg(p.slug) from public.tag_links l join public.tags p on p.id = l.parent_id
                     where l.child_id = t.id), '[]'::jsonb))), '[]'::jsonb)
  from up join public.tags t on t.id = up.id;
$$;
grant execute on function public.art_tag_ancestry(text[]) to anon, authenticated;
