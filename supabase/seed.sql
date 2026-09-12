-- Development catalog. Stable codes and IDs; safe to apply repeatedly.
insert into public.languages (id, code, name, native_name, is_active) values
  ('00000000-0000-4000-8000-000000000001', 'en', 'English', 'English', true),
  ('00000000-0000-4000-8000-000000000002', 'fr', 'French', 'Français', true)
-- Existing catalog decisions (including deactivation) belong to administrators.
on conflict (code) do nothing;

-- Development examples, not a production CEFR assessment or licensed catalog.
-- Six photographable concepts per French level; English levels are independent.
with examples(concept_key,category,french,english,french_level,english_level,part_of_speech) as (values
  ('DOG','animals','le chien','dog','A1','A1','noun'),
  ('CAT','animals','le chat','cat','A1','A1','noun'),
  ('APPLE','food','la pomme','apple','A1','A1','noun'),
  ('CHAIR','objects','la chaise','chair','A1','A1','noun'),
  ('BOOK','objects','le livre','book','A1','A1','noun'),
  ('DOOR','buildings','la porte','door','A1','A1','noun'),
  ('WINDOW','buildings','la fenêtre','window','A2','A2','noun'),
  ('BICYCLE','transport','le vélo','bicycle','A2','A2','noun'),
  ('BRIDGE','buildings','le pont','bridge','A2','A2','noun'),
  ('BANK_RIVER','nature','la rive','bank','A2','A2','noun'),
  ('UMBRELLA','objects','le parapluie','umbrella','A2','A2','noun'),
  ('SUITCASE','objects','la valise','suitcase','A2','A2','noun'),
  ('TRAFFIC_JAM','transport','un embouteillage','traffic jam','B1','B1','noun'),
  ('CROSSWALK','transport','le passage piéton','crosswalk','B1','B1','noun'),
  ('BANK_FINANCIAL','buildings','la banque','bank','B1','B1','noun'),
  ('MARKET_STALL','places','un étal','market stall','B1','B1','noun'),
  ('SCAFFOLDING','buildings','un échafaudage','scaffolding','B1','B1','noun'),
  ('RECYCLING_BIN','objects','le bac de recyclage','recycling bin','B1','B1','noun'),
  ('CROWDED','situations','bondé','crowded','B2','B2','adjective'),
  ('ALLEY','places','la ruelle','alley','B2','A2','noun'),
  ('GREENHOUSE','buildings','la serre','greenhouse','B2','B2','noun'),
  ('WIND_TURBINE','energy','une éolienne','wind turbine','B2','B2','noun'),
  ('SOLAR_PANEL','energy','le panneau solaire','solar panel','B2','B2','noun'),
  ('REFLECTION','nature','le reflet','reflection','B2','B2','noun'),
  ('BUTTRESS','architecture','le contrefort','buttress','C1','C1','noun'),
  ('ESTUARY','nature','un estuaire','estuary','C1','C1','noun'),
  ('IRIDESCENCE','nature','une irisation','iridescence','C1','C1','noun'),
  ('TERRACED_FIELD','places','une culture en terrasses','terraced field','C1','C1','noun'),
  ('VIADUCT','architecture','le viaduc','viaduct','C1','C1','noun'),
  ('PATINA','materials','la patine','patina','C1','C1','noun'),
  ('FLYING_BUTTRESS','architecture','un arc-boutant','flying buttress','C2','C2','noun'),
  ('EFFLORESCENCE','materials','une efflorescence','efflorescence','C2','C2','noun'),
  ('SPANDREL','architecture','un écoinçon','spandrel','C2','C2','noun'),
  ('SCREE','nature','un pierrier','scree','C2','C2','noun'),
  ('CARYATID','architecture','une cariatide','caryatid','C2','C2','noun'),
  ('RIME','nature','le givre','rime','C2','C2','noun')
), inserted as (
  insert into public.vocabulary_concepts(concept_key,category,is_photographable)
  select concept_key,category,true from examples on conflict(concept_key) do nothing
  returning id,concept_key
), concepts as (
  select id,concept_key from inserted union all
  select id,concept_key from public.vocabulary_concepts
)
insert into public.vocabulary_terms(concept_id,language_id,term,cefr_level,part_of_speech)
select c.id,l.id,case l.code when 'fr' then e.french else e.english end,
  case l.code when 'fr' then e.french_level else e.english_level end,e.part_of_speech
from examples e join concepts c using(concept_key)
cross join public.languages l where l.code in ('en','fr')
on conflict(concept_id,language_id) do nothing;
