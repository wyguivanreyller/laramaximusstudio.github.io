// Banco SQLite do rodízio compartilhado. Toda atribuição é uma transação única,
// então dois corretores clicando ao mesmo tempo nunca recebem o mesmo lugar da fila.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { Rodizio } from "../src/roteador.js";

// Não guardamos nome nem telefone do lead: só um hash (minimização de dados, LGPD).
export const hashLead = (leadId, sal = "") =>
  createHash("sha256").update(`${sal}|${String(leadId).trim().toLowerCase()}`).digest("hex");

export function abrirBanco(caminho, corretoresIniciais, sal = "") {
  const db = new DatabaseSync(caminho);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS corretores (
      id TEXT PRIMARY KEY, nome TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1, ordem INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS estado (chave TEXT PRIMARY KEY, valor INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS atribuicoes (
      lead_hash TEXT PRIMARY KEY, corretor_id TEXT NOT NULL, criado_em TEXT NOT NULL, por TEXT NOT NULL
    );
    INSERT OR IGNORE INTO estado (chave, valor) VALUES ('indice', 0);
  `);
  const semear = db.prepare("INSERT OR IGNORE INTO corretores (id, nome, ativo, ordem) VALUES (?, ?, ?, ?)");
  corretoresIniciais.forEach((c, i) => semear.run(c.id, c.nome, c.ativo ? 1 : 0, i));

  const listar = () =>
    db.prepare("SELECT id, nome, ativo FROM corretores ORDER BY ordem").all().map((c) => ({ ...c, ativo: !!c.ativo }));
  const lerIndice = () => db.prepare("SELECT valor FROM estado WHERE chave='indice'").get().valor;

  // Executa fn dentro de uma transação exclusiva (BEGIN IMMEDIATE).
  function transacao(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  return {
    corretores: listar,

    estado() {
      const r = new Rodizio(listar(), lerIndice());
      return { proximo: r.espiar(), corretores: listar() };
    },

    // Idempotente: o mesmo lead sempre volta para o mesmo corretor.
    assumir(leadId, por) {
      const h = hashLead(leadId, sal);
      return transacao(() => {
        const existente = db.prepare("SELECT corretor_id FROM atribuicoes WHERE lead_hash=?").get(h);
        const rodizio = new Rodizio(listar(), lerIndice());
        if (existente) {
          const c = listar().find((x) => x.id === existente.corretor_id);
          return { corretor: c, jaAtribuido: true, proximo: rodizio.espiar() };
        }
        const corretor = rodizio.proximo();
        if (!corretor) return { corretor: null, jaAtribuido: false, proximo: null };
        db.prepare("UPDATE estado SET valor=? WHERE chave='indice'").run(rodizio.estado().indice);
        db.prepare("INSERT INTO atribuicoes (lead_hash, corretor_id, criado_em, por) VALUES (?,?,?,?)").run(
          h,
          corretor.id,
          new Date().toISOString(),
          por,
        );
        return { corretor, jaAtribuido: false, proximo: rodizio.espiar() };
      });
    },

    // Quantos leads cada corretor recebeu (total e hoje, no horário de Brasília, UTC-3).
    resumo() {
      const BRT = 3 * 3600_000;
      const inicioHoje = new Date(Math.floor((Date.now() - BRT) / 86_400_000) * 86_400_000 + BRT).toISOString();
      const contar = (sql, ...args) =>
        Object.fromEntries(db.prepare(sql).all(...args).map((r) => [r.corretor_id, r.n]));
      const total = contar("SELECT corretor_id, COUNT(*) AS n FROM atribuicoes GROUP BY corretor_id");
      const hoje = contar("SELECT corretor_id, COUNT(*) AS n FROM atribuicoes WHERE criado_em >= ? GROUP BY corretor_id", inicioHoje);
      const { proximo } = this.estado();
      return {
        proximo,
        corretores: listar().map((c) => ({ ...c, total: total[c.id] || 0, hoje: hoje[c.id] || 0 })),
      };
    },

    liberar(leadId) {
      return db.prepare("DELETE FROM atribuicoes WHERE lead_hash=?").run(hashLead(leadId, sal)).changes > 0;
    },

    definirAtivo(id, ativo) {
      return db.prepare("UPDATE corretores SET ativo=? WHERE id=?").run(ativo ? 1 : 0, id).changes > 0;
    },

    fechar: () => db.close(),
  };
}
