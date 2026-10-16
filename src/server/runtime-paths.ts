import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveRuntimePaths({
  installRoot,
  publicRoot,
}: {
  installRoot?: string;
  publicRoot?: string;
} = {}): { installRoot: string; publicRoot: string } {
  const packageRoot =
    installRoot ??
    path.resolve(
      fileURLToPath(
        new URL(import.meta.url.endsWith(".ts") ? "../../" : "../../../../", import.meta.url),
      ),
    );
  return {
    installRoot: packageRoot,
    publicRoot: publicRoot ?? path.join(packageRoot, "frontend"),
  };
}
