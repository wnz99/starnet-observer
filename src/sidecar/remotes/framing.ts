import { MAX_LINE } from "./fields.js";

export class SnapshotLines {
  private buffer = "";
  private overflow = false;
  constructor(
    private accept: (line: string) => void,
    private oversized: () => void,
  ) {}
  push(chunk: string) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (this.overflow) {
        // the tail of an oversized line
        this.overflow = false;
        continue;
      }
      if (line.length > MAX_LINE) this.oversized();
      else if (line.trim()) this.accept(line);
    }
    if (this.buffer.length > MAX_LINE) {
      this.buffer = "";
      this.overflow = true;
      this.oversized();
    }
  }
}
