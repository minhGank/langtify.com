import { isValidTimezone } from './validation';

// Use the runtime's IANA catalog so offsets/DST names are never user-authored.
// Older runtimes can still retain a valid saved/device zone and explicitly use UTC.
export function timezoneOptions(saved: string, detected: string): string[] {
  let catalog: string[] = [];
  try {
    catalog = Intl.supportedValuesOf('timeZone');
  } catch {
    // Some older web runtimes do not implement supportedValuesOf.
  }
  return [...new Set([...catalog, saved, detected, 'UTC'])]
    .filter(isValidTimezone)
    .sort((a, b) => a.localeCompare(b));
}

export function timezoneLabel(value: string) {
  return value.replaceAll('_', ' ').replaceAll('/', ' / ');
}

export function filterTimezones(options: readonly string[], query: string) {
  const search = query.trim().toLocaleLowerCase().replaceAll('_', ' ').replaceAll('/', ' ');
  const words = search.split(/\s+/).filter(Boolean);
  return options.filter((option) => {
    const label = option.toLocaleLowerCase().replaceAll('_', ' ').replaceAll('/', ' ');
    return words.every((word) => label.includes(word));
  });
}
