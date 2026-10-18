-- Row counts per table, plus the latest import run. Paste into the Supabase SQL editor.
select 'cards' as table_name, count(*) from public.cards
union all select 'tags (oracle)', count(*) from public.tags where kind = 'oracle'
union all select 'tags (art)', count(*) from public.tags where kind = 'art'
union all select 'tag_links', count(*) from public.tag_links
union all select 'card_tags', count(*) from public.card_tags
union all select 'illustration_tags', count(*) from public.illustration_tags;

select id, status, started_at, finished_at, counts from public.import_runs order by id desc limit 1;
