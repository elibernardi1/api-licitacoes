/**
 * COLETOR DE LICITAÇÕES - Portal da Transparência de Tijucas
 * ------------------------------------------------------------
 * MUDANÇA DE ESTRATÉGIA: o endpoint interno do portal tem proteção
 * anti-bot que bloqueia acesso automatizado. Em vez de raspar o
 * site, este script lê o arquivo JSON exportado MANUALMENTE pelo
 * portal (botão de impressão/exportação -> formato JSON).
 *
 * Fluxo:
 *   1) Alguém exporta o relatório do portal em JSON de tempos em
 *      tempos (semanal/mensal) e salva em ./input/relatorio.json
 *   2) Este script lê o arquivo, corrige dois problemas conhecidos
 *      do exportador do portal, e normaliza pro schema da sua API
 *   3) TODO: grava no banco de dados
 *
 * Dois problemas conhecidos do arquivo exportado pelo portal:
 *   a) Vem em encoding ISO-8859-1 (Latin-1), não UTF-8
 *   b) Às vezes tem aspas internas não escapadas dentro do campo
 *      "Objeto" (ex: um objeto que cita um nome entre aspas),
 *      o que technically invalida o JSON
 */

const fs = require("fs");
const mysql = require("mysql2/promise");

const CAMINHO_ARQUIVO_EXPORTADO =
  process.argv[2] || "./input/relatorio.json";

// Configuração da conexão com o MySQL. Pode ajustar direto aqui,
// ou definir essas variáveis de ambiente antes de rodar o script
// (ex: DB_PASSWORD=minha_senha node coletor.js).
const CONFIG_BANCO = {
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "", // AJUSTAR: sua senha do MySQL
  database: process.env.DB_NAME || "licitacoes_tijucas",
};

/**
 * Corrige aspas internas não escapadas dentro de valores string.
 * Percorre caractere a caractere; uma aspa só é tratada como
 * FECHAMENTO de string se o próximo caractere não-espaço for um
 * delimitador JSON válido (, : } ]). Caso contrário, é uma aspa
 * literal dentro do texto e precisa ser escapada.
 */
function consertarAspasInternas(textoBruto) {
  let saida = "";
  let dentroDeString = false;

  for (let i = 0; i < textoBruto.length; i++) {
    const c = textoBruto[i];

    if (c === '"' && textoBruto[i - 1] !== "\\") {
      if (!dentroDeString) {
        dentroDeString = true;
        saida += c;
      } else {
        let j = i + 1;
        while (j < textoBruto.length && /\s/.test(textoBruto[j])) j++;
        const proximo = textoBruto[j] ?? "";

        if (",:}]".includes(proximo) || proximo === "") {
          dentroDeString = false;
          saida += c;
        } else {
          saida += '\\"'; // aspa interna -> escapa
        }
      }
    } else {
      saida += c;
    }
  }

  return saida;
}

/**
 * Detecta se o conteúdo do arquivo é UTF-8 válido ou se é Latin-1.
 * O portal às vezes exporta em Latin-1 (cru) e às vezes o arquivo
 * já foi corrigido pra UTF-8 - então não dá pra assumir um só.
 *
 * Estratégia: tenta decodificar os bytes como UTF-8 em modo estrito
 * (fatal: true). Se der erro, é porque tem byte solto de acentuação
 * Latin-1 no meio (ex: "ç" sozinho = 0xE7, que não é UTF-8 válido) -
 * nesse caso, decodifica como Latin-1 em vez disso.
 */
function decodificarAutomatico(bufferBruto) {
  try {
    const decoderUtf8 = new TextDecoder("utf-8", { fatal: true });
    return decoderUtf8.decode(bufferBruto);
  } catch {
    const decoderLatin1 = new TextDecoder("iso-8859-1");
    return decoderLatin1.decode(bufferBruto);
  }
}

/**
 * Lê o arquivo exportado, corrige encoding + aspas, e retorna
 * o array de licitações já como objeto JS.
 */
function lerArquivoExportado(caminho) {
  const bufferBruto = fs.readFileSync(caminho);
  const texto = decodificarAutomatico(bufferBruto);
  const corrigido = consertarAspasInternas(texto);
  return JSON.parse(corrigido);
}

/**
 * Converte "DD/MM/AAAA HH:mm:ss" (formato do portal) pra
 * um objeto Date de verdade, ou null se vazio.
 */
function paraData(valor) {
  if (!valor) return null;
  const [dataParte, horaParte] = valor.split(" ");
  const [dia, mes, ano] = dataParte.split("/").map(Number);
  const [h, m, s] = (horaParte ?? "00:00:00").split(":").map(Number);
  return new Date(ano, mes - 1, dia, h, m, s ?? 0);
}

/**
 * Converte valores monetários do portal ("3143805.00" como string,
 * ou "" quando vazio) pra número ou null.
 */
function paraNumero(valor) {
  if (valor === "" || valor == null) return null;
  const n = Number(valor);
  return Number.isNaN(n) ? null : n;
}

/**
 * Traduz um registro do formato bruto do portal (chaves em
 * português, com espaços e hífens) pro schema limpo da sua API.
 */
function normalizarRegistro(bruto) {
  return {
    modalidade: bruto["Modalidade"] || null,
    licitacao: {
      numero: bruto["Licitação - Número"] || null,
      ano: bruto["Licitação - Ano"] || null,
    },
    dataHomologacao: paraData(bruto["Data Homologação"]),
    dataEdital: paraData(bruto["Data Edital"]),
    dataAdjudicacao: paraData(bruto["Data Adjudicação"]),
    tipoConcorrencia: bruto["Tipo de Concorrência"] || null,
    objeto: bruto["Objeto"] || null,
    situacao: bruto["Situação"] || null,
    processoAdministrativo: {
      numero: bruto["Processo Administrativo - Número"] || null,
      ano: bruto["Processo Administrativo - Ano"] || null,
    },
    aberturaPropostas: paraData(bruto["Abertura das Propostas"]),
    aberturaSessao: paraData(bruto["Abertura da Sessão"]),
    tce: {
      registro: bruto["TCE - Registro"] || null,
      numeroProcessoTermo: bruto["TCE - Número Processo Termo"] || null,
    },
    valorEstimado: paraNumero(bruto["Valor - Estimado"]),
    valorHomologado: paraNumero(bruto["Valor - Homologado"]),
    carona: bruto["Carona"] === "Sim",
    unidadeGestora: bruto["Unidade Gestora"] || null,
  };
}

/**
 * Achata o objeto normalizado (que tem sub-objetos como
 * licitacao.numero) em colunas soltas, do jeito que a tabela
 * do MySQL espera.
 */
function paraLinhaBanco(licitacaoNormalizada) {
  return {
    modalidade: licitacaoNormalizada.modalidade,
    tipo_concorrencia: licitacaoNormalizada.tipoConcorrencia,
    objeto: licitacaoNormalizada.objeto,
    situacao: licitacaoNormalizada.situacao,
    unidade_gestora: licitacaoNormalizada.unidadeGestora,
    licitacao_numero: licitacaoNormalizada.licitacao.numero,
    licitacao_ano: licitacaoNormalizada.licitacao.ano,
    processo_administrativo_numero:
      licitacaoNormalizada.processoAdministrativo.numero,
    processo_administrativo_ano:
      licitacaoNormalizada.processoAdministrativo.ano,
    data_homologacao: licitacaoNormalizada.dataHomologacao,
    data_edital: licitacaoNormalizada.dataEdital,
    data_adjudicacao: licitacaoNormalizada.dataAdjudicacao,
    abertura_propostas: licitacaoNormalizada.aberturaPropostas,
    abertura_sessao: licitacaoNormalizada.aberturaSessao,
    tce_registro: licitacaoNormalizada.tce.registro,
    tce_numero_processo_termo: licitacaoNormalizada.tce.numeroProcessoTermo,
    valor_estimado: licitacaoNormalizada.valorEstimado,
    valor_homologado: licitacaoNormalizada.valorHomologado,
    carona: licitacaoNormalizada.carona,
  };
}

/**
 * Grava (ou atualiza, se já existir) cada licitação no banco.
 * Usa "ON DUPLICATE KEY UPDATE" em cima da constraint única
 * (unidade_gestora, licitacao_numero, licitacao_ano) criada no
 * schema.sql - então rodar o coletor várias vezes é seguro,
 * ele atualiza em vez de duplicar.
 */
async function gravarNoBanco(licitacoes) {
  const conexao = await mysql.createConnection(CONFIG_BANCO);

  try {
    for (const licitacao of licitacoes) {
      const linha = paraLinhaBanco(licitacao);
      const colunas = Object.keys(linha);
      const valores = Object.values(linha);

      const placeholders = colunas.map(() => "?").join(", ");
      const atualizacoes = colunas
        .filter((c) => !["unidade_gestora", "licitacao_numero", "licitacao_ano"].includes(c))
        .map((c) => `${c} = VALUES(${c})`)
        .join(", ");

      await conexao.execute(
        `INSERT INTO licitacoes (${colunas.join(", ")})
         VALUES (${placeholders})
         ON DUPLICATE KEY UPDATE ${atualizacoes}`,
        valores
      );
    }
    console.log(`${licitacoes.length} licitações gravadas/atualizadas no banco.`);
  } finally {
    await conexao.end();
  }
}

async function coletar() {
  const registrosBrutos = lerArquivoExportado(CAMINHO_ARQUIVO_EXPORTADO);
  const licitacoes = registrosBrutos.map(normalizarRegistro);

  console.log(`Processadas ${licitacoes.length} licitações do arquivo.`);

  await gravarNoBanco(licitacoes);

  return licitacoes;
}

if (require.main === module) {
  coletar().catch((erro) => {
    console.error("Erro ao coletar/gravar licitações:", erro.message);
    if (erro.code) console.error("Código do erro MySQL:", erro.code);
  });
}

module.exports = {
  coletar,
  normalizarRegistro,
  consertarAspasInternas,
  paraLinhaBanco,
  gravarNoBanco,
};