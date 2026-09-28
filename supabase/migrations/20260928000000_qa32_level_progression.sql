-- QA #32 changes only the read-time mapping from signed total XP to level.
-- No ledger, award, completion, milestone or notification history is rewritten.
begin;

create or replace function private.level_progress(total_xp bigint) returns jsonb
language plpgsql stable set search_path='' as $$
declare level_number integer; level_start numeric; next_start numeric;
begin
  if total_xp is null or total_xp<0 then raise exception 'invalid_xp_total'; end if;
  -- T(L) = 10 * (L - 1) * (L + 2), L >= 1. The inverse is an estimate;
  -- exact numeric comparisons handle sqrt rounding at very large boundaries.
  level_number:=greatest(1,floor((sqrt(9+4*total_xp::numeric/10)-1)/2)::integer);
  while 10::numeric*(level_number-1)*(level_number+2)>total_xp loop
    level_number:=level_number-1;
  end loop;
  while 10::numeric*level_number*(level_number+3)<=total_xp loop
    level_number:=level_number+1;
  end loop;
  -- Numeric products also keep the next threshold exact beyond bigint max.
  level_start:=10::numeric*(level_number-1)*(level_number+2);
  next_start:=10::numeric*level_number*(level_number+3);
  return jsonb_build_object('level',level_number,'level_start_xp',level_start,'next_level_xp',next_start,
    'xp_into_level',total_xp-level_start,'xp_for_next_level',next_start-level_start);
end;
$$;
revoke all on function private.level_progress(bigint) from public,anon,authenticated;
comment on function private.level_progress(bigint) is
  'QA32: Level 1 at 0 XP; threshold(L)=10*(L-1)*(L+2). Read-only signed-XP mapping; no reward writes.';

commit;
