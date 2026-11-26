// Servidor compartilhado do Maximus Zap (Node 22+, sem dependências).
//  - Rodízio único da equipe (SQLite, transação atômica, idempotente por lead)
//  - Proxy da IA: a chave da Anthropic fica SÓ aqui; a extensão usa um token por corretor.
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { abrirBanco } from "./db.js";
import { autenticar, lerTokens } from "./auth.js";

const aqui = dirname(fileURLToPath(import.meta.url));
// Página de administração (arquivos estáticos lidos uma vez na partida).
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ESTATICOS = {
  "/admin": ["index.html", "text/html; charset=utf-8"],
  "/admin.js": ["admin.js", "text/javascript; charset=utf-8"],
  "/admin.css": ["admin.css", "text/css; charset=utf-8"],
};
const LIMITE_CORPO = 64 * 1024;
const MAX_TOKENS_TETO = 800;
const JANELA_MS = 60_000;

export function criarServidor(env = process.env) {
  const config = JSON.parse(readFileSync(join(aqui, "..", "config", "equipe.json"), "utf8"));
  const tokens = lerTokens(env);
  const banco = abrirBanco(env.MAXIMUS_DB || join(aqui, "maximus.db"), config.corretores, env.MAXIMUS_SAL || "");
  const modelos = (env.MAXIMUS_MODELOS || "claude-sonnet-5-5").split(",").map((s) => s.trim());
  const upstream = env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages";
  const limitePorMinuto = Number(env.MAXIMUS_LIMITE_POR_MINUTO || 30);
  const uso = new Map(); // quem -> [timestamps]

  const paginas = Object.fromEntries(
    Object.entries(ESTATICOS).map(([rota, [arq, tipo]]) => [rota, { tipo, corpo: readFileSync(join(aqui, "admin", arq)) }]),
  );

  const cors = {
    "access-control-allow-origin": "*", // sem cookies: a proteção é o token
    "access-control-allow-headers": "content-type, x-api-key, authorization, anthropic-version",
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
  };
  const enviar = (res, status, obj) => {
    res.writeHead(status, { ...cors, "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };

  function limitar(quem) {
    const agora = Date.now();
    const recentes = (uso.get(quem) || []).filter((t) => agora - t < JANELA_MS);
    recentes.push(agora);
    uso.set(quem, recentes);
    return recentes.length <= limitePorMinuto;
  }

  function lerCorpo(req) {
    return new Promise((resolve, reject) => {
      let tamanho = 0;
      let estourou = false;
      const partes = [];
      req.on("data", (c) => {
        if (estourou) return; // descarta o resto sem guardar na memória
        tamanho += c.length;
        if (tamanho > LIMITE_CORPO) {
          estourou = true;
          reject(Object.assign(new Error("Corpo grande demais"), { status: 413 }));
          return;
        }
        partes.push(c);
      });
      req.on("end", () => {
        if (estourou) return;
        try {
          resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString("utf8")) : {});
        } catch {
          reject(Object.assign(new Error("JSON inválido"), { status: 400 }));
        }
      });
      req.on("error", reject);
    });
  }

  async function proxyIA(corpo, res) {
    if (!env.ANTHROPIC_API_KEY) return enviar(res, 503, { erro: "Servidor sem chave da IA configurada." });
    const { model, system, messages } = corpo;
    if (!modelos.includes(model)) return enviar(res, 400, { erro: `Modelo não permitido. Use: ${modelos.join(", ")}` });
    if (!Array.isArray(messages) || !messages.length) return enviar(res, 400, { erro: "messages obrigatório" });
    const max_tokens = Math.min(Number(corpo.max_tokens) || 400, MAX_TOKENS_TETO);
    try {
      const r = await fetch(upstream, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        // Só repassa campos conhecidos (sem stream, sem tools).
        body: JSON.stringify({ model, max_tokens, system, messages }),
        signal: AbortSignal.timeout(30_000),
      });
      res.writeHead(r.status, { ...cors, "content-type": "application/json; charset=utf-8" });
      res.end(await r.text());
    } catch {
      enviar(res, 502, { erro: "Falha ao falar com a IA." });
    }
  }

  const servidor = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
      const url = new URL(req.url, "http://x");
      const rota = url.pathname;

      if (req.method === "GET" && paginas[rota]) {
        res.writeHead(200, {
          "content-type": paginas[rota].tipo,
          "content-security-policy": CSP,
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "cache-control": "no-store",
        });
        return res.end(paginas[rota].corpo);
      }

      if (req.method === "GET" && rota === "/saude") return enviar(res, 200, { ok: true });

      const quem = autenticar(req, tokens);
      if (!quem) return enviar(res, 401, { erro: "Token inválido ou ausente." });
      if (!limitar(quem.quem)) return enviar(res, 429, { erro: "Muitos pedidos. Aguarde um minuto." });

      if (req.method === "GET" && rota === "/v1/admin/resumo") {
        if (!quem.admin) return enviar(res, 403, { erro: "Só a liderança vê o resumo." });
        return enviar(res, 200, banco.resumo());
      }

      if (req.method === "GET" && rota === "/v1/rodizio") return enviar(res, 200, banco.estado());

      if (req.method === "POST" && rota === "/v1/rodizio/assumir") {
        const { leadId } = await lerCorpo(req);
        if (!leadId || String(leadId).length > 200) return enviar(res, 400, { erro: "leadId obrigatório (até 200 caracteres)." });
        return enviar(res, 200, banco.assumir(leadId, quem.quem));
      }

      if (req.method === "POST" && rota === "/v1/leads/liberar") {
        if (!quem.admin) return enviar(res, 403, { erro: "Só a liderança pode liberar um lead." });
        const { leadId } = await lerCorpo(req);
        return enviar(res, 200, { liberado: !!leadId && banco.liberar(leadId) });
      }

      const mCorretor = rota.match(/^\/v1\/corretores\/([a-z0-9_-]+)$/);
      if (req.method === "PATCH" && mCorretor) {
        if (!quem.admin) return enviar(res, 403, { erro: "Só a liderança pode ligar/desligar corretor." });
        const { ativo } = await lerCorpo(req);
        if (typeof ativo !== "boolean") return enviar(res, 400, { erro: "ativo deve ser true ou false." });
        if (!banco.definirAtivo(mCorretor[1], ativo)) return enviar(res, 404, { erro: "Corretor não encontrado." });
        return enviar(res, 200, banco.estado());
      }

      if (req.method === "POST" && rota === "/v1/messages") return proxyIA(await lerCorpo(req), res);

      enviar(res, 404, { erro: "Rota não encontrada." });
    } catch (e) {
      if (e.status === 413) res.setHeader("connection", "close");
      enviar(res, e.status || 500, { erro: e.status ? e.message : "Erro interno." });
    }
  });
  servidor.on("close", () => banco.fechar());
  return servidor;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const porta = Number(process.env.PORT || 8787);
  if (!process.env.MAXIMUS_TOKENS && !process.env.MAXIMUS_ADMIN_TOKEN) {
    console.error("Defina MAXIMUS_TOKENS e/ou MAXIMUS_ADMIN_TOKEN. Veja server/README.md.");
    process.exit(1);
  }
  criarServidor().listen(porta, () => console.log(`Maximus Zap server na porta ${porta}`));
}
