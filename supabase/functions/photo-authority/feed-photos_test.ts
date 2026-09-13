import { projectFeedPhotos } from './feed-photos.ts';

const target = {
  id: '77000000-0000-4000-8000-000000000001',
  storage_path: '77000000-0000-4000-8000-000000000002/77000000-0000-4000-8000-000000000001.jpg',
  target_term: 'le chien',
  reference_term: 'dog',
  cefr_level: 'A1',
  username: 'learner',
  submitted_at: '2026-09-13T12:00:00.123456Z',
};
const signed = {
  path: target.storage_path,
  signedUrl: `https://api.test/storage/v1/object/sign/challenge-submissions/${target.storage_path}?token=a.b.c`,
};
Deno.test(
  'signing a mixed-success batch fails for retry instead of silently skipping an eligible card',
  () => {
    const second = { ...target, id: 'another', storage_path: 'other/path.jpg' };
    for (const rows of [
      [signed],
      [signed, { path: second.storage_path, error: 'temporary failure' }],
      [signed, { path: second.storage_path, signedUrl: '' }],
    ]) {
      let failed = false;
      try {
        projectFeedPhotos([target, second], rows);
      } catch {
        failed = true;
      }
      if (!failed)
        throw new Error('Eligible card was silently omitted instead of failing for retry.');
    }
  },
);
Deno.test(
  'signed feed projection emits only public display fields and the matching capability',
  () => {
    const result = projectFeedPhotos([target], [signed])[0];
    const expected = [
      'id',
      'target_term',
      'reference_term',
      'cefr_level',
      'username',
      'submitted_at',
      'signed_path',
    ].sort();
    if (JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(expected))
      throw new Error('Private projection leak.');
    if (result.signed_path !== new URL(signed.signedUrl).pathname + '?token=a.b.c')
      throw new Error('Incorrect signed capability.');
    if (projectFeedPhotos([], []).length)
      throw new Error('An empty eligible batch must stay empty.');
  },
);
