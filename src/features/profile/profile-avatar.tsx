import { Avatar } from '@/components/ui/avatar';
import type { AvatarIdentity } from '@/services/avatars';
import { useAvatarRows } from '@/features/social/connections-avatars';

type Props = {
  identity: AvatarIdentity;
  username: string;
  avatarId: string | null;
  isSelf?: boolean;
  size?: number;
};
export function ProfileAvatar({ identity, username, avatarId, isSelf, size }: Props) {
  const row = { avatarId, isSelf };
  const avatars = useAvatarRows(identity, [row]);
  return <Avatar username={username} uri={avatars.uri(row)} size={size} />;
}
