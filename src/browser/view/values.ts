export function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Missing View geometry or drawing resource");
  return value;
}
