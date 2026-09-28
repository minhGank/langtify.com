import { useState, type ReactNode } from 'react';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { feedback } from '@/lib/haptics';
import type { useAssignmentPhoto } from './use-assignment-photo';
import { VisibilityChoice } from './visibility-choice';

export function PhotoOptions({
  state,
  choosing = false,
  onRetake,
  onChooseLibrary,
  share,
}: {
  state: ReturnType<typeof useAssignmentPhoto>;
  choosing?: boolean;
  share?: ReactNode;
  onRetake?: () => void;
  onChooseLibrary?: () => void;
}) {
  const [sheet, setSheet] = useState<'options' | 'delete' | null>(null);
  const saved = state.data?.submission;
  const completed = saved?.status === 'completed';
  const busy = state.busy || choosing;
  const canChange = !completed && !state.remoteUri && state.data?.canCapture;
  const action = (perform: () => void) => {
    setSheet(null);
    perform();
  };
  return (
    <>
      <IconButton
        label="Photo options"
        name="ellipsis-horizontal"
        disabled={busy}
        onPress={() => setSheet('options')}
      />
      <Sheet
        title={
          sheet === 'delete'
            ? completed
              ? 'Delete this photo?'
              : 'Discard this photo?'
            : 'Photo options'
        }
        visible={sheet !== null}
        onClose={() => setSheet(null)}
      >
        {sheet === 'delete' ? (
          <>
            <AppText>
              {completed
                ? state.data?.captureKind === 'historical'
                  ? 'This removes the photo and its XP. Your daily progress and streak won’t change.'
                  : 'This removes the photo and its XP. It may also affect your challenge bonus and streak.'
                : 'This photo hasn’t been added yet. Discard it and choose another?'}
            </AppText>
            <Button
              label={completed ? 'Delete photo' : 'Discard photo'}
              accessibilityLabel="Confirm delete photo"
              variant="danger"
              loading={busy}
              onPress={() =>
                action(() => {
                  feedback.warning();
                  void state.deletePhoto();
                })
              }
            />
            <Button
              label="Keep photo"
              variant="secondary"
              disabled={busy}
              onPress={() => setSheet(null)}
            />
          </>
        ) : (
          <>
            {completed && share}
            {completed && saved && (
              <VisibilityChoice
                value={saved.visibility === 'public'}
                disabled={busy}
                onChange={(value) => void state.changeVisibility(value ? 'public' : 'private')}
              />
            )}
            {canChange && onRetake && (
              <Button
                label="Retake photo"
                variant="secondary"
                disabled={busy}
                onPress={() => action(onRetake)}
              />
            )}
            {canChange && onChooseLibrary && (
              <Button
                label="Choose from library"
                variant="secondary"
                disabled={busy}
                onPress={() => action(onChooseLibrary)}
              />
            )}
            {completed && <AppText variant="caption">Challenge · {state.data?.localDate}</AppText>}
            {state.error && (
              <>
                <AppText accessibilityRole="alert">{state.error}</AppText>
                <Button
                  label="Refresh privacy setting"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => void state.refresh()}
                />
              </>
            )}
            <Button
              label={completed ? 'Delete photo' : 'Discard photo'}
              variant="danger"
              disabled={busy}
              onPress={() => setSheet('delete')}
            />
          </>
        )}
      </Sheet>
    </>
  );
}
