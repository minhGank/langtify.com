import type { Json } from '@/types/database';

export type PhotoGuidance = {
  locale: 'en' | 'fr';
  primaryIdea: string;
  mode: 'literal' | 'interpretive';
  alternativeIdea: string | null;
  alternativeMode: 'literal' | 'interpretive' | null;
  accessibility: string;
  safety: string;
};
const mode = (value: Json | undefined): value is PhotoGuidance['mode'] =>
  value === 'literal' || value === 'interpretive';
const copy = (value: Json | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;

// Optional help must not break an otherwise valid challenge on old deployments
// or a malformed editorial response. Never show partial guidance without safety.
export function parsePhotoGuidance(
  value: Json | undefined,
  conceptId: string,
): PhotoGuidance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (
    value.concept_id !== conceptId ||
    (value.locale !== 'en' && value.locale !== 'fr') ||
    !copy(value.primary_idea) ||
    !mode(value.representation_mode) ||
    !copy(value.accessibility_guidance) ||
    !copy(value.safety_guidance) ||
    !(
      (value.alternative_idea === null && value.alternative_mode === null) ||
      (copy(value.alternative_idea) && mode(value.alternative_mode))
    )
  )
    return null;
  return {
    locale: value.locale,
    primaryIdea: value.primary_idea,
    mode: value.representation_mode,
    alternativeIdea: typeof value.alternative_idea === 'string' ? value.alternative_idea : null,
    alternativeMode: mode(value.alternative_mode) ? value.alternative_mode : null,
    accessibility: value.accessibility_guidance,
    safety: value.safety_guidance,
  };
}
