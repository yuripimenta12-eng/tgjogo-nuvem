// ====================================================================
// NUMERO DA SORTE COPA TGJOGO - Backend + Bot Telegram
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
  UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN,
} = process.env;

const TOTAL = Number(GRID_SIZE);

if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes("cole_o_token")) {
  console.error("\n[ERRO] Falta o TELEGRAM_BOT_TOKEN no arquivo .env\n");
  process.exit(1);
}

// --------------------------------------------------------------------
// SANITIZACAO DE ENTRADA
// --------------------------------------------------------------------
function sanitizar(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/[<>&"']/g, "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim();
}

// --------------------------------------------------------------------
// ARMAZENAMENTO — Upstash Redis (permanente) ou arquivo JSON (local)
// --------------------------------------------------------------------
const DB_FILE  = "campanha.json";
const REDIS_KEY = "tgjogo:reservas";
const usandoRedis = !!(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);

async function redisGet(key) {
  const r = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
  });
  const json = await r.json();
  return json.result ? JSON.parse(json.result) : null;
}

async function redisSet(key, value) {
  await fetch(`${UPSTASH_REDIS_REST_URL}/set/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(JSON.stringify(value)),
  });
}

async function carregarReservas() {
  if (usandoRedis) {
    try {
      const data = await redisGet(REDIS_KEY);
      console.log("[Redis] Reservas carregadas:", (data || []).length);
      return data || [];
    } catch (e) {
      console.error("[Redis] Erro ao carregar, usando arquivo local:", e.message);
    }
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function salvarReservas(lista) {
  if (usandoRedis) {
    try {
      await redisSet(REDIS_KEY, lista);
      return;
    } catch (e) {
      console.error("[Redis] Erro ao salvar, salvando em arquivo:", e.message);
    }
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(lista, null, 2));
}

let reservas = await carregarReservas();
if (usandoRedis) {
  console.log("[Storage] Usando Upstash Redis — dados persistentes.");
} else {
  console.warn("[Storage] Upstash nao configurado — usando arquivo local (dados perdidos no restart).");
}

const acharPorNumero = (n) => reservas.find((r) => r.numero === n);
const acharPorPlayer = (id) =>
  reservas.find((r) => r.player_id.toLowerCase() === id.toLowerCase());
const acharPorToken  = (t) => reservas.find((r) => r.claim_token === t);

// --------------------------------------------------------------------
// VALIDACOES
// --------------------------------------------------------------------
function idValido(s)       { return typeof s === "string" && s.length >= 1 && s.length <= 40; }
function numeroValido(n)   { return Number.isInteger(n) && n >= 1 && n <= TOTAL; }
function nomeValido(s)     { return typeof s === "string" && s.length >= 3 && s.length <= 60; }
function telegramValido(s) { return typeof s === "string" && s.length >= 2 && s.length <= 40; }

// --------------------------------------------------------------------
// BOT DO TELEGRAM
// Remove webhook via REST, aguarda 2s, depois inicia polling limpo.
// --------------------------------------------------------------------
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

try {
  const resp = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`
  );
  const result = await resp.json();
  console.log("[Bot] Webhook removido:", result.ok);
} catch (e) {
  console.warn("[Bot] Nao foi possivel remover webhook:", e.message);
}

await new Promise((r) => setTimeout(r, 2000));
bot.startPolling();

bot.on("polling_error", (err) => {
  console.error("[Bot] Polling error:", err.code, err.message);
});

const username = (await bot.getMe()).username;
console.log(`Bot conectado: @${username}`);

bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const token  = match && match[1] ? match[1].trim() : null;

  if (!token) {
    bot.sendMessage(chatId, "Ola! Para receber a confirmacao do seu numero da sorte, use o botao que aparece no site depois de confirmar sua participacao.");
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
  bot.sendMessage(chatId,
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
    console.warn("[aviso] TELEGRAM_TEAM_CHAT_ID nao configurado.");
    return;
  }
  const agora  = new Date();
  const data   = agora.toLocaleDateString("pt-BR");
  const hora   = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const numero = String(reserva.numero).padStart(2, "0");

  bot.sendMessage(TELEGRAM_TEAM_CHAT_ID,
    `🎟️ NOVA PARTICIPACAO - COPA TGJOGO\n\n` +
    `Numero escolhido: ${numero}\n` +
    `ID do jogador: ${reserva.player_id}\n` +
    `Nome real: ${reserva.nome_real}\n` +
    `Telegram: ${reserva.telegram_nome}\n` +
    `Status: Participacao registrada\n` +
    `Data: ${data}\n` +
    `Hora: ${hora}`
  ).catch((e) => console.error("Erro ao avisar equipe:", e.message));
}

// --------------------------------------------------------------------
// API
// --------------------------------------------------------------------
const app = express();

// Necessario para o rate limit funcionar corretamente atras do proxy do Render
app.set("trust proxy", 1);

app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.static(path.join(__dirname, "site")));

// Rate limit geral: 60 req/min por IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, erro: "Muitas tentativas. Aguarde um instante." },
}));

// Rate limit especifico para confirmacao: max 5 por 15 min por IP
const limiteConfirmar = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, erro: "Limite de confirmacoes atingido. Tente novamente em 15 minutos." },
});

app.get("/api/config", (req, res) => {
  res.json({ ok: true, total: TOTAL, botUsername: username });
});

app.get("/api/grade", (req, res) => {
  const mapa = {};
  for (const r of reservas) mapa[r.numero] = r.status;
  const grade = [];
  for (let n = 1; n <= TOTAL; n++) {
    grade.push({ numero: n, status: mapa[n] || "disponivel" });
  }
  res.json({ ok: true, grade });
});

app.post("/api/confirmar", limiteConfirmar, async (req, res) => {
  const numero       = Number(req.body?.numero);
  const playerId     = sanitizar(String(req.body?.playerId     ?? ""));
  const nomeReal     = sanitizar(String(req.body?.nomeReal     ?? ""));
  const telegramNome = sanitizar(String(req.body?.telegramNome ?? ""));

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

  const jaRegistrado = acharPorPlayer(playerId);
  if (jaRegistrado) {
    const numExistente = String(jaRegistrado.numero).padStart(2, "0");
    return res.status(409).json({
      ok: false,
      erro: `Este ID ja esta registrado com o numero ${numExistente}. Cada ID participa apenas uma vez.`,
    });
  }

  if (acharPorNumero(numero)) {
    return res.status(409).json({
      ok: false,
      erro: "Este numero acabou de ser reservado por outra pessoa. Escolha outro.",
    });
  }

  const claimToken = crypto.randomBytes(16).toString("hex");
  const reserva = {
    numero,
    player_id:     playerId,
    nome_real:     nomeReal,
    telegram_nome: telegramNome,
    status:        "confirmado",
    claim_token:   claimToken,
    telegram_chat: null,
    criado_em:     new Date().toISOString(),
  };
  reservas.push(reserva);
  await salvarReservas(reservas);

  avisarEquipe(reserva);

  res.json({
    ok: true,
    numero,
    playerId,
    nomeReal,
    telegramNome,
    telegramLink: `https://t.me/${username}?start=${claimToken}`,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor no ar na porta ${PORT}.`);
  console.log(`Grade configurada de 1 a ${TOTAL}.`);
});
