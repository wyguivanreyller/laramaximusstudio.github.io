import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));

export function carregarConfig(caminho = join(aqui, "..", "config", "equipe.json")) {
  return JSON.parse(readFileSync(caminho, "utf8"));
}
