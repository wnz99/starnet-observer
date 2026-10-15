export function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    value !== null &&
    value !== undefined &&
    (typeof value === "object" || typeof value === "string" || typeof value === "function") &&
    Symbol.iterator in Object(value) &&
    typeof Reflect.get(Object(value), Symbol.iterator) === "function"
  );
}
