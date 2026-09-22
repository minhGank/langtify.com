-- QA3 Explore: indexed catalog search and existing controlled public photo access.
-- Catalog terms remain current; every example retains its immutable capture text.
begin;

create index if not exists vocabulary_terms_explore_search
 on public.vocabulary_terms using gin(to_tsvector('simple'::regconfig,term)) where is_active;
create index if not exists submissions_concept_newest
 on public.submissions(vocabulary_term_id,submitted_at desc,id desc)
 where status='completed' and visibility='public';

create or replace function public.search_vocabulary_terms(
 query text,before_term text default null,before_id uuid default null,page_size integer default 20
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();target uuid;reference uuid;needle text:=btrim(query);tokens text[];search tsquery;result jsonb;
begin
 target:=private.discover_target(viewer);
 select reference_language_id into reference from public.user_language_profiles where user_id=viewer;
 if needle is null or char_length(needle) not between 2 and 64 or page_size is null or page_size not between 1 and 24
  or (before_term is null)<>(before_id is null) then
  raise exception using errcode='22023',message='invalid_vocabulary_search';
 end if;
 -- Parse input as text, then quote each lexeme. User-supplied tsquery operators,
 -- SQL wildcards and punctuation cannot broaden the search or alter its syntax.
 tokens:=tsvector_to_array(to_tsvector('simple'::regconfig,needle));
 if cardinality(tokens) not between 1 and 8 then
  raise exception using errcode='22023',message='invalid_vocabulary_search';
 end if;
 select string_agg(quote_literal(token)||':*',' & ')::tsquery into search from unnest(tokens) token;
 with page as materialized (
  select t.concept_id,t.term as target_term,r.term as reference_term,t.cefr_level
  from public.vocabulary_terms t
  join public.vocabulary_concepts c on c.id=t.concept_id and c.is_active and c.is_photographable
  join public.vocabulary_terms r on r.concept_id=t.concept_id and r.language_id=reference and r.is_active
  join public.languages tl on tl.id=t.language_id and tl.is_active
  join public.languages rl on rl.id=r.language_id and rl.is_active
  where t.language_id=target and t.is_active and to_tsvector('simple'::regconfig,t.term)@@search
   and (t.term collate "C",t.concept_id)>(coalesce(before_term,'') collate "C",coalesce(before_id,'00000000-0000-0000-0000-000000000000'::uuid))
  order by t.term collate "C",t.concept_id limit page_size+1
 ),shown as(select * from page order by target_term collate "C",concept_id limit page_size)
 select jsonb_build_object('viewer_id',viewer,'target_language_id',target,'reference_language_id',reference,
  'items',coalesce((select jsonb_agg(to_jsonb(s) order by target_term collate "C",concept_id) from shown s),'[]'::jsonb),
  'has_more',(select count(*)>page_size from page)) into result;
 return result;
end;$$;

create or replace function public.get_explore_concept(concept_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();target uuid;reference uuid;item jsonb;
begin
 target:=private.discover_target(viewer);
 select reference_language_id into reference from public.user_language_profiles where user_id=viewer;
 if concept_id is null then raise exception using errcode='22023',message='invalid_explore_concept';end if;
 select jsonb_build_object('concept_id',t.concept_id,'target_term',t.term,'reference_term',r.term,'cefr_level',t.cefr_level) into item
 from public.vocabulary_terms t
 join public.vocabulary_concepts c on c.id=t.concept_id and c.is_active and c.is_photographable
 join public.vocabulary_terms r on r.concept_id=t.concept_id and r.language_id=reference and r.is_active
 join public.languages tl on tl.id=t.language_id and tl.is_active
 join public.languages rl on rl.id=r.language_id and rl.is_active
 where t.concept_id=get_explore_concept.concept_id and t.language_id=target and t.is_active;
 return jsonb_build_object('viewer_id',viewer,'target_language_id',target,'reference_language_id',reference,'item',item);
end;$$;

create or replace function public.get_concept_submissions(
 concept_id uuid,before_time timestamptz default null,before_id uuid default null,page_size integer default 20
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();target uuid;term_id uuid;result jsonb;
begin
 target:=private.discover_target(viewer);
 if concept_id is null or page_size is null or page_size not between 1 and 24
  or (before_time is null)<>(before_id is null)
  or (before_time is not null and not isfinite(before_time)) then
  raise exception using errcode='22023',message='invalid_concept_feed_query';
 end if;
 -- One immutable term identity per concept/language lets the public partial index
 -- seek directly into that concept's newest submissions, even under generic plans.
 select id into term_id from public.vocabulary_terms t where t.concept_id=get_concept_submissions.concept_id and t.language_id=target;
 with page as materialized (
  select c.id,c.target_term,c.reference_term,c.cefr_level,c.username,c.submitted_at
  from public.submissions source
  join lateral (
   select eligible.id,eligible.target_term,eligible.reference_term,eligible.cefr_level,eligible.username,eligible.submitted_at
   from private.discover_candidates eligible where eligible.id=source.id and eligible.target_language_id=target
    and not private.users_blocked(viewer,eligible.owner_id)
   -- Keep eligibility correlated with the indexed source seek. Without this
   -- boundary a generic plan may start with unrelated global feed candidates.
   offset 0
  ) c on true
  where source.vocabulary_term_id=term_id and source.status='completed' and source.visibility='public'
   and (source.submitted_at,source.id)<(coalesce(before_time,'infinity'::timestamptz),coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by source.submitted_at desc,source.id desc limit page_size+1
 ),shown as materialized(select * from page order by submitted_at desc,id desc limit page_size),
 stats as(select * from private.discover_rating_stats(viewer,coalesce((select array_agg(id) from shown),array[]::uuid[])))
 select jsonb_build_object('viewer_id',viewer,'target_language_id',target,
  'items',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object(
   'average_rating',t.average_rating,'rating_count',t.rating_count,'viewer_rating',t.viewer_rating,'can_rate',t.can_rate)
   order by s.submitted_at desc,s.id desc) from shown s join stats t using(id)),'[]'::jsonb),
  'has_more',(select count(*)>page_size from page)) into result;
 return result;
end;$$;

create or replace function public.get_discover_submission(submission_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();target uuid;result jsonb;
begin
 target:=private.discover_target(viewer);
 if submission_id is null then raise exception using errcode='22023',message='invalid_feed_query';end if;
 with shown as materialized (
  select c.id,c.target_term,c.reference_term,c.cefr_level,c.username,c.submitted_at
  from private.discover_candidates c where c.id=submission_id and c.target_language_id=target
   and not private.users_blocked(viewer,c.owner_id)
 ),stats as(select * from private.discover_rating_stats(viewer,coalesce((select array_agg(id) from shown),array[]::uuid[])))
 select jsonb_build_object('viewer_id',viewer,'target_language_id',target,
  'items',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object(
   'average_rating',t.average_rating,'rating_count',t.rating_count,'viewer_rating',t.viewer_rating,'can_rate',t.can_rate))
   from shown s join stats t using(id)),'[]'::jsonb),'has_more',false) into result;
 return result;
end;$$;

create or replace function public.search_public_profiles(prefix text,after_username text default null,after_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();needle text:=lower(btrim(prefix));result jsonb;
begin
 perform private.discover_target(viewer);
 if needle is null or char_length(needle) not between 2 and 30 or needle !~ '^[a-z0-9][a-z0-9_]*$'
  or (after_username is null)<>(after_id is null)
  or (after_username is not null and after_username !~ '^[a-z0-9][a-z0-9_]{2,29}$') then
  raise exception using errcode='22023',message='invalid_user_search';
 end if;
 -- Literal C-collation range remains an index condition under generic plans;
 -- '_' is a literal username character, never a LIKE wildcard.
 with page as materialized (
  select p.public_id as id,p.username,private.current_avatar_id(p.id) as avatar_id,p.id=viewer as is_self,
   exists(select 1 from public.user_follows f where f.follower_user_id=viewer and f.followed_user_id=p.id) as is_following from public.profiles p
  where p.username is not null and p.onboarding_completed_at is not null
   and p.username collate "C">=needle collate "C" and p.username collate "C"<(needle||'{') collate "C"
   and (p.username collate "C",p.public_id)>(coalesce(after_username,'') collate "C",coalesce(after_id,'00000000-0000-0000-0000-000000000000'::uuid))
   and private.social_profile_visible(viewer,p.id)
  order by p.username collate "C",p.public_id limit 21
 ),shown as(select * from page order by username collate "C",id limit 20)
 select jsonb_build_object('viewer_id',viewer,'items',coalesce((select jsonb_agg(to_jsonb(s) order by username collate "C",id) from shown s),'[]'::jsonb),'has_more',(select count(*)>20 from page)) into result;
 return result;
end;$$;


revoke all on function public.search_vocabulary_terms(text,text,uuid,integer),public.get_explore_concept(uuid),public.get_concept_submissions(uuid,timestamptz,uuid,integer),public.get_discover_submission(uuid),public.search_public_profiles(text,text,uuid) from public,anon;
grant execute on function public.search_vocabulary_terms(text,text,uuid,integer),public.get_explore_concept(uuid),public.get_concept_submissions(uuid,timestamptz,uuid,integer),public.get_discover_submission(uuid),public.search_public_profiles(text,text,uuid) to authenticated;

commit;
