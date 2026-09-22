// Verified against Langtify Dev Auth and local GoTrue v2.196.0 on 2026-09-21.
// This mirrors existing server policy; it must change with hosted Auth settings.
// GoTrue checks UTF-8 bytes, including its bcrypt limit, rather than JS string length.
export const signupPasswordPolicy = {
  minimumBytes: 6,
  maximumBytes: 72,
} as const;

export const signupPasswordHint = `${signupPasswordPolicy.minimumBytes}–${signupPasswordPolicy.maximumBytes} bytes. Standard letters, numbers and symbols use one byte; accented letters and emoji can use more. No required character mix.`;

export function passwordBytes(password: string): number {
  let bytes = 0;
  for (const character of password) {
    const point = character.codePointAt(0);
    if (point === undefined) continue;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export function validateSignupPassword(password: string): string | undefined {
  if (!password) return 'Enter your password.';
  const bytes = passwordBytes(password);
  if (bytes < signupPasswordPolicy.minimumBytes) {
    return `Use at least ${signupPasswordPolicy.minimumBytes} bytes (${signupPasswordPolicy.minimumBytes} standard letters, numbers or symbols).`;
  }
  if (bytes > signupPasswordPolicy.maximumBytes) {
    return `Use no more than ${signupPasswordPolicy.maximumBytes} bytes. Accented letters and emoji use extra space.`;
  }
  return undefined;
}

export function passwordRejection(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  if (error.code !== 'weak_password') return undefined;
  if ('reasons' in error && Array.isArray(error.reasons) && error.reasons.includes('pwned')) {
    return 'This password appears in a known data breach. Choose a different password.';
  }
  // A hosted policy may change independently of an installed app. Only extract
  // the bounded numeric requirement, never render arbitrary server messages.
  if ('message' in error && typeof error.message === 'string') {
    const match = /^Password should be at least ([0-9]{1,2}) characters\.$/.exec(error.message);
    if (match && Number(match[1]) >= 6 && Number(match[1]) <= 72) {
      return `Use at least ${match[1]} bytes (standard letters, numbers and symbols use one byte each).`;
    }
  }
  return 'This password was rejected by the account security checks. Choose a different password.';
}
