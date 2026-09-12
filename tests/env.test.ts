import { validatePublicConfig } from '@/lib/env';
it('requires both public configuration values', () => {
  expect(validatePublicConfig().config).toBeNull();
  expect(validatePublicConfig('https://example.supabase.co', '').config).toBeNull();
});
it('accepts publishable and legacy anon keys', () => {
  expect(
    validatePublicConfig('https://example.supabase.co', 'sb_publishable_test').config,
  ).not.toBeNull();
  const key = `header.${btoa(JSON.stringify({ role: 'anon' })).replace(/=+$/, '')}.signature`;
  expect(validatePublicConfig('http://localhost:54321', key).config).not.toBeNull();
});
it('rejects secret and service-role keys and invalid URLs', () => {
  const key = `header.${btoa(JSON.stringify({ role: 'service_role' })).replace(/=+$/, '')}.signature`;
  expect(validatePublicConfig('https://example.supabase.co', key).config).toBeNull();
  expect(validatePublicConfig('https://example.supabase.co', 'sb_secret_test').config).toBeNull();
  expect(validatePublicConfig('file:///tmp/database', 'sb_publishable_test').config).toBeNull();
});

it.each([
  'http://project.supabase.co',
  'http://10.attacker.example',
  'http://192.168.attacker.example',
  'http://127.0.0.1.attacker.example',
  'http://172.16.attacker.example',
  'https://user:password@example.com',
  'https://example.com?token=secret',
  'https://example.com#secret',
])('rejects unsafe URL %s', (url) => {
  expect(validatePublicConfig(url, 'sb_publishable_test').config).toBeNull();
});
it.each([
  'http://localhost:54321',
  'http://127.0.0.1:54321',
  'http://192.168.1.10:54321',
  'http://10.0.0.10:54321',
  'http://172.16.0.10:54321',
  'http://[::1]:54321',
])('retains local development URL %s', (url) => {
  expect(validatePublicConfig(url, 'sb_publishable_test').config).not.toBeNull();
});
