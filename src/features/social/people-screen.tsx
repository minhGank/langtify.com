import { ExploreScreen } from '@/features/explore/explore-screen';

// Preserve existing internal links while giving People the shared Search layout.
export function PeopleScreen() {
  return <ExploreScreen initialCategory="people" />;
}
