export class FontFaceFixture {
  readonly weight: string;
  constructor(
    readonly family: string,
    readonly source: string,
    readonly descriptors: {
      display: "swap";
      weight: string;
      style: "normal";
    },
  ) {
    this.weight = descriptors.weight;
  }
  // browserThemeFont calls load through generic FontResource; Fallow 3.27.0 misses the concrete member.
  // fallow-ignore-next-line unused-class-member
  load() {
    return Promise.resolve(this);
  }
}
