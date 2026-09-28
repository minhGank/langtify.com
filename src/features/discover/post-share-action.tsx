import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/app-text';
import type { FeedItem } from '@/services/discover';
import { sharePost } from './share-post';

export function PostShareAction({ item }: { item: FeedItem }) {
  const active = useRef(false);
  const pending = useRef(false);
  const [error, setError] = useState(false);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
      };
    }, []),
  );
  return (
    <>
      <Button
        label="Share"
        variant="ghost"
        onPress={() => {
          if (pending.current || !active.current || AppState.currentState !== 'active') return;
          pending.current = true;
          setError(false);
          void sharePost(item)
            .catch(() => {
              if (active.current && AppState.currentState === 'active') setError(true);
            })
            .finally(() => {
              pending.current = false;
            });
        }}
      />
      {error && <AppText accessibilityRole="alert">We couldn’t open sharing. Try again.</AppText>}
    </>
  );
}
