# Maximus Zap

Cérebro do CRM de WhatsApp da **MyBroker Independência** (Goiânia e Aparecida de Goiânia), operado
pela **Equipe Maximus** (Wyguivan Reyller e André Fernandes). Aqui ficam os agentes, as regras de
atendimento e a lógica de roteamento. A tela/extensão do WhatsApp Web consome este pacote.

## Agentes

| Agente | Papel | Etapas do funil |
|---|---|---|
| **Telefonista** | Primeira resposta em até **7 s**, triagem de temperatura, rodízio de corretores | entrada do lead |
| **Trinity** | Prospecção, qualificação, reativação, condução até a visita | novo, qualificacao, reativacao, visita |
| **Neo** | Negociação, crédito (CCA), fechamento, pós-venda | negociacao, credito, fechado, posVenda |

A divisão Trinity/Neo está em `config/equipe.json` e pode ser ajustada sem mexer em código.

## Estrutura

```
config/equipe.json       equipe, corretores, SLA, portfólio, régua de pós-venda
prompts/base.md          regras e estilo válidos para todos os agentes
prompts/{trinity,neo,telefonista}.md   persona de cada agente
prompts/modulos/*.md     conhecimento: vendas+DISC, crédito/CCA, jurídico/cartório,
                         portfólio, comunicação, pós-venda+storytelling
src/agentes.js           montarPrompt(agente, { lead, dadosMercado })
src/roteador.js          temperatura, rodízio, SLA, escolha de agente, régua de pós-venda
src/documentos.js        lista oficial de documentos (CCA) e detecção do pedido
test/                    testes (npm test)
```

## Uso

```js
import { montarPrompt, Rodizio, carregarConfig, triagem, pediuDocumentos, mensagemDocumentos } from "./src/index.js";

const config = carregarConfig();
const rodizio = new Rodizio(config.corretores, estadoSalvo?.indice ?? 0);

const t = triagem({ texto: "Posso visitar amanhã?" }, rodizio);   // { temperatura, etapa, agente, corretor }
const sistema = montarPrompt(t.agente, { lead: { nome: "Ana", corretor: t.corretor.nome } });
// envie `sistema` como prompt de sistema ao modelo e a mensagem do cliente como mensagem do usuário

if (pediuDocumentos(texto)) enviar(mensagemDocumentos("Ana"));     // lista oficial, sem alterar itens
salvar(rodizio.estado());                                          // guarde o índice do rodízio
```

Rodar os testes: `npm test` (Node 20+).

## Decisões e cuidados

- **Nada inventado:** os prompts proíbem citar preço, taxa, prazo ou metragem que não estejam no
  contexto. Só o Parque América Trancoso tem dados verificados (vindos do `CLAUDE.md` do Maximus).
  Os demais empreendimentos estão marcados "sem dados no sistema" até alguém anexar o book.
- **Crédito, juros, ITBI e custos de cartório** não têm números fixos nos prompts: mudam com o tempo.
- **Honestidade:** a IA se identifica se o cliente perguntar sinceramente; pede-se documentos só com
  interesse real e aviso de uso (LGPD); pedido de parar (`optout`) é respeitado.
- **Lista de documentos** protegida por teste: qualquer mudança nos 6 itens quebra o `npm test`.

## O que falta para ir ao ar

1. **Integração com o WhatsApp Web** (extensão do Chrome ou API oficial). O código atual não envia nem
   lê mensagens. Recomendo começar com **sugestão de resposta para o corretor aprovar**; enviar
   automático pelo WhatsApp Web pode violar os termos do WhatsApp e gerar bloqueio do número.
   Para automação total, a opção segura é a **WhatsApp Business API**.
2. **Persistência** do CRM (leads, etapa, estado do rodízio) e **chave do modelo de IA**.
3. **Prova de 7 s:** medir `dentroDoSla` em produção; a resposta da Telefonista deve ser curta para caber.
4. **Books** dos demais empreendimentos para liberar dados verificados.
