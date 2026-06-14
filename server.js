// ====================================================================
//  NUMERO DA SORTE COPA TGJOGO  -  Backend + Bot Telegram
// --------------------------------------------------------------------
//  O que este arquivo faz:
//   1. Sobe uma API que o site consome (ver grade, sortear, confirmar).
//   2. Guarda as reservas num banco SQLite (arquivo local, simples).
//   3. Avisa a SUA EQUIPE no Telegram a cada participacao.
//   4. Mantem um bot que, quando o jogador aperta "Iniciar", manda a
//      confirmacao no Telegram dele.
//  Para rodar:  npm install  ->  npm start
// ====================================================================

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_TEAM_CHAT_ID,
  PORT = 3000,
  ALLOWED_ORIGIN = "*",
  GRID_SIZE = 100,
} = process.env;

const TOTAL = Number(GRID_SIZE);

if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes("cole_o_token")) {
  console.error("\n[ERRO] Falta o TELEGRAM_BOT_TOKEN no arquivo .env\n");
  process.exit(1);
}

// --------------------------------------------------------------------
//  ARMAZENAMENTO (arquivo JSON simples - sem banco pra compilar)
//  Guarda as reservas em campanha.json. Para milhares de participacoes
//  isso e mais que suficiente e funciona em qualquer sistema.
// --------------------------------------------------------------------
const DB_FILE = "campanha.json";

function carregarReservas() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return []; // arquivo ainda nao existe
  }
}
function salvarReservas(lista) {
  fs.writeFileSync(DB_FILE, JSON.stringify(lista, null, 2));
}

let reservas = carregarReservas(); // [{numero, player_id, status, claim_token, telegram_chat, criado_em}]

const acharPorNumero = (n) => reservas.find((r) => r.numero === n);
const acharPorPlayer = (id) => reservas.find((r) => r.player_id === id);
const acharPorToken = (t) => reservas.find((r) => r.claim_token === t);

// --------------------------------------------------------------------
//  VALIDACOES
// --------------------------------------------------------------------
function idValido(playerId) {
  // ID livre: aceita numeros, letras e simbolos. So nao pode ser vazio.
  // Limite de 1 a 40 caracteres para evitar lixo/spam.
  return typeof playerId === "string" && playerId.trim().length >= 1 && playerId.trim().length <= 40;
}

function numeroValido(n) {
  return Number.isInteger(n) && n >= 1 && n <= TOTAL;
}

function nomeValido(s) {
  return typeof s === "string" && s.trim().length >= 3 && s.trim().length <= 60;
}

function telegramValido(s) {
  return typeof s === "string" && s.trim().length >= 2 && s.trim().length <= 40;
}

function numerosOcupados() {
  return new Set(reservas.map((r) => r.numero));
}

// --------------------------------------------------------------------
//  BOT DO TELEGRAM
// --------------------------------------------------------------------
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const username = (await bot.getMe()).username;
console.log(`Bot conectado: @${username}`);

// Quando o jogador abre o link e aperta "Iniciar", chega aqui.
// O link tera o formato: https://t.me/SEU_BOT?start=<claim_token>
bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const token = match && match[1] ? match[1].trim() : null;

  if (!token) {
    bot.sendMessage(
      chatId,
      "Ola! Para receber a confirmacao do seu numero da sorte, use o botao que aparece no site depois de confirmar sua participacao."
    );
    return;
  }

  const reserva = acharPorToken(token);
  if (!reserva) {
    bot.sendMessage(chatId, "Nao encontrei essa participacao. Confirme novamente no site.");
    return;
  }

  reserva.telegram_chat = chatId;
  salvarReservas(reservas);

  const numero = String(reserva.numero).padStart(2, "0");
  bot.sendMessage(
    chatId,
    `Participacao confirmada! 🍀\n\n` +
      `🏆 NUMERO DA SORTE COPA TGJOGO\n\n` +
      `🎟️ Seu numero: ${numero}\n` +
      `🆔 ID do jogador: ${reserva.player_id}\n` +
      `👤 Nome: ${reserva.nome_real}\n` +
      `✅ Status: registrado\n\n` +
      `Aguarde o sorteio oficial aqui no Telegram. Boa sorte!`
  );
});

function avisarEquipe(reserva) {
  if (!TELEGRAM_TEAM_CHAT_ID || TELEGRAM_TEAM_CHAT_ID.includes("xxxx")) {
    console.warn("[aviso] TELEGRAM_TEAM_CHAT_ID nao configurado - equipe nao sera notificada.");
    return;
  }
  const agora = new Date();
  const data = agora.toLocaleDateString("pt-BR");
  const hora = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const numero = String(reserva.numero).padStart(2, "0");

  const texto =
    `🎟️ NOVA PARTICIPACAO - COPA TGJOGO\n\n` +
    `Numero escolhido: ${numero}\n` +
    `ID do jogador: ${reserva.player_id}\n` +
    `Nome real: ${reserva.nome_real}\n` +
    `Telegram: ${reserva.telegram_nome}\n` +
    `Status: Participacao registrada\n` +
    `Data: ${data}\n` +
    `Hora: ${hora}`;

  bot.sendMessage(TELEGRAM_TEAM_CHAT_ID, texto).catch((e) =>
    console.error("Erro ao avisar equipe:", e.message)
  );
}

// --------------------------------------------------------------------
//  API
// --------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGIN }));

// Serve o site (pasta "site") na raiz, para ser um endereco unico na nuvem.
app.use(express.static(path.join(__dirname, "site")));

// Anti-spam: no maximo 30 requisicoes por minuto por IP.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, erro: "Muitas tentativas. Aguarde um instante." },
  })
);

// Configuracao da grade (o site usa para desenhar os numeros).
app.get("/api/config", (req, res) => {
  res.json({ ok: true, total: TOTAL, botUsername: username });
});

// Estado de todos os numeros: disponivel / confirmado / sorteado.
app.get("/api/grade", (req, res) => {
  const mapa = {};
  for (const r of reservas) mapa[r.numero] = r.status;
  const grade = [];
  for (let n = 1; n <= TOTAL; n++) {
    grade.push({ numero: n, status: mapa[n] || "disponivel" });
  }
  res.json({ ok: true, grade });
});

// Sorteia 5 numeros aleatorios ENTRE OS DISPONIVEIS.
// (mecanica dinamica: o jogador nao escolhe na grade cheia, ele recebe 5 opcoes)
app.get("/api/sortear-opcoes", (req, res) => {
  const ocupados = numerosOcupados();
  const livres = [];
  for (let n = 1; n <= TOTAL; n++) if (!ocupados.has(n)) livres.push(n);

  if (livres.length === 0) {
    return res.json({ ok: false, erro: "Todos os numeros ja foram reservados." });
  }
  // Embaralha e pega ate 5.
  for (let i = livres.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [livres[i], livres[j]] = [livres[j], livres[i]];
  }
  res.json({ ok: true, opcoes: livres.slice(0, 5).sort((a, b) => a - b) });
});

// Confirma a participacao. Regra: 1 numero por ID; numero unico.
app.post("/api/confirmar", (req, res) => {
  const numero = Number(req.body?.numero);
  const playerId = String(req.body?.playerId ?? "").trim();
  const nomeReal = String(req.body?.nomeReal ?? "").trim();
  const telegramNome = String(req.body?.telegramNome ?? "").trim();

  if (!idValido(playerId)) {
    return res.status(400).json({ ok: false, erro: "Informe seu ID de jogador (1 a 40 caracteres)." });
  }
  if (!numeroValido(numero)) {
    return res.status(400).json({ ok: false, erro: "Numero invalido." });
  }
  if (!nomeValido(nomeReal)) {
    return res.status(400).json({ ok: false, erro: "Informe seu nome real (3 a 60 caracteres)." });
  }
  if (!telegramValido(telegramNome)) {
    return res.status(400).json({ ok: false, erro: "Informe seu nome de usuario no Telegram." });
  }
  if (acharPorPlayer(playerId)) {
    return res.status(409).json({ ok: false, erro: "Este ID ja registrou um numero. Cada ID participa apenas uma vez." });
  }
  if (acharPorNumero(numero)) {
    return res.status(409).json({ ok: false, erro: "Este numero acabou de ser reservado por outra pessoa. Escolha outro." });
  }

  const claimToken = crypto.randomBytes(16).toString("hex");
  const reserva = {
    numero,
    player_id: playerId,
    nome_real: nomeReal,
    telegram_nome: telegramNome,
    status: "confirmado",
    claim_token: claimToken,
    telegram_chat: null,
    criado_em: new Date().toISOString(),
  };
  reservas.push(reserva);
  salvarReservas(reservas);

  avisarEquipe(reserva);

  res.json({
    ok: true,
    numero,
    playerId,
    nomeReal,
    telegramNome,
    // O site usa isto para montar o botao "Receber confirmacao no Telegram".
    telegramLink: `https://t.me/${username}?start=${claimToken}`,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor no ar na porta ${PORT}.`);
  console.log(`Grade configurada de 1 a ${TOTAL}.`);
});
