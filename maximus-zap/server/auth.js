import { timingSafeEqual, createHash } from "node:crypto";

// MAXIMUS_TOKENS="suelen:tokenA,marilia:tokenB,..."  (um token por corretor)
// MAXIMUS_ADMIN_TOKEN="..."  (Wyguivan/André: liga/desliga corretor, libera lead)
export function lerTokens(env) {
  const corretores = new Map();
  for (const par of (env.MAXIMUS_TOKENS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = par.indexOf(":");
    if (i > 0) corretores.set(par.slice(0, i), par.slice(i + 1));
  }
  return { corretores, admin: env.MAXIMUS_ADMIN_TOKEN || "" };
}

// Compara hashes de tamanho fixo em tempo constante (não vaza o tamanho do token).
const igual = (a, b) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

// Devolve { quem, admin } ou null. Aceita o token em x-api-key (usado pela extensão) ou Authorization: Bearer.
export function autenticar(req, tokens) {
  const bruto = req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bruto) return null;
  if (tokens.admin && igual(bruto, tokens.admin)) return { quem: "admin", admin: true };
  for (const [id, tok] of tokens.corretores) if (igual(bruto, tok)) return { quem: id, admin: false };
  return null;
}
