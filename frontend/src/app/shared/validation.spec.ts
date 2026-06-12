import { firstValueFrom, of } from 'rxjs';
import { z } from 'zod';
import { orNull, orUndefined, parseArrayWith, parseWith, withDefault } from './validation';

describe('withDefault', () => {
  const schema = z.object({ speed: withDefault(z.number(), 0) });

  it('applies the fallback when the key is absent', () => {
    expect(schema.parse({}).speed).toBe(0);
  });

  it('applies the fallback for explicit null (vehicles endpoint sends nulls)', () => {
    expect(schema.parse({ speed: null }).speed).toBe(0);
  });

  it('applies the fallback for undefined', () => {
    expect(schema.parse({ speed: undefined }).speed).toBe(0);
  });

  it('passes a present value through', () => {
    expect(schema.parse({ speed: 42 }).speed).toBe(42);
  });

  it('still rejects wrong types', () => {
    expect(schema.safeParse({ speed: 'fast' }).success).toBeFalse();
  });
});

describe('orNull', () => {
  const schema = z.object({ delaySeconds: orNull(z.number()) });

  it('normalizes an omitted key to null (board endpoint omits Option fields)', () => {
    expect(schema.parse({}).delaySeconds).toBeNull();
  });

  it('keeps explicit null as null', () => {
    expect(schema.parse({ delaySeconds: null }).delaySeconds).toBeNull();
  });

  it('passes a present value through', () => {
    expect(schema.parse({ delaySeconds: 300 }).delaySeconds).toBe(300);
  });
});

describe('orUndefined', () => {
  const schema = z.object({ tripName: orUndefined(z.string()) });

  it('normalizes explicit null to undefined', () => {
    expect(schema.parse({ tripName: null }).tripName).toBeUndefined();
  });

  it('normalizes an omitted key to undefined', () => {
    expect(schema.parse({}).tripName).toBeUndefined();
  });

  it('passes a present value through', () => {
    expect(schema.parse({ tripName: '123' }).tripName).toBe('123');
  });
});

describe('parseWith', () => {
  const schema = z.object({ id: z.string() });

  it('emits parsed data for a valid payload', async () => {
    const result = await firstValueFrom(of({ id: 'x', extra: 1 }).pipe(parseWith(schema, 'test')));
    expect(result).toEqual({ id: 'x' }); // unknown keys stripped
  });

  it('throws (into catchError territory) for an invalid payload', async () => {
    await expectAsync(
      firstValueFrom(of({ id: 5 }).pipe(parseWith(schema, 'test')))
    ).toBeRejected();
  });
});

describe('parseArrayWith', () => {
  const schema = z.object({ id: z.string() });

  // Karma runs the app in dev mode, so invalid elements throw rather than
  // drop — the prod drop branch is exercised manually (see plan verification).
  it('parses a fully valid array', async () => {
    const result = await firstValueFrom(
      of([{ id: 'a' }, { id: 'b' }]).pipe(parseArrayWith(schema, 'test'))
    );
    expect(result.length).toBe(2);
  });

  it('throws in dev mode when an element is invalid', async () => {
    await expectAsync(
      firstValueFrom(of([{ id: 'a' }, { id: 7 }]).pipe(parseArrayWith(schema, 'test')))
    ).toBeRejected();
  });

  it('throws when the payload is not an array at all', async () => {
    await expectAsync(
      firstValueFrom(of({ not: 'an array' }).pipe(parseArrayWith(schema, 'test')))
    ).toBeRejected();
  });
});
