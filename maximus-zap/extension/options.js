const CAMPOS = ["servidorUrl", "token", "apiKey", "modelo", "maxMensagens", "apiUrl"];
const el = (id) => document.getElementById(id);

chrome.storage.local.get(CAMPOS).then((salvo) => {
  for (const c of CAMPOS) if (salvo[c] !== undefined) el(c).value = salvo[c];
});

el("salvar").onclick = async () => {
  const valores = {};
  for (const c of CAMPOS) valores[c] = el(c).value.trim();
  await chrome.storage.local.set(valores);
  el("ok").textContent = "Salvo ✔";
  setTimeout(() => (el("ok").textContent = ""), 2000);
};
