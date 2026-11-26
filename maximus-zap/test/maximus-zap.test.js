import { test } from "node:test";
import assert from "node:assert/strict";
import {
  montarPrompt,
  carregarConfig,
  classificarTemperatura,
  Rodizio,
  dentroDoSla,
  escolherAgente,
  passoPosVenda,
  triagem,
  LISTA_DOCUMENTOS,
  formatarListaDocumentos,
  pediuDocumentos,
  mensagemDocumentos,
} from "../src/index.js";

const config = carregarConfig();

test("lista de documentos tem exatamente os 6 itens do protocolo", () => {
  assert.equal(LISTA_DOCUMENTOS.length, 6);
  assert.equal(LISTA_DOCUMENTOS[0], "Documentos pessoais (RG/CNH e CPF)");
  assert.equal(LISTA_DOCUMENTOS[2], "Carteira de Trabalho Digital (espelho completo da carteira digital)");
  assert.equal(LISTA_DOCUMENTOS[5], "E-mail e telefone para contato");
  assert.match(formatarListaDocumentos(), /^1\. Documentos pessoais/);
  assert.match(formatarListaDocumentos(), /6\. E-mail e telefone para contato$/);
});

test("detecta pedido de documentos e responde com a lista", () => {
  assert.ok(pediuDocumentos("Quais documentos eu preciso levar?"));
  assert.ok(pediuDocumentos("o que preciso enviar?"));
  assert.ok(!pediuDocumentos("Qual o valor do apartamento?"));
  const msg = mensagemDocumentos("Carlos");
  assert.ok(msg.startsWith("Carlos,"));
  for (const item of LISTA_DOCUMENTOS) assert.ok(msg.includes(item));
});

test("rodízio percorre os 5 corretores em ordem e volta ao início", () => {
  const r = new Rodizio(config.corretores);
  const ordem = Array.from({ length: 6 }, () => r.proximo().nome);
  assert.deepEqual(ordem, ["Suelen", "Marília", "Iara", "Francine", "Guilherme", "Suelen"]);
});

test("rodízio pula corretor inativo e retorna null se ninguém ativo", () => {
  const corretores = config.corretores.map((c) => ({ ...c, ativo: c.id !== "marilia" }));
  const r = new Rodizio(corretores);
  assert.equal(r.proximo().nome, "Suelen");
  assert.equal(r.proximo().nome, "Iara");
  const nenhum = new Rodizio(config.corretores.map((c) => ({ ...c, ativo: false })));
  assert.equal(nenhum.proximo(), null);
});

test("rodízio pode ser retomado a partir do estado salvo", () => {
  const r = new Rodizio(config.corretores);
  r.proximo();
  r.proximo();
  const retomado = new Rodizio(config.corretores, r.estado().indice);
  assert.equal(retomado.proximo().nome, "Iara");
});

test("classifica temperatura do lead", () => {
  assert.equal(classificarTemperatura("Quero visitar amanhã, qual a entrada?"), "quente");
  assert.equal(classificarTemperatura("Oi, vi o anúncio"), "morno");
  assert.equal(classificarTemperatura("só o preço, sem pressa"), "frio");
  assert.equal(classificarTemperatura("oi", { diasSemResposta: 12 }), "frio");
});

test("SLA da primeira resposta é de 7 segundos", () => {
  assert.equal(config.sla.primeiraRespostaMs, 7000);
  assert.ok(dentroDoSla(0, 7000, config.sla.primeiraRespostaMs));
  assert.ok(!dentroDoSla(0, 7001, config.sla.primeiraRespostaMs));
});

test("etapas vão para o agente certo", () => {
  assert.equal(escolherAgente("novo"), "trinity");
  assert.equal(escolherAgente("reativacao"), "trinity");
  assert.equal(escolherAgente("credito"), "neo");
  assert.equal(escolherAgente("posVenda"), "neo");
  assert.equal(escolherAgente("etapa-que-nao-existe"), "trinity");
});

test("triagem de lead quente sobe para qualificação e distribui corretor", () => {
  const r = new Rodizio(config.corretores);
  const t = triagem({ texto: "Posso visitar hoje?" }, r);
  assert.equal(t.temperatura, "quente");
  assert.equal(t.etapa, "qualificacao");
  assert.equal(t.agente, "trinity");
  assert.equal(t.corretor.nome, "Suelen");
});

test("régua de pós-venda devolve o último passo vencido", () => {
  assert.equal(passoPosVenda(0), null);
  assert.equal(passoPosVenda(1).diaApos, 1);
  assert.equal(passoPosVenda(45).diaApos, 30);
  assert.equal(passoPosVenda(400).diaApos, 365);
});

for (const agente of ["trinity", "neo", "telefonista"]) {
  test(`prompt do ${agente} é montado sem placeholders soltos`, () => {
    const p = montarPrompt(agente);
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(p), "sobrou placeholder");
    assert.ok(p.includes("MyBroker Independência"));
    assert.ok(p.includes("Wyguivan Reyller e André Fernandes"));
    assert.ok(p.includes(formatarListaDocumentos()), "falta a lista oficial de documentos");
    assert.ok(p.includes("Suelen, Marília, Iara, Francine, Guilherme"));
  });
}

test("Trinity e Neo têm focos diferentes; Telefonista usa o SLA de 7 segundos", () => {
  assert.match(montarPrompt("trinity"), /Prospecção, qualificação, reativação/);
  assert.match(montarPrompt("neo"), /Negociação, crédito \(CCA\), fechamento e pós-venda/);
  assert.match(montarPrompt("telefonista"), /\*\*até 7 segundos\*\*/);
});

test("prompt traz as regras anti-invenção e o portfólio com status de dados", () => {
  const p = montarPrompt("neo");
  assert.match(p, /Não invente nada/);
  assert.match(p, /Parque América Trancoso: dados verificados/);
  assert.match(p, /Natuá by PLANO&PLANO: sem dados no sistema/);
  assert.match(p, /sinal de R\$ 500/);
});

test("contexto do lead e dados de mercado entram só quando informados", () => {
  const sem = montarPrompt("trinity");
  assert.match(sem, /Dados de mercado fornecidos: nenhum/);
  const com = montarPrompt("trinity", {
    lead: { nome: "Ana", disc: "S", empreendimento: "Parque América Trancoso" },
    dadosMercado: ["Dado de teste informado pela equipe"],
  });
  assert.match(com, /Nome: Ana/);
  assert.match(com, /Dado de teste informado pela equipe/);
});

test("agente desconhecido gera erro claro", () => {
  assert.throws(() => montarPrompt("morpheus"), /Agente desconhecido/);
});
