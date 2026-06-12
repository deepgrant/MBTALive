import { isDevMode } from '@angular/core';
import { map, type OperatorFunction } from 'rxjs';
import { z } from 'zod';

// Runtime validation lives ONLY at trust boundaries: HTTP responses
// (ApiService) and the settings cookie (CookieService). Data derived inside
// the app stays compile-time-typed — re-validating it costs CPU per poll and
// cannot catch anything the compiler doesn't.
//
// The backend (Spray JSON) is inconsistent about absent values: the vehicles
// endpoint emits explicit nulls, the board and alerts endpoints omit fields
// entirely. All three helpers below treat omitted, undefined, and null alike.
//
// If the bundle budget ever tightens, `zod/mini` is the drop-in escape hatch.

/** Exact `?? fallback` semantics: absent, undefined, AND null → fallback. */
export function withDefault<S extends z.ZodType>(schema: S, fallback: z.output<S>) {
  return schema.nullish().transform((v): z.output<S> => v ?? fallback);
}

/** Absent, undefined, or null all normalize to null. For fields declared `X | null`. */
export function orNull<S extends z.ZodType>(schema: S) {
  return schema.nullish().transform((v): z.output<S> | null => v ?? null);
}

/** Absent, undefined, or null all normalize to undefined. For fields declared `X?`. */
export function orUndefined<S extends z.ZodType>(schema: S) {
  return schema.nullish().transform((v): z.output<S> | undefined => v ?? undefined);
}

/**
 * Validates a single-object payload (e.g. /board). Logs issues with endpoint
 * context, then throws in BOTH dev and prod — the throw lands in the caller's
 * existing catchError, reusing the same fallback path the UI already
 * exercises on network errors.
 */
export function parseWith<S extends z.ZodType>(
  schema: S, context: string,
): OperatorFunction<unknown, z.output<S>> {
  return map(raw => {
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    console.error(`[validation] ${context}:`, z.prettifyError(result.error));
    throw result.error;
  });
}

/**
 * Validates an array payload element by element. Prod: keeps valid elements
 * and drops invalid ones (one malformed vehicle must not blank the 30 good
 * ones; polling self-heals within seconds). Dev: throws on the first bad
 * element so contract drift fails loudly during development.
 */
export function parseArrayWith<S extends z.ZodType>(
  schema: S, context: string,
): OperatorFunction<unknown, z.output<S>[]> {
  return map(raw => {
    if (!Array.isArray(raw)) {
      console.error(`[validation] ${context}: expected array, received`, typeof raw);
      throw new Error(`${context}: expected array payload`);
    }
    const valid: z.output<S>[] = [];
    let firstError: z.ZodError | null = null;
    for (const item of raw) {
      const result = schema.safeParse(item);
      if (result.success) {
        valid.push(result.data);
      } else {
        firstError ??= result.error;
        console.error(`[validation] ${context}: element dropped:`, z.prettifyError(result.error));
      }
    }
    if (firstError && isDevMode()) throw firstError;
    return valid;
  });
}
