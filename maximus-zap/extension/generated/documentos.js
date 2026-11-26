// Protocolo estrito de coleta de documentos (CCA / análise de crédito).
// A lista é fixa: não adicionar nem remover itens sem ordem do gerente.
export const LISTA_DOCUMENTOS = Object.freeze([
  "Documentos pessoais (RG/CNH e CPF)",
  "Certidão de estado civil atualizada (Certidão de Nascimento, Certidão de Casamento ou Certidão de Casamento com averbação de divórcio)",
  "Carteira de Trabalho Digital (espelho completo da carteira digital)",
  "Últimos 3 contracheques",
  "Últimos 3 extratos bancários",
  "E-mail e telefone para contato",
]);

export function formatarListaDocumentos() {
  return LISTA_DOCUMENTOS.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

const PEDIDO_DOCUMENTOS =
  /(document|papel|papeis|papéis|o que (eu )?(preciso|precisa|levar|enviar|mandar)|lista de|o que devo (levar|enviar|mandar))/i;

// true quando o cliente está pedindo a documentação necessária.
export function pediuDocumentos(texto = "") {
  return PEDIDO_DOCUMENTOS.test(texto);
}

export function mensagemDocumentos(nome) {
  const saudacao = nome ? `${nome}, ` : "";
  return (
    `${saudacao}para a análise de crédito preciso destes documentos ` +
    `(uso apenas para a análise):\n\n${formatarListaDocumentos()}\n\n` +
    "Pode mandar por foto ou PDF, aos poucos. Vou conferindo cada item com você."
  );
}
