// Internal keyed work must exist once its owning queue or roster admits it.
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Observer work unavailable");
  return value;
}
