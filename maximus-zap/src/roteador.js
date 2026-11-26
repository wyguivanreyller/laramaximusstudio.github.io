// Lógica pura (sem Node): roda igual no servidor e dentro da extensão do Chrome.

// ---------- Triagem de temperatura (apoio rápido; o agente refina depois) ----------
const SINAIS_QUENTE =
  /(visitar|visita|conhecer|hoje|amanh[ãa]|entrada|parcela|simula|document|fechar|proposta|sinal|quero comprar|posso ir)/i;
const SINAIS_FRIO = /(s[óo] (olhando|curiosidade)|talvez|depois|sem pressa|s[óo] o pre[çc]o|s[óo] pra saber)/i;

export function classificarTemperatura(texto = "", { diasSemResposta = 0 } = {}) {
  if (diasSemResposta >= 10) return "frio";
  if (SINAIS_QUENTE.test(texto)) return "quente";
  if (SINAIS_FRIO.test(texto) || diasSemResposta >= 5) return "frio";
  return "morno";
}

// ---------- Rodízio (round-robin) de corretores ----------
export class Rodizio {
  constructor(corretores, indice = 0) {
    this.corretores = corretores;
    this.indice = indice % Math.max(corretores.length, 1);
  }

  // Devolve o próximo corretor ATIVO; null se ninguém estiver ativo.
  proximo() {
    const total = this.corretores.length;
    for (let i = 0; i < total; i++) {
      const candidato = this.corretores[(this.indice + i) % total];
      if (candidato.ativo) {
        this.indice = (this.indice + i + 1) % total;
        return candidato;
      }
    }
    return null;
  }

  // Quem seria o próximo ativo, SEM avançar o rodízio (para só mostrar na tela).
  espiar() {
    const total = this.corretores.length;
    for (let i = 0; i < total; i++) {
      const candidato = this.corretores[(this.indice + i) % total];
      if (candidato.ativo) return candidato;
    }
    return null;
  }

  // Estado simples para salvar no CRM entre execuções.
  estado() {
    return { indice: this.indice };
  }
}

// ---------- SLA da primeira resposta ----------
export function dentroDoSla(recebidoEmMs, respondidoEmMs, limiteMs = 7000) {
  return respondidoEmMs - recebidoEmMs <= limiteMs;
}

// ---------- Escolha do agente pela etapa do funil ----------
export function escolherAgente(etapa, config) {
  for (const [id, agente] of Object.entries(config.agentes)) {
    if (agente.etapas.includes(etapa)) return id;
  }
  return "trinity"; // lead sem etapa definida começa com a Trinity
}

// ---------- Pós-venda: qual passo da régua está vencido ----------
export function passoPosVenda(diasDesdeFechamento, config) {
  const vencidos = config.posVenda.passos.filter((p) => p.diaApos <= diasDesdeFechamento);
  return vencidos.length ? vencidos[vencidos.length - 1] : null;
}

// ---------- Triagem completa da Telefonista ----------
export function triagem({ texto, diasSemResposta = 0, etapa = "novo" }, rodizio, config) {
  const temperatura = classificarTemperatura(texto, { diasSemResposta });
  const etapaEfetiva = temperatura === "quente" && etapa === "novo" ? "qualificacao" : etapa;
  return {
    temperatura,
    etapa: etapaEfetiva,
    agente: escolherAgente(etapaEfetiva, config),
    corretor: rodizio.espiar(), // quem assume chama rodizio.proximo()
  };
}
