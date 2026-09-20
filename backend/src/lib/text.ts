import { z } from 'zod';

/** C0/C1 control characters, including NUL (Postgres text cannot store U+0000), tab and newline. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
/** Format characters (Unicode Cf): zero-width space/joiners, bidi overrides such as U+202E, BOM, soft hyphen... */
const FORMAT = /\p{Cf}/gu;
const VISIBLE = /[^\s\p{Cf}\p{Cc}]/u;

/** True when the string is safe to send to Postgres: no control characters and no unpaired surrogates. */
export const isCleanText = (s: string) => !CONTROL.test(s) && s.isWellFormed();

const BAD = 'contains control characters or invalid unicode';

/**
 * Plain string for path params, query filters and other identifiers: bounded and free of control
 * characters / lone surrogates, so it can never make the database driver fail with a 500.
 */
export const safeString = (max: number, min = 1) =>
  z.string().min(min).max(max).refine(isCleanText, { message: BAD });

/**
 * Human-entered names (IGN, nickname, job label). Control characters and lone surrogates are REJECTED (422).
 * Format/zero-width characters (Cf) are STRIPPED, so `Al<ZWSP>pha` and `Alpha` are the same name and the
 * uniqueness index cannot be defeated with invisible characters. The result is NFC-normalized and trimmed and
 * must keep at least one visible character (a name made only of invisible characters is rejected).
 */
export const nameField = (max: number) =>
  z
    .string()
    .max(max * 4) // cheap bound before any processing
    .refine(isCleanText, { message: BAD })
    .transform((s) => s.normalize('NFC').replace(FORMAT, '').trim())
    .pipe(
      z
        .string()
        .min(1, 'must not be empty')
        .max(max)
        .refine((s) => VISIBLE.test(s), { message: 'must contain a visible character' }),
    );
