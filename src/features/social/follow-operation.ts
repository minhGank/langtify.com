import type { SafetyIdentity } from '@/features/safety/model';
import { discardServerData, serverScope } from '@/lib/server-cache';
import type { FollowReceipt } from '@/services/social';

// A cancelled write may already have committed. Retire the originating session's
// relationship projections immediately, without starting reads from a blurred
// screen or replaying the old intent. The next active access reconciles authority.
export async function followWithRecovery(
  identity: SafetyIdentity,
  signal: AbortSignal,
  write: () => Promise<FollowReceipt>,
): Promise<FollowReceipt> {
  const scope = serverScope(identity.userId, identity.token);
  let confirmed = false;
  let recovered = false;
  const recover = () => {
    if (confirmed || recovered) return;
    recovered = true;
    discardServerData(['follows', 'connections'], { scope });
  };
  signal.addEventListener('abort', recover, { once: true });
  try {
    if (signal.aborted) throw new Error('Follow cancelled.');
    const result = await write();
    if (signal.aborted) throw new Error('Follow cancelled.');
    confirmed = true;
    return result;
  } catch (cause) {
    recover();
    throw cause;
  } finally {
    signal.removeEventListener('abort', recover);
  }
}
