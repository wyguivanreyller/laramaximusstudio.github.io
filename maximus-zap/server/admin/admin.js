// Página de administração do Maximus Zap. Só usa textContent (nenhum HTML vindo do servidor).
const $ = (id) => document.getElementById(id);
const CHAVE = "mzAdminToken";
let token = "";
try { token = sessionStorage.getItem(CHAVE) || ""; } catch { /* navegação privada: segue sem guardar */ }
let timer = null;

function aviso(texto, erro = false) {
  const el = $("mensagem");
  el.textContent = texto;
  el.className = "mensagem" + (erro ? " erro" : "");
}

function sair(texto) {
  token = "";
  try { sessionStorage.removeItem(CHAVE); } catch { /* ok */ }
  clearInterval(timer);
  $("painel").hidden = true;
  $("sair").hidden = true;
  $("entrada").hidden = false;
  $("token").value = "";
  aviso(texto || "", Boolean(texto));
}

async function api(metodo, rota, corpo) {
  const r = await fetch(rota, {
    method: metodo,
    headers: { "content-type": "application/json", "x-api-key": token },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (r.status === 401) { sair("Token inválido. Confira e tente de novo."); throw new Error("401"); }
  if (r.status === 403) { sair("Este token não é de administrador."); throw new Error("403"); }
  if (!r.ok) throw new Error(json.erro || `Erro ${r.status}`);
  return json;
}

function desenhar(resumo) {
  const prox = $("proximo");
  prox.replaceChildren();
  const rotulo = document.createElement("div");
  rotulo.className = "rotulo";
  const nome = document.createElement("div");
  nome.className = "nome";
  if (resumo.proximo) {
    rotulo.textContent = "Próximo da vez";
    nome.textContent = resumo.proximo.nome;
    prox.className = "cartao destaque";
  } else {
    rotulo.textContent = "Atenção";
    nome.textContent = "Ninguém está ativo. Os leads não serão distribuídos.";
    prox.className = "cartao destaque alerta";
  }
  prox.append(rotulo, nome);

  const lista = $("lista");
  lista.replaceChildren();
  for (const c of resumo.corretores) {
    const li = document.createElement("li");
    li.className = "item" + (c.ativo ? "" : " desligado");

    const bloco = document.createElement("div");
    const n = document.createElement("div");
    n.className = "nome";
    n.textContent = c.nome;
    const info = document.createElement("div");
    info.className = "info";
    info.textContent = `Hoje: ${c.hoje} · Total: ${c.total}`;
    bloco.append(n, info);

    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "chave";
    botao.setAttribute("role", "switch");
    botao.setAttribute("aria-checked", String(c.ativo));
    botao.setAttribute("aria-label", `${c.nome} na fila`);
    const bolinha = document.createElement("span");
    bolinha.className = "bolinha";
    const txt = document.createElement("span");
    txt.textContent = c.ativo ? "Ligado" : "Desligado";
    botao.append(bolinha, txt);
    botao.onclick = () => alternar(c, botao);

    li.append(bloco, botao);
    lista.append(li);
  }
  $("atualizado").textContent = "Atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

async function carregar() {
  try {
    desenhar(await api("GET", "/v1/admin/resumo"));
  } catch (e) {
    if (!["401", "403"].includes(e.message)) aviso("Não consegui atualizar: " + e.message, true);
  }
}

async function alternar(corretor, botao) {
  botao.disabled = true;
  try {
    await api("PATCH", `/v1/corretores/${encodeURIComponent(corretor.id)}`, { ativo: !corretor.ativo });
    aviso(`${corretor.nome} ${corretor.ativo ? "saiu da fila" : "voltou para a fila"}.`);
  } catch (e) {
    if (!["401", "403"].includes(e.message)) aviso(e.message, true);
  }
  await carregar();
}

function entrar() {
  $("entrada").hidden = true;
  $("painel").hidden = false;
  $("sair").hidden = false;
  aviso("");
  carregar();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) carregar(); }, 15000);
}

$("form-entrada").onsubmit = (e) => {
  e.preventDefault();
  token = $("token").value.trim();
  try { sessionStorage.setItem(CHAVE, token); } catch { /* ok */ }
  entrar();
};

$("form-liberar").onsubmit = async (e) => {
  e.preventDefault();
  const lead = $("lead").value.trim();
  if (!lead || !confirm(`Soltar o lead "${lead}"? Ele poderá ser atribuído de novo.`)) return;
  try {
    const r = await api("POST", "/v1/leads/liberar", { leadId: lead });
    aviso(r.liberado ? "Lead solto." : "Não achei esse lead (confira o nome).", !r.liberado);
    if (r.liberado) $("lead").value = "";
  } catch (err) {
    if (!["401", "403"].includes(err.message)) aviso(err.message, true);
  }
};

$("sair").onclick = () => sair("");
if (token) entrar();
