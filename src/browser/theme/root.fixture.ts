export function fixtureRoot() {
  const properties = new Map<string, string>(),
    attributes = new Map<string, string>();
  return {
    properties,
    attributes,
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => {
          properties.set(name, value);
        },
      },
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
      },
    },
  };
}
