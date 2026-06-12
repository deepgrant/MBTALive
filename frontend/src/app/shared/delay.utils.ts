/** More than 5 minutes behind schedule counts as late. */
export const DELAY_LATE_SECONDS = 300;

/** More than 1 minute ahead of schedule counts as early. */
export const DELAY_EARLY_SECONDS = -60;

export type DelayCategory = 'late' | 'early' | 'ontime';

export function delayCategory(delaySeconds: number | null | undefined): DelayCategory {
  const d = delaySeconds ?? 0;
  if (d > DELAY_LATE_SECONDS) return 'late';
  if (d < DELAY_EARLY_SECONDS) return 'early';
  return 'ontime';
}
