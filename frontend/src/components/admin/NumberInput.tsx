import { useState } from "react";

type Props = {
  value: number;
  min: number;
  max: number;
  /** used while the field is blank, and written back into it on blur */
  fallback: number;
  onChange: (value: number) => void;
  "aria-label": string;
  className?: string;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * Whole-number field that can be cleared completely while typing. A blank (or non-numeric) field counts as `fallback`,
 * any number is kept within min..max, and on blur the field is repainted with the value in use so it never looks empty.
 */
export default function NumberInput({ value, min, max, fallback, onChange, className, "aria-label": label }: Props) {
  const [text, setText] = useState(() => String(value));
  const parse = (raw: string) => (raw.trim() === "" || !Number.isFinite(Number(raw)) ? fallback : clamp(Math.round(Number(raw)), min, max));
  return (
    <input
      type="number"
      className={className}
      value={text}
      min={min}
      max={max}
      aria-label={label}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parse(e.target.value));
      }}
      onBlur={() => {
        const used = parse(text);
        if (text !== String(used)) setText(String(used));
      }}
    />
  );
}
