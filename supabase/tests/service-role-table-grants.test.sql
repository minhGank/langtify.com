begin;
select plan(324);
create temporary table expected_service_tables(name text primary key);
insert into expected_service_tables values
 ('daily_challenge_words'),
 ('daily_challenges'),
 ('languages'),
 ('profiles'),
 ('submissions'),
 ('user_language_profiles'),
 ('vocabulary_concepts'),
 ('vocabulary_terms'),
 ('xp_events');

-- Includes the existing non-CRUD privileges: the migration must not revoke them.
-- Ordinary clients retain SELECT-only table access (authenticated) or no access.
select is(
 has_table_privilege(r.role, ('public.' || t.name)::regclass, p.privilege),
 r.role = 'service_role' or (r.role = 'authenticated' and p.privilege = 'SELECT'),
 t.name || ': ' || r.role || ' table ' || p.privilege
)
from expected_service_tables t
cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
 ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(privilege)
order by t.name, r.role, p.privilege;

-- Test every live column, including the existing narrowly granted client writes.
-- DELETE is a table permission, not a PostgreSQL column permission.
select ok(
 count(*) > 0 and bool_and(
  has_column_privilege(r.role, c.oid, a.attnum, p.privilege) = (
   r.role = 'service_role' or
   (r.role = 'authenticated' and (
    p.privilege = 'SELECT' or
    (p.privilege = 'UPDATE' and t.name = 'profiles' and a.attname = 'username') or
    (t.name = 'user_language_profiles' and (
     (p.privilege = 'INSERT' and a.attname in
      ('user_id','reference_language_id','target_language_id','cefr_level','timezone')) or
     (p.privilege = 'UPDATE' and a.attname in
      ('reference_language_id','target_language_id','cefr_level','timezone'))
    ))
   ))
  )
 ),
 t.name || ': ' || r.role || ' effective column ' || p.privilege
)
from expected_service_tables t
join pg_class c on c.oid = ('public.' || t.name)::regclass
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(privilege)
group by t.name, r.role, p.privilege
order by t.name, r.role, p.privilege;
select * from finish();
rollback;
