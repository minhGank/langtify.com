begin;

-- Read projection only: verified submission transitions remain the sole completion authority.
create index if not exists submissions_vocabulary_history
  on public.submissions(user_id,concept_id,submitted_at desc,id desc)
  where status='completed';

create or replace function public.get_my_vocabulary(
  requested_concept uuid default null,
  search_text text default '',
  requested_level text default null,
  before_time timestamptz default null,
  before_id uuid default null,
  page_size integer default 12
) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if page_size is null or page_size not between 1 and 24
    or length(coalesce(search_text,''))>100
    or (requested_level is not null and requested_level not in ('A1','A2','B1','B2','C1','C2'))
    or (before_time is null)<>(before_id is null)
    or (before_time is not null and not isfinite(before_time)) then
    raise exception using errcode='22023',message='invalid_history_query';
  end if;
  with captures as materialized (
    select s.id,s.concept_id,s.daily_challenge_word_id as assignment_id,
      s.target_term,s.reference_term,w.cefr_level,s.submitted_at,s.visibility,
      w.target_language_id,w.reference_language_id
    from public.submissions s join public.daily_challenge_words w on w.id=s.daily_challenge_word_id
    where s.user_id=(select auth.uid()) and s.status='completed'
      and (requested_concept is null or s.concept_id=requested_concept)
  ), ranked as (
    select *,count(*) over(partition by concept_id) as capture_count,
      row_number() over(partition by concept_id order by submitted_at desc,id desc) as rank
    from captures
  ), concepts as materialized (
    select * from ranked where rank=1
  ), candidates as (
    select * from ranked r where (requested_concept is not null or rank=1)
      and (requested_level is null or r.cefr_level=requested_level)
      -- Literal substring search: '%' and '_' are not wildcard authority.
      and (strpos(lower(r.target_term),lower(btrim(coalesce(search_text,''))))>0
        or strpos(lower(r.reference_term),lower(btrim(coalesce(search_text,''))))>0)
  ), page as materialized (
    select * from candidates where before_time is null or (submitted_at,id)<(before_time,before_id)
    order by submitted_at desc,id desc limit page_size+1
  ), shown as (
    select * from page order by submitted_at desc,id desc limit page_size
  )
  select jsonb_build_object(
    'user_id',auth.uid(),
    'total_concepts',(select count(*) from concepts),
    'concept', (select to_jsonb(c)-'rank' from concepts c order by submitted_at desc,id desc limit 1),
    'items',coalesce((select jsonb_agg(to_jsonb(s)-'rank' order by submitted_at desc,id desc) from shown s),'[]'::jsonb),
    'has_more',(select count(*)>page_size from page)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_my_vocabulary(uuid,text,text,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_my_vocabulary(uuid,text,text,timestamptz,uuid,integer) to authenticated;
commit;
