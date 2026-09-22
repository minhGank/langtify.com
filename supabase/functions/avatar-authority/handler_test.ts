import { handleAvatar, type AvatarAuthority, validateAvatar } from './handler.ts';
import { stripJpegMetadata } from '../../../src/features/photos/jpeg.ts';
import jpeg from 'jpeg-js';

const viewer = 'a9000000-0000-4000-8000-000000000001';
const id = 'a9000000-0000-4000-8000-000000000002';
const photo = stripJpegMetadata(
  await Deno.readFile(new URL('../../../tests/fixtures/photo.jpg', import.meta.url)),
);
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function request(body: unknown, token = 'verified-token') {
  return new Request('https://example.test/avatar-authority', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}
function api(overrides: Partial<AvatarAuthority> = {}): AvatarAuthority {
  return {
    authenticate: () => Promise.resolve(viewer),
    targets: () => Promise.resolve([{ id, storage_path: `${id}.jpg` }]),
    sign: () =>
      Promise.resolve([
        {
          path: `${id}.jpg`,
          signedUrl: `https://example.test/storage/v1/object/sign/profile-avatars/${id}.jpg?token=capability`,
        },
      ]),
    verification: () =>
      Promise.resolve({
        id,
        status: 'pending',
        storage_path: `${id}.jpg`,
        object_id: id,
        object_version: 'v1',
      }),
    download: () => Promise.resolve(new Blob([Uint8Array.from(photo).buffer])),
    activate: (user, target) => Promise.resolve({ viewer_id: user, avatar_id: target.id }),
    ...overrides,
  };
}
Deno.test(
  'avatar request verifies identity and ignores spoofed paths, user IDs and TTLs',
  async () => {
    let seen = '';
    const response = await handleAvatar(
      request({ action: 'previews', avatarIds: [id], viewer: id, path: 'secret', ttl: 999999 }),
      api({
        targets: (user) => {
          seen = user;
          return Promise.resolve([]);
        },
        sign: () => {
          throw new Error('Empty eligibility must not sign');
        },
      }),
    );
    assert(response.status === 200 && seen === viewer, 'Verified viewer required');
    assert((await response.json()).items.length === 0, 'Unauthorized targets omitted');
    assert(
      (await handleAvatar(request({}), api({ authenticate: () => Promise.resolve(null) })))
        .status === 401,
      'Invalid Auth must fail',
    );
  },
);
Deno.test(
  'avatar signer bounds distinct IDs and fails closed on partial signing failure',
  async () => {
    for (const avatarIds of [[], [id, id.toUpperCase()], new Array(25).fill(id), ['../secret']]) {
      assert(
        (await handleAvatar(request({ action: 'previews', avatarIds }), api())).status === 400,
        'Invalid batch admitted',
      );
    }
    const response = await handleAvatar(
      request({ action: 'previews', avatarIds: [id] }),
      api({ sign: () => Promise.resolve([]) }),
    );
    assert(response.status !== 200, 'Signing failure must not masquerade as eligibility omission');
  },
);
Deno.test(
  'avatar verification decodes real bytes and denies metadata and oversized images',
  async () => {
    assert(validateAvatar(photo).width === 16, 'Real fixture should decode');
    for (const invalid of [
      new Uint8Array(1048577),
      new Uint8Array([255, 216, 255, 217]),
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      new Uint8Array([...photo, 71, 80, 83]),
      new Uint8Array([...photo.slice(0, 2), 255, 225, 0, 6, 71, 80, 83, 0, ...photo.slice(2)]),
      stripJpegMetadata(
        jpeg.encode({ data: new Uint8Array(513 * 4), width: 513, height: 1 }, 70).data,
      ),
    ]) {
      let activated = false;
      const response = await handleAvatar(
        request({ action: 'finalize', avatarId: id }),
        api({
          download: () => Promise.resolve(new Blob([Uint8Array.from(invalid).buffer])),
          activate: () => {
            activated = true;
            return Promise.resolve({});
          },
        }),
      );
      assert(response.status === 422 && !activated, 'Invalid bytes must never activate');
    }
  },
);
Deno.test(
  'avatar input bounds reject malformed bodies before accessing privileged storage',
  async () => {
    let calls = 0;
    const authority = api({
      targets: () => {
        calls++;
        return Promise.resolve([]);
      },
      verification: () => {
        calls++;
        return Promise.resolve(null);
      },
    });
    for (const body of [
      JSON.stringify({ action: 'previews', avatarIds: [id], excess: 'x'.repeat(2048) }),
      '[null]',
      '{"action":',
      'null',
    ]) {
      const response = await handleAvatar(
        new Request('https://example.test/avatar-authority', {
          method: 'POST',
          headers: { Authorization: 'Bearer verified-token' },
          body,
        }),
        authority,
      );
      assert(response.status === 400, 'Malformed or oversized body must fail closed');
    }
    assert(calls === 0, 'Invalid requests must never reach service storage authority');
  },
);
Deno.test('avatar failures never disclose privileged error messages or object paths', async () => {
  const response = await handleAvatar(
    request({ action: 'previews', avatarIds: [id] }),
    api({
      targets: () => {
        throw new Error('service-role-token private-object-path');
      },
    }),
  );
  assert(response.status !== 200, 'An authority error must fail closed');
  assert(
    JSON.stringify(await response.json()) === '{"error":"avatar_request_failed"}',
    'Privileged error text must never reach the client',
  );
  assert(response.headers.get('Cache-Control') === 'no-store', 'Responses must not be cached');
});
Deno.test(
  'verified finalize sends exact version attestation and current retries avoid duplicate work',
  async () => {
    let calls = 0;
    const response = await handleAvatar(
      request({ action: 'finalize', avatarId: id }),
      api({
        activate: (user, target, proof) => {
          assert(
            user === viewer &&
              target.object_version === 'v1' &&
              proof.sha256.length === 64 &&
              proof.width === 16,
            'Attestation is version-bound',
          );
          calls++;
          return Promise.resolve({ viewer_id: viewer, avatar_id: id });
        },
      }),
    );
    assert(response.status === 200 && calls === 1, 'Expected one activation');
    const retry = await handleAvatar(
      request({ action: 'finalize', avatarId: id }),
      api({
        verification: () =>
          Promise.resolve({
            id,
            status: 'current',
            storage_path: `${id}.jpg`,
            object_id: id,
            object_version: 'v1',
          }),
        download: () => {
          throw new Error('Should not download committed retry');
        },
      }),
    );
    assert(retry.status === 200, 'Committed retry returns current result');
  },
);
