// Teste ponta a ponta da extensão (página imitando o WhatsApp Web + API falsa local).
// Rode: node scripts/e2e-extension.mjs   (precisa do Playwright e do Chromium instalados)
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const extensao = join(dirname(fileURLToPath(import.meta.url)), "..", "extension");

const PAGINA = (mensagens) => `<!doctype html><html><body>
<div id="main"><header><span title="Ana Souza">Ana Souza</span></header>
${mensagens
  .map(
    ([dir, txt]) =>
      `<div class="message-${dir}"><div class="copyable-text" data-pre-plain-text="[10:00, 26/11/2026] X: "><span class="selectable-text">${txt}</span></div></div>`,
  )
  .join("")}
<footer><div contenteditable="true" id="campo"></div></footer></div></body></html>`;

let ultimoPedido = null;
const api = http
  .createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
      if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
      ultimoPedido = JSON.parse(corpo);
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: 'Oi, Ana! Que bom falar com você. Você procura apartamento para morar?\n```json\n{"temperatura":"morno","disc":"S","etapa":"novo","optout":false,"escalar":false}\n```',
            },
          ],
        }),
      );
    });
  })
  .listen(0);
const porta = api.address().port;

async function abrir(mensagens) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "mz-")), {
    headless: false,
    args: [`--disable-extensions-except=${extensao}`, `--load-extension=${extensao}`, "--headless=new"],
  });
  await ctx.route("https://web.whatsapp.com/**", (r) =>
    r.fulfill({ contentType: "text/html; charset=utf-8", body: PAGINA(mensagens) }),
  );
  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  await sw.evaluate(
    (p) => chrome.storage.local.set({ apiKey: "chave-falsa", apiUrl: `http://127.0.0.1:${p}/v1/messages` }),
    porta,
  );
  const page = await ctx.newPage();
  await page.goto("https://web.whatsapp.com/");
  await page.waitForFunction(() => document.getElementById("maximus-zap-host"));
  return { ctx, page };
}
const painel = (page, sel) => page.locator(`#maximus-zap-host >> ${sel}`);

try {
  // 1) Primeiro contato: Telefonista, texto vai para o campo e NADA é enviado.
  let { ctx, page } = await abrir([["in", "Oi, vi o anúncio do apartamento"]]);
  await painel(page, "#fab").click();
  await painel(page, "#sugerir").click();
  await page.waitForFunction(() => document.getElementById("maximus-zap-host").shadowRoot.getElementById("texto").value);
  const texto = await painel(page, "#texto").inputValue();
  assert.match(texto, /Que bom falar com você/);
  assert.ok(!texto.includes("```"), "bloco crm deveria ser removido do texto");
  assert.match(await painel(page, "#info").innerText(), /Agente: telefonista/);
  assert.match(ultimoPedido.system, /TELEFONISTA/);
  assert.match(ultimoPedido.messages[0].content, /CLIENTE: Oi, vi o anúncio/);
  await painel(page, "#inserir").click();
  assert.match(await page.locator("#campo").innerText(), /Que bom falar com você/);
  await ctx.close();

  // 2) Pedido de documentos: resposta fixa com a lista oficial, sem chamar a API.
  ultimoPedido = null;
  ({ ctx, page } = await abrir([["in", "Quais documentos eu preciso mandar?"]]));
  await painel(page, "#fab").click();
  await painel(page, "#sugerir").click();
  await page.waitForFunction(() => document.getElementById("maximus-zap-host").shadowRoot.getElementById("texto").value);
  const docs = await painel(page, "#texto").inputValue();
  assert.match(docs, /^Ana, /);
  assert.match(docs, /6\. E-mail e telefone para contato/);
  assert.equal(ultimoPedido, null, "não deveria chamar o modelo para a lista de documentos");

  // 3) Assumir lead avança o rodízio: Suelen -> Marília.
  await painel(page, "#assumir").click();
  await page.waitForFunction(() => /assumiu/.test(document.getElementById("maximus-zap-host").shadowRoot.getElementById("info").textContent));
  assert.match(await painel(page, "#info").innerText(), /Suelen assumiu\. Próximo da vez: Marília/);
  await ctx.close();
  console.log("E2E OK");
} finally {
  api.close();
}
