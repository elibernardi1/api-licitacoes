/**
 * API DE LICITAÇÕES DE TIJUCAS - servidor
 * ------------------------------------------------------------
 * Lê do banco MySQL (já populado pelo coletor.js) e serve os
 * dados em JSON, no estilo dummyjson: listagem paginada, busca
 * por id, filtros por query string.
 */

const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
const PORTA = process.env.PORT || 3000;

const CONFIG_BANCO = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "eli15423", // AJUSTAR: sua senha do MySQL
  database: process.env.DB_NAME || "licitacoes_tijucas",
};

const pool = mysql.createPool(CONFIG_BANCO);

/**
 * Traduz uma linha do banco (snake_case) pro formato que a API
 * expõe (camelCase, com os sub-objetos que já usávamos no coletor).
 */
function paraJson(linha) {
  return {
    id: linha.id,
    modalidade: linha.modalidade,
    tipoConcorrencia: linha.tipo_concorrencia,
    objeto: linha.objeto,
    situacao: linha.situacao,
    unidadeGestora: linha.unidade_gestora,
    licitacao: {
      numero: linha.licitacao_numero,
      ano: linha.licitacao_ano,
    },
    processoAdministrativo: {
      numero: linha.processo_administrativo_numero,
      ano: linha.processo_administrativo_ano,
    },
    dataHomologacao: linha.data_homologacao,
    dataEdital: linha.data_edital,
    dataAdjudicacao: linha.data_adjudicacao,
    aberturaPropostas: linha.abertura_propostas,
    aberturaSessao: linha.abertura_sessao,
    tce: {
      registro: linha.tce_registro,
      numeroProcessoTermo: linha.tce_numero_processo_termo,
    },
    valorEstimado: linha.valor_estimado,
    valorHomologado: linha.valor_homologado,
    carona: !!linha.carona,
  };
}

/**
 * GET /licitacoes
 * Lista paginada, no padrão dummyjson: ?limit=10&skip=0
 * Filtros opcionais: ?situacao=Aberta&unidadeGestora=...&ano=2026
 */
app.get("/licitacoes", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const skip = parseInt(req.query.skip) || 0;

  const condicoes = [];
  const valores = [];

  if (req.query.situacao) {
    condicoes.push("situacao = ?");
    valores.push(req.query.situacao);
  }
  if (req.query.unidadeGestora) {
    condicoes.push("unidade_gestora LIKE ?");
    valores.push(`%${req.query.unidadeGestora}%`);
  }
  if (req.query.ano) {
    condicoes.push("licitacao_ano = ?");
    valores.push(req.query.ano);
  }

  const whereClause = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";

  try {
    const [linhas] = await pool.execute(
      `SELECT * FROM licitacoes ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...valores, limit, skip]
    );
    const [totalRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM licitacoes ${whereClause}`,
      valores
    );

    res.json({
      licitacoes: linhas.map(paraJson),
      total: totalRows[0].total,
      skip,
      limit,
    });
  } catch (erro) {
    res.status(500).json({ mensagem: "Erro ao buscar licitações", erro: erro.message });
  }
});

/**
 * GET /licitacoes/search?q=termo
 * Busca textual simples no campo "objeto".
 * IMPORTANTE: essa rota precisa vir ANTES de /licitacoes/:id,
 * senão o Express interpreta "search" como se fosse um :id.
 */
app.get("/licitacoes/search", async (req, res) => {
  const termo = req.query.q || "";

  try {
    const [linhas] = await pool.execute(
      "SELECT * FROM licitacoes WHERE objeto LIKE ? ORDER BY id DESC LIMIT 30",
      [`%${termo}%`]
    );
    res.json({ licitacoes: linhas.map(paraJson), total: linhas.length });
  } catch (erro) {
    res.status(500).json({ mensagem: "Erro na busca", erro: erro.message });
  }
});

/**
 * GET /licitacoes/:id
 * Busca uma licitação específica pelo id interno (chave do banco).
 */
app.get("/licitacoes/:id", async (req, res) => {
  try {
    const [linhas] = await pool.execute(
      "SELECT * FROM licitacoes WHERE id = ?",
      [req.params.id]
    );

    if (linhas.length === 0) {
      return res.status(404).json({ mensagem: "Licitação não encontrada" });
    }

    res.json(paraJson(linhas[0]));
  } catch (erro) {
    res.status(500).json({ mensagem: "Erro ao buscar licitação", erro: erro.message });
  }
});

app.listen(PORTA, () => {
  console.log(`API de licitações rodando em http://localhost:${PORTA}`);
});

module.exports = app;
