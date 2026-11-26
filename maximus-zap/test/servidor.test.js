import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarServidor } from "../server/server.js";

const dir = mkdtempSync(join(tmpdir(), "mz-srv-"));
const TOK = { suelen: "tok-suelen", marilia: "tok-marilia" };
let ultimoUpstream = null;
let upstream, upPorta;

const envBase = (extra = {}) => ({
  MAXIMUS_DB: join(dir, `${Math.random()}.db`),
  MAXIMUS_TOKENS: `suelen:${TOK.suelen},marilia:${TOK.marilia}`,
  MAXIMUS_ADMIN_TOKEN: "tok-admin",
  ANTHROPIC_API_KEY: "chave-real-secreta",
  ANTHROPIC_URL: `http://127.0.0.1:${upPorta}/v1/messages`,
  ...extra,
});

async function subir(env) {
  const s = criarServidor(env);
  await new Promise((r) => s.listen(0, r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const chamar = (metodo, rota, { token, corpo } = {}) =>
    fetch(base + rota, {
      method: metodo,
      headers: { "content-type": "application/json", ...(token ? { "x-api-key": token } : {}) },
      body: corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  return { s, chamar, fechar: () => new Promise((r) => s.close(r)) };
}

before(async () => {
  upstream = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      ultimoUpstream = { headers: req.headers, corpo: JSON.parse(b) };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ content: [{ type: "text", text: "ok" }] }));
    });
  });
  await new Promise((r) => upstream.listen(0, r));
  upPorta = upstream.address().port;
});
after(() => {
  upstream.close();
  rmSync(dir, { recursive: true, force: true });
});

test("sem token ou com token errado: 401; /saude é público", async () => {
  const { chamar, fechar } = await subir(envBase());
  assert.equal((await chamar("GET", "/saude")).status, 200);
  assert.equal((await chamar("GET", "/v1/rodizio")).status, 401);
  assert.equal((await chamar("GET", "/v1/rodizio", { token: "errado" })).status, 401);
  assert.equal((await chamar("GET", "/v1/rodizio", { token: TOK.suelen })).status, 200);
  await fechar();
});

test("rodízio segue a ordem e é idempotente por lead", async () => {
  const { chamar, fechar } = await subir(envBase());
  const t = { token: TOK.suelen };
  const a = await chamar("POST", "/v1/rodizio/assumir", { ...t, corpo: { leadId: "Ana Souza" } });
  assert.equal(a.json.corretor.nome, "Suelen");
  assert.equal(a.json.proximo.nome, "Marília");
  // mesmo lead (mesmo com outra caixa/espaços) volta para o mesmo corretor e NÃO avança a fila
  const b = await chamar("POST", "/v1/rodizio/assumir", { token: TOK.marilia, corpo: { leadId: "  ana souza " } });
  assert.equal(b.json.corretor.nome, "Suelen");
  assert.equal(b.json.jaAtribuido, true);
  assert.equal(b.json.proximo.nome, "Marília");
  const c = await chamar("POST", "/v1/rodizio/assumir", { ...t, corpo: { leadId: "Bruno" } });
  assert.equal(c.json.corretor.nome, "Marília");
  await fechar();
});

test("20 cliques simultâneos em leads diferentes dividem igual entre os 5 corretores", async () => {
  const { chamar, fechar } = await subir(envBase());
  const respostas = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      chamar("POST", "/v1/rodizio/assumir", { token: TOK.suelen, corpo: { leadId: `lead-${i}` } }),
    ),
  );
  const contagem = {};
  for (const r of respostas) contagem[r.json.corretor.nome] = (contagem[r.json.corretor.nome] || 0) + 1;
  assert.deepEqual(Object.values(contagem), [4, 4, 4, 4, 4]);
  await fechar();
});

test("corretor desligado é pulado; só admin liga/desliga e libera lead", async () => {
  const { chamar, fechar } = await subir(envBase());
  assert.equal((await chamar("PATCH", "/v1/corretores/suelen", { token: TOK.suelen, corpo: { ativo: false } })).status, 403);
  const off = await chamar("PATCH", "/v1/corretores/suelen", { token: "tok-admin", corpo: { ativo: false } });
  assert.equal(off.status, 200);
  assert.equal(off.json.proximo.nome, "Marília");
  assert.equal((await chamar("PATCH", "/v1/corretores/nao-existe", { token: "tok-admin", corpo: { ativo: true } })).status, 404);
  assert.equal((await chamar("PATCH", "/v1/corretores/iara", { token: "tok-admin", corpo: { ativo: "sim" } })).status, 400);
  const a = await chamar("POST", "/v1/rodizio/assumir", { token: TOK.suelen, corpo: { leadId: "x" } });
  assert.equal(a.json.corretor.nome, "Marília");
  assert.equal((await chamar("POST", "/v1/leads/liberar", { token: TOK.suelen, corpo: { leadId: "x" } })).status, 403);
  assert.equal((await chamar("POST", "/v1/leads/liberar", { token: "tok-admin", corpo: { leadId: "x" } })).json.liberado, true);
  await fechar();
});

test("estado do rodízio sobrevive a reinício do servidor", async () => {
  const env = envBase();
  let srv = await subir(env);
  await srv.chamar("POST", "/v1/rodizio/assumir", { token: TOK.suelen, corpo: { leadId: "a" } });
  await srv.chamar("POST", "/v1/rodizio/assumir", { token: TOK.suelen, corpo: { leadId: "b" } });
  await srv.fechar();
  srv = await subir(env);
  const e = await srv.chamar("GET", "/v1/rodizio", { token: TOK.suelen });
  assert.equal(e.json.proximo.nome, "Iara");
  await srv.fechar();
});

test("o servidor não guarda o nome/telefone do lead", async () => {
  const env = envBase();
  const { chamar, fechar } = await subir(env);
  await chamar("POST", "/v1/rodizio/assumir", { token: TOK.suelen, corpo: { leadId: "Ana Souza 62999990000" } });
  await fechar();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(env.MAXIMUS_DB);
  const dump = JSON.stringify(db.prepare("SELECT * FROM atribuicoes").all());
  assert.ok(!/ana|souza|9999/i.test(dump), "dados pessoais apareceram no banco");
  db.close();
});

test("proxy da IA: troca o token pela chave real, limita tokens e modelo", async () => {
  const { chamar, fechar } = await subir(envBase());
  const ok = await chamar("POST", "/v1/messages", {
    token: TOK.suelen,
    corpo: { model: "claude-sonnet-5-5", max_tokens: 99999, system: "s", messages: [{ role: "user", content: "oi" }], stream: true, tools: [1] },
  });
  assert.equal(ok.status, 200);
  assert.equal(ultimoUpstream.headers["x-api-key"], "chave-real-secreta");
  assert.equal(ultimoUpstream.corpo.max_tokens, 800);
  assert.equal(ultimoUpstream.corpo.stream, undefined);
  assert.equal(ultimoUpstream.corpo.tools, undefined);
  const ruim = await chamar("POST", "/v1/messages", {
    token: TOK.suelen,
    corpo: { model: "outro-modelo", messages: [{ role: "user", content: "oi" }] },
  });
  assert.equal(ruim.status, 400);
  await fechar();
});

test("sem chave da IA configurada: 503; corpo grande: 413; JSON inválido: 400", async () => {
  const { chamar, fechar } = await subir(envBase({ ANTHROPIC_API_KEY: "" }));
  const msg = { model: "claude-sonnet-5-5", messages: [{ role: "user", content: "oi" }] };
  assert.equal((await chamar("POST", "/v1/messages", { token: TOK.suelen, corpo: msg })).status, 503);
  assert.equal((await chamar("POST", "/v1/rodizio/assumir", { token: TOK.suelen, corpo: "{quebrado" })).status, 400);
  const grande = await chamar("POST", "/v1/rodizio/assumir", { token: TOK.suelen, corpo: { leadId: "x", lixo: "a".repeat(70_000) } });
  assert.equal(grande.status, 413);
  await fechar();
});

test("limite de pedidos por minuto por pessoa: 429", async () => {
  const { chamar, fechar } = await subir(envBase({ MAXIMUS_LIMITE_POR_MINUTO: "3" }));
  const codigos = [];
  for (let i = 0; i < 5; i++) codigos.push((await chamar("GET", "/v1/rodizio", { token: TOK.suelen })).status);
  assert.deepEqual(codigos, [200, 200, 200, 429, 429]);
  assert.equal((await chamar("GET", "/v1/rodizio", { token: TOK.marilia })).status, 200); // outra pessoa não é afetada
  await fechar();
});

test("página de administração é servida sem token, com cabeçalhos de segurança", async () => {
  const { s, fechar } = await subir(envBase());
  const base = `http://127.0.0.1:${s.address().port}`;
  const html = await fetch(base + "/admin");
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type"), /text\/html/);
  assert.match(html.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(html.headers.get("x-content-type-options"), "nosniff");
  const corpo = await html.text();
  assert.ok(!/inline|onclick=|<script>[^<]/.test(corpo), "não pode ter script inline");
  assert.equal((await fetch(base + "/admin.js")).status, 200);
  assert.equal((await fetch(base + "/admin.css")).status, 200);
  await fechar();
});

test("resumo: só admin vê; conta leads por corretor (hoje e total)", async () => {
  const { chamar, fechar } = await subir(envBase());
  assert.equal((await chamar("GET", "/v1/admin/resumo", { token: TOK.suelen })).status, 403);
  assert.equal((await chamar("GET", "/v1/admin/resumo")).status, 401);
  for (const l of ["a", "b", "c"]) await chamar("POST", "/v1/rodizio/assumir", { token: TOK.suelen, corpo: { leadId: l } });
  const r = await chamar("GET", "/v1/admin/resumo", { token: "tok-admin" });
  assert.equal(r.status, 200);
  const por = Object.fromEntries(r.json.corretores.map((c) => [c.id, [c.hoje, c.total]]));
  assert.deepEqual(por.suelen, [1, 1]);
  assert.deepEqual(por.iara, [1, 1]);
  assert.deepEqual(por.guilherme, [0, 0]);
  assert.equal(r.json.proximo.nome, "Francine");
  await fechar();
});
