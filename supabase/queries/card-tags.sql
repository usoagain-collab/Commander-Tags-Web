-- Every oracle tag on one card. Change the name to look up another card.
select t.slug, t.label, ct.weight, t.size as cards_with_tag
from public.cards c
join public.card_tags ct on ct.oracle_id = c.oracle_id
join public.tags t on t.id = ct.tag_id
where lower(c.name) = lower('Sol Ring')
order by t.size;
