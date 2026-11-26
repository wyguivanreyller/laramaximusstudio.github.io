// Gera extension/generated/: prompts já montados + config + lógica pura copiada.
// Rode com: npm run build:extension
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { montarPrompt } from "../src/agentes.js";
import { carregarConfig } from "../src/config.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const saida = join(raiz, "extension", "generated");
mkdirSync(saida, { recursive: true });

const config = carregarConfig();
const prompts = Object.fromEntries(
  ["trinity", "neo", "telefonista"].map((a) => [a, montarPrompt(a, { config })]),
);

writeFileSync(
  join(saida, "dados.js"),
  "// GERADO por scripts/build-extension.js. Não edite à mão.\n" +
    `export const CONFIG = ${JSON.stringify(config, null, 2)};\n` +
    `export const PROMPTS = ${JSON.stringify(prompts, null, 2)};\n`,
);
for (const f of ["roteador.js", "documentos.js"]) copyFileSync(join(raiz, "src", f), join(saida, f));
console.log("Extensão atualizada em", saida);
