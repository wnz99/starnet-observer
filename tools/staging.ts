import fs from "node:fs/promises";
import path from "node:path";

export async function stageBuild(output: string, emit: (staging: string) => Promise<void>) {
  const staging = await fs.mkdtemp(
    path.join(path.dirname(output), `.${path.basename(output)}-build-`),
  );
  try {
    await emit(staging);
    await fs.rm(output, { recursive: true, force: true });
    await fs.rename(staging, output);
    return output;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
