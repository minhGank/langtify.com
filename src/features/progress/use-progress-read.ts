import { type ServerEntry } from '@/lib/server-cache';
import { useServerQuery } from '@/hooks/use-server-query';

export function useProgressRead<T>(load: () => Promise<T>, entry: ServerEntry<T>) {
  return useServerQuery(entry, load, { staleTime: 60000 });
}
