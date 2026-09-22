import { router } from 'expo-router';
import type { ConnectionKind } from '@/services/connections';

export function openConnections(profileId: string, kind: ConnectionKind) {
  router.push({ pathname: '/connections', params: { profileId, kind } });
}
