import { AppText } from '@/components/ui/app-text';
import { Screen } from '@/components/ui/screen';

type PlaceholderScreenProps = { title: string };

export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  return (
    <Screen hasTabBar>
      <AppText variant="title">{title}</AppText>
    </Screen>
  );
}
