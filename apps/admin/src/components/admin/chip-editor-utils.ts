export const CHIP_SEPARATOR_REGEX = /[|｜]/;

export function normalizeChip(value: string): string {
  return value.replace(/[|｜]/g, "").trim();
}

export function splitChips(value: string): string[] {
  if (!value) return [];
  return value
    .split(CHIP_SEPARATOR_REGEX)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinChips(chips: string[]): string {
  return chips.filter(Boolean).join("|");
}

export function addChip(value: string, chip: string): string {
  const next = normalizeChip(chip);
  if (!next) return value;
  const chips = splitChips(value);
  if (chips.includes(next)) return value;
  return joinChips([...chips, next]);
}

export function removeChip(value: string, chip: string): string {
  return joinChips(splitChips(value).filter((c) => c !== chip));
}
