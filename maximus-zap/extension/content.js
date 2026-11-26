// Content script do WhatsApp Web: lê a conversa aberta, mostra um painel e
// DEIXA O TEXTO NO CAMPO DE MENSAGEM. Não clica em "enviar" em nenhum caso.
(() => {
  if (window.__maximusZap) return;
  window.__maximusZap = true;

  // Seletores ficam todos aqui: se o WhatsApp mudar o layout, é só ajustar este bloco.
  const SEL = {
    conversa: "#main",
    titulo: "#main header span[title]",
    bolhas: "#main [data-pre-plain-text]",
    texto: "span.selectable-text",
    campo: '#main footer [contenteditable="true"]',
  };

  function lerConversa() {
    const titulo = document.querySelector(SEL.titulo)?.getAttribute("title") || "";
    const mensagens = [];
    for (const bolha of document.querySelectorAll(SEL.bolhas)) {
      const texto = bolha.querySelector(SEL.texto)?.innerText?.trim();
      if (!texto) continue; // figurinha, áudio, imagem sem legenda
      mensagens.push({ de: bolha.closest(".message-out") ? "equipe" : "cliente", texto });
    }
    return { contato: titulo, mensagens };
  }

  function inserirNoCampo(texto) {
    const campo = document.querySelector(SEL.campo);
    if (!campo) return false;
    campo.focus();
    document.execCommand("selectAll", false);
    const dt = new DataTransfer();
    dt.setData("text/plain", texto);
    campo.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    if (!campo.innerText.trim()) document.execCommand("insertText", false, texto); // plano B
    return true;
  }

  // ---------- Painel (Shadow DOM, para não brigar com o CSS do WhatsApp) ----------
  const host = document.createElement("div");
  host.id = "maximus-zap-host";
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const raiz = host.attachShadow({ mode: "open" });
  raiz.innerHTML = `
    <style>
      *{box-sizing:border-box;font-family:system-ui,Segoe UI,Roboto,sans-serif}
      .fab{background:#0b5d3b;color:#fff;border:0;border-radius:24px;padding:10px 16px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px #0005}
      .painel{display:none;width:340px;background:#fff;color:#111;border-radius:12px;box-shadow:0 4px 20px #0006;padding:12px;margin-bottom:8px}
      .painel.aberto{display:block}
      h4{margin:0 0 8px;font-size:14px}
      select,textarea,button{width:100%;font-size:13px;margin-top:6px}
      textarea{height:140px;padding:8px;border:1px solid #bbb;border-radius:8px;resize:vertical}
      .linha{display:flex;gap:6px}.linha button{margin-top:6px}
      button.b{background:#0b5d3b;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer}
      button.s{background:#eee;color:#111;border:0;border-radius:8px;padding:8px;cursor:pointer}
      button:disabled{opacity:.5;cursor:wait}
      .info{font-size:12px;color:#444;margin-top:6px;min-height:16px}
      .erro{color:#b00020}.aviso{color:#8a4b00}
    </style>
    <div class="painel" id="painel">
      <h4>Maximus Zap — sugestão para você aprovar</h4>
      <select id="agente">
        <option value="auto">Agente: automático</option>
        <option value="telefonista">Telefonista (1º contato)</option>
        <option value="trinity">Trinity (prospecção)</option>
        <option value="neo">Neo (negociação/crédito)</option>
      </select>
      <button class="b" id="sugerir">Sugerir resposta</button>
      <textarea id="texto" placeholder="A sugestão aparece aqui. Você pode editar."></textarea>
      <div class="linha">
        <button class="b" id="inserir">Colocar no campo</button>
        <button class="s" id="copiar">Copiar</button>
      </div>
      <button class="s" id="assumir">Assumir lead (avança o rodízio)</button>
      <div class="info" id="info"></div>
    </div>
    <button class="fab" id="fab">Maximus Zap</button>`;
  document.documentElement.appendChild(host);

  const $ = (id) => raiz.getElementById(id);
  const info = (msg, classe = "") => {
    const el = $("info");
    el.textContent = msg;
    el.className = "info " + classe;
  };

  $("fab").onclick = () => $("painel").classList.toggle("aberto");

  $("sugerir").onclick = async () => {
    const conversa = lerConversa();
    if (!conversa.mensagens.length) return info("Abra uma conversa com mensagens de texto.", "erro");
    $("sugerir").disabled = true;
    info("Pensando…");
    let r;
    try {
      r = await chrome.runtime.sendMessage({ tipo: "sugerir", ...conversa, agente: $("agente").value });
    } catch (e) {
      r = { erro: "A extensão foi atualizada. Recarregue a página do WhatsApp." };
    }
    $("sugerir").disabled = false;
    if (!r || r.erro) return info(r?.erro || "Sem resposta.", "erro");
    $("texto").value = r.texto;
    const partes = [`Agente: ${r.agente}`, `Temperatura: ${r.temperatura}`];
    if (r.corretor) partes.push(`Corretor da vez: ${r.corretor}`);
    partes.push(`${(r.ms / 1000).toFixed(1)} s`);
    let aviso = "";
    if (r.optout) aviso = " ⚠ Cliente pediu para parar: não envie mais vendas.";
    else if (r.escalar) aviso = " ⚠ Peça apoio da liderança.";
    info(partes.join(" · ") + aviso, aviso ? "aviso" : "");
  };

  $("inserir").onclick = () => {
    const texto = $("texto").value.trim();
    if (!texto) return info("Nada para colocar.", "erro");
    info(inserirNoCampo(texto) ? "No campo. Revise e envie você mesmo." : "Abra uma conversa primeiro.", "");
  };

  $("copiar").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("texto").value);
      info("Copiado.");
    } catch {
      info("Não consegui copiar. Selecione o texto e copie.", "erro");
    }
  };

  $("assumir").onclick = async () => {
    const r = await chrome.runtime.sendMessage({ tipo: "assumir" });
    info(r?.erro ? r.erro : `${r.corretor ?? "Ninguém"} assumiu. Próximo da vez: ${r.proximo ?? "-"}.`);
  };
})();
