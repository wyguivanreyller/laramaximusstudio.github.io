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
server/                  servidor da equipe: rodízio único + proxy da IA
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

## Extensão do Chrome (modo sugerir resposta)

Pasta `extension/`. Ela **nunca envia** mensagem: lê a conversa aberta no WhatsApp Web, pede a
sugestão ao agente certo e coloca o texto no campo para o corretor revisar e enviar.

**Instalar (no computador, Chrome):**
1. Abra `chrome://extensions`, ligue **Modo do desenvolvedor**.
2. **Carregar sem compactação** e escolha a pasta `maximus-zap/extension`.
3. Em **Detalhes → Opções da extensão**, cole a chave da IA e salve.
4. Abra o WhatsApp Web, entre numa conversa e clique em **Maximus Zap** (canto inferior direito).

**Botões:** *Sugerir resposta* · *Colocar no campo* (não envia) · *Copiar* · *Assumir lead* (avança o rodízio).
Pedido de documentos é respondido direto com a lista oficial, sem chamar a IA.

Depois de mudar prompts ou config: `npm run build:extension` e recarregue a extensão.
Teste ponta a ponta (página imitando o WhatsApp + API falsa): `node scripts/e2e-extension.mjs`.

**Limites honestos:**
- Foi testada só contra uma página que imita o WhatsApp, **não contra o WhatsApp real**. Os seletores
  ficam no topo de `extension/content.js`; se o WhatsApp mudar o layout, ajuste ali.
- Lê só mensagens de texto (áudio, imagem e figurinha são ignorados).
- A conversa recente (12 mensagens por padrão) vai para a API da IA: avise os clientes na política
  de privacidade (LGPD). A chave fica no navegador; o ideal é um servidor da equipe no meio
  (campo "Endereço da API" nas opções).
- Sem servidor, o rodízio é guardado por navegador (cada corretor tem o seu). Com o **servidor da equipe**
  (`server/`, veja `server/README.md`), o rodízio é único e a chave da IA fica só no servidor:
  preencha *Endereço do servidor* e *Token* nas opções.

## Decisões e cuidados

- **Nada inventado:** os prompts proíbem citar preço, taxa, prazo ou metragem que não estejam no
  contexto. Só o Parque América Trancoso tem dados verificados (vindos do `CLAUDE.md` do Maximus).
  Os demais empreendimentos estão marcados "sem dados no sistema" até alguém anexar o book.
- **Crédito, juros, ITBI e custos de cartório** não têm números fixos nos prompts: mudam com o tempo.
- **Honestidade:** a IA se identifica se o cliente perguntar sinceramente; pede-se documentos só com
  interesse real e aviso de uso (LGPD); pedido de parar (`optout`) é respeitado.
- **Lista de documentos** protegida por teste: qualquer mudança nos 6 itens quebra o `npm test`.

## O que falta para ir ao ar

1. **Testar no WhatsApp real** e ajustar seletores; depois, se quiserem automação total, a opção segura é a
   **WhatsApp Business API** (enviar automático pelo WhatsApp Web pode bloquear o número).
2. **Publicar o servidor** (`server/`) em um endereço com HTTPS e entregar um token a cada corretor.
3. **Prova de 7 s:** medir `dentroDoSla` em produção; a resposta da Telefonista deve ser curta para caber.
4. **Books** dos demais empreendimentos para liberar dados verificados.
