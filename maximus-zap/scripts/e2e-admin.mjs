// Teste da página /admin num navegador (tamanho de celular). Rode: node scripts/e2e-admin.mjs [captura.png]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { criarServidor } from "../server/server.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const srv = criarServidor({
  MAXIMUS_DB: join(mkdtempSync(join(tmpdir(), "mz-adm-")), "a.db"),
  MAXIMUS_TOKENS: "suelen:tok-s",
  MAXIMUS_ADMIN_TOKEN: "tok-admin",
});
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;
const chamar = (m, rota, corpo) =>
  fetch(base + rota, { method: m, headers: { "content-type": "application/json", "x-api-key": "tok-s" }, body: corpo && JSON.stringify(corpo) });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 })).newPage();
const erros = [];
page.on("console", (m) => m.type() === "error" && erros.push(m.text()));
page.on("pageerror", (e) => erros.push(String(e)));
try {
  await page.goto(base + "/admin");
  // token errado
  await page.fill("#token", "errado");
  await page.click("#form-entrada button");
  await page.waitForFunction(() => /inválido/.test(document.getElementById("mensagem").textContent));
  // token de corretor (não admin)
  await page.fill("#token", "tok-s");
  await page.click("#form-entrada button");
  await page.waitForFunction(() => /não é de administrador/.test(document.getElementById("mensagem").textContent));
  // admin
  await chamar("POST", "/v1/rodizio/assumir", { leadId: "Ana" });
  await page.fill("#token", "tok-admin");
  await page.click("#form-entrada button");
  await page.waitForSelector("#lista .item");
  assert.equal(await page.locator("#lista .item").count(), 5);
  assert.match(await page.locator("#proximo").innerText(), /Próximo da vez\s+Marília/);
  assert.match(await page.locator("#lista .item").first().innerText(), /Suelen\s+Hoje: 1 · Total: 1/);
  // desligar Marília: próxima passa a ser Iara
  const chave = page.getByRole("switch", { name: "Marília na fila" });
  assert.equal(await chave.getAttribute("aria-checked"), "true");
  await chave.click();
  await page.waitForFunction(() => /Iara/.test(document.getElementById("proximo").textContent));
  assert.equal(await page.getByRole("switch", { name: "Marília na fila" }).getAttribute("aria-checked"), "false");
  assert.match(await page.locator("#mensagem").innerText(), /Marília saiu da fila/);
  await page.screenshot({ path: process.argv[2] || join(tmpdir(), "admin.png") });
  // soltar lead
  page.once("dialog", (d) => d.accept());
  await page.fill("#lead", "Ana");
  await page.click("#form-liberar button");
  await page.waitForFunction(() => /Lead solto/.test(document.getElementById("mensagem").textContent));
  // desligar todos => alerta
  for (const nome of ["Suelen", "Iara", "Francine", "Guilherme"]) {
    await page.getByRole("switch", { name: `${nome} na fila` }).click();
    await page.waitForFunction((n) => document.querySelector(`[aria-label="${n} na fila"]`)?.getAttribute("aria-checked") === "false", nome);
  }
  await page.waitForFunction(() => /Ninguém está ativo/.test(document.getElementById("proximo").textContent));
  // sair volta ao login e apaga o token
  await page.click("#sair");
  assert.equal(await page.locator("#entrada").isVisible(), true);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("mzAdminToken")), null);
  assert.deepEqual(erros.filter((e) => !/40[13]/.test(e)), [], "erros no console");
  console.log("ADMIN OK");
} finally {
  await browser.close();
  srv.close();
}
