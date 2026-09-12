// @ts-check
// Shared with Expo's Node-side config: plain JS avoids an extra TS config loader.
/** @typedef {{ url: string, key: string }} PublicConfig */
/** @typedef {{ config: PublicConfig, error: null } | { config: null, error: string }} ConfigResult */

/** @param {string} hostname */
function isLocalHost(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const octets = hostname.split('.');
  if (
    octets.length !== 4 ||
    !octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  ) {
    return false;
  }
  const [first, second] = octets.map(Number);
  return (
    first === 127 ||
    first === 10 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31)
  );
}

/**
 * Checks configuration, not JWT authenticity; Supabase verifies every credential.
 * @param {string | undefined} [url]
 * @param {string | undefined} [key]
 * @returns {ConfigResult}
 */
function validatePublicConfig(url, key) {
  const error = 'Langtify is not configured yet. Please contact the app developer.';
  if (!url?.trim() || !key?.trim()) return { config: null, error };
  try {
    const parsed = new URL(url.trim());
    if (
      (parsed.protocol !== 'https:' &&
        !(parsed.protocol === 'http:' && isLocalHost(parsed.hostname))) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return { config: null, error };
    }
    const cleanKey = key.trim();
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(cleanKey)) {
      const parts = cleanKey.split('.');
      if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
        return { config: null, error };
      }
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      /** @type {unknown} */
      const decoded = JSON.parse(
        atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')),
      );
      if (
        typeof decoded !== 'object' ||
        decoded === null ||
        !('role' in decoded) ||
        decoded.role !== 'anon'
      ) {
        return { config: null, error };
      }
    }
    return { config: { url: url.trim(), key: cleanKey }, error: null };
  } catch {
    return { config: null, error };
  }
}
module.exports = { validatePublicConfig };
