# Servidor compartilhado do Maximus Zap

Faz duas coisas para a equipe toda:
1. **Rodízio único** dos corretores (SQLite). Dois cliques ao mesmo tempo nunca pegam a mesma vez, e o
   mesmo lead sempre volta para o mesmo corretor.
2. **Guarda a chave da IA.** A extensão usa um token pessoal; só o servidor conhece a chave da Anthropic.

Sem dependências: precisa só de **Node 22+** (o SQLite embutido do Node ainda é "experimental").

## Rodar
```bash
export MAXIMUS_TOKENS="suelen:TOKEN1,marilia:TOKEN2,iara:TOKEN3,francine:TOKEN4,guilherme:TOKEN5"
export MAXIMUS_ADMIN_TOKEN="TOKEN-DA-LIDERANCA"
export ANTHROPIC_API_KEY="sk-ant-..."          # chave real, só no servidor
export MAXIMUS_SAL="texto-aleatorio-longo"      # sal do hash dos leads
export MAXIMUS_DB=/dados/maximus.db             # use um disco que persiste
node server/server.js                            # porta 8787 (PORT)
```
Gere tokens fortes: `openssl rand -hex 24` (um por pessoa). Para tirar alguém, remova o token e reinicie.

Docker: `docker build -t maximus-zap . && docker run -p 8787:8787 -v maximus-data:/data --env-file .env maximus-zap`.

**Publique atrás de HTTPS** (Render, Railway, Fly, VPS com Caddy/Nginx). O site do Maximus no GitHub Pages
não serve: ele só hospeda páginas estáticas. Use **1 instância só** (o SQLite é um arquivo).

## Página de administração
Abra `https://SEU-SERVIDOR/admin` (funciona bem no celular) e entre com o **token de administrador**.
- Vê quem é o **próximo da vez** e quantos leads cada corretor recebeu (hoje e total, horário de Brasília).
- **Liga/desliga corretor** com um toque (quem está desligado é pulado). Se todos forem desligados, aparece um alerta.
- **Solta um lead** pelo nome do contato, para ele ser entregue de novo.
- O token fica só na aba aberta (some ao fechar ou clicar em *Sair*). A página atualiza sozinha a cada 15 s.
- Segurança: a página em si é pública (não tem dado nenhum); tudo o que ela mostra vem de rotas que exigem o token.
  Tem política de conteúdo restrita (sem script de fora nem inline).

## Variáveis
| Nome | Para quê |
|---|---|
| `MAXIMUS_TOKENS` | `id:token` de cada corretor, separados por vírgula (ids de `config/equipe.json`) |
| `MAXIMUS_ADMIN_TOKEN` | liderança: liga/desliga corretor e libera lead |
| `ANTHROPIC_API_KEY` | chave da IA (sem ela, `/v1/messages` responde 503) |
| `MAXIMUS_MODELOS` | modelos permitidos, padrão `claude-sonnet-5-5` |
| `MAXIMUS_LIMITE_POR_MINUTO` | pedidos por pessoa por minuto, padrão 30 |
| `MAXIMUS_SAL`, `MAXIMUS_DB`, `PORT` | sal do hash, caminho do banco, porta |

## Rotas (cabeçalho `x-api-key: <token>`)
| Rota | Quem | O que faz |
|---|---|---|
| `GET /saude` | público | `{ok:true}` |
| `GET /v1/rodizio` | corretor | próximo da vez e lista (não avança) |
| `POST /v1/rodizio/assumir` `{leadId}` | corretor | atribui o próximo; repetido devolve o mesmo corretor |
| `GET /v1/admin/resumo` | admin | próximo da vez + leads por corretor (hoje e total) |
| `PATCH /v1/corretores/:id` `{ativo}` | admin | liga/desliga na fila (férias, folga) |
| `POST /v1/leads/liberar` `{leadId}` | admin | solta o lead para ser atribuído de novo |
| `POST /v1/messages` | corretor | proxy da IA: só `model`, `system`, `messages`; teto de 800 tokens |

Exemplo (desligar a Suelen hoje): `curl -X PATCH $URL/v1/corretores/suelen -H "x-api-key: $ADMIN" -H "content-type: application/json" -d '{"ativo":false}'`

## Privacidade e limites
- O banco guarda só um **hash** do identificador do lead (nome/telefone não ficam salvos) e qual corretor assumiu.
- O servidor não registra o texto das conversas; mas elas **passam por ele e pela Anthropic**: cite isso na política de privacidade (LGPD).
- O identificador do lead é o nome do contato no WhatsApp. Dois clientes com o mesmo nome caem no mesmo lead; contatos salvos com número são mais confiáveis. Se isso incomodar, use o `liberar`.
- Tokens vão por HTTPS; quem tiver o token usa a cota da IA: troque-o se vazar.
