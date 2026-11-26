// Teste ponta a ponta da extensão (página imitando o WhatsApp Web + API falsa local).
// Rode: node scripts/e2e-extension.mjs   (precisa do Playwright e do Chromium instalados)
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { criarServidor } from "../server/server.js";
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

async function abrir(mensagens, armazenamento) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "mz-")), {
    headless: false,
    args: [`--disable-extensions-except=${extensao}`, `--load-extension=${extensao}`, "--headless=new"],
  });
  await ctx.route("https://web.whatsapp.com/**", (r) =>
    r.fulfill({ contentType: "text/html; charset=utf-8", body: PAGINA(mensagens) }),
  );
  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  await sw.evaluate(
    (dados) => chrome.storage.local.set(dados),
    armazenamento ?? { apiKey: "chave-falsa", apiUrl: `http://127.0.0.1:${porta}/v1/messages` },
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

  // 4) Servidor da equipe: dois corretores, rodízio único, chave da IA só no servidor.
  const dir = mkdtempSync(join(tmpdir(), "mz-srv-"));
  const srv = criarServidor({
    MAXIMUS_DB: join(dir, "e2e.db"),
    MAXIMUS_TOKENS: "suelen:tok-s,marilia:tok-m",
    ANTHROPIC_API_KEY: "chave-real-so-no-servidor",
    ANTHROPIC_URL: `http://127.0.0.1:${porta}/v1/messages`,
  });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const conversa = [["in", "Oi, vi o anúncio do apartamento"]];
  const A = await abrir(conversa, { servidorUrl: base, token: "tok-s" });
  const B = await abrir(conversa, { servidorUrl: base, token: "tok-m" });
  await painel(A.page, "#fab").click();
  await painel(A.page, "#sugerir").click();
  await A.page.waitForFunction(() => document.getElementById("maximus-zap-host").shadowRoot.getElementById("texto").value);
  assert.equal(ultimoPedido.system.includes("TELEFONISTA"), true);
  await painel(A.page, "#assumir").click();
  await A.page.waitForFunction(() => /assumiu/.test(document.getElementById("maximus-zap-host").shadowRoot.getElementById("info").textContent));
  assert.match(await painel(A.page, "#info").innerText(), /Suelen assumiu\. Próximo da vez: Marília/);
  await painel(B.page, "#fab").click();
  await painel(B.page, "#assumir").click();
  await B.page.waitForFunction(() => /já é de/.test(document.getElementById("maximus-zap-host").shadowRoot.getElementById("info").textContent));
  assert.match(await painel(B.page, "#info").innerText(), /já é de Suelen/);
  await A.ctx.close();
  await B.ctx.close();
  srv.close();
  console.log("E2E OK");
} finally {
  api.close();
}
