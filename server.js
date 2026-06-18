// ====================================================================
// NUMERO DA SORTE COPA TGJOGO - Backend + Bot Telegram
// ====================================================================

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
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
ADMIN_PASSWORD,
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
// ARMAZENAMENTO &mdash; Upstash Redis (permanente) ou arquivo JSON (local)
// --------------------------------------------------------------------
const DB_FILE = "campanha.json";
const REDIS_KEY = "tgjogo:reservas";
const usandoRedis = !!(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);

async function redisGet(key) {
const r = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${key}`, {
  headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
});
const json = await r.json();
if (!json.result) return null;
const first = JSON.parse(json.result);
return typeof first === "string" ? JSON.parse(first) : first;
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
console.log("[Storage] Usando Upstash Redis &mdash; dados persistentes.");
} else {
console.warn("[Storage] Upstash nao configurado &mdash; usando arquivo local.");
}

const acharPorNumero = (n) => reservas.find((r) => r.numero === n);
const acharPorPlayer = (id) =>
reservas.find((r) => r.player_id.toLowerCase() === id.toLowerCase());
const acharPorToken = (t) => reservas.find((r) => r.claim_token === t);

// --------------------------------------------------------------------
// VALIDACOES
// --------------------------------------------------------------------
function idValido(s) { return typeof s === "string" && s.length >= 1 && s.length <= 40; }
function numeroValido(n) { return Number.isInteger(n) && n >= 1 && n <= TOTAL; }
function nomeValido(s) { return typeof s === "string" && s.length >= 3 && s.length <= 60; }
function telegramValido(s) { return typeof s === "string" && s.length >= 2 && s.length <= 40; }

// --------------------------------------------------------------------
// BOT DO TELEGRAM (modo webhook &mdash; sem conflito 409 entre deploys)
// --------------------------------------------------------------------
const WEBHOOK_PATH = `/tg/${TELEGRAM_BOT_TOKEN}`;
const WEBHOOK_URL = `https://numerodasortetg.onrender.com${WEBHOOK_PATH}`;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

try {
await bot.setWebHook(WEBHOOK_URL, { drop_pending_updates: true });
console.log("[Bot] Webhook configurado:", WEBHOOK_URL.replace(TELEGRAM_BOT_TOKEN, "***"));
} catch (e) {
console.warn("[Bot] Erro ao configurar webhook:", e.message);
}

const username = (await bot.getMe()).username;
console.log(`Bot conectado: @${username}`);

bot.onText(/\/start(?:\s+(.*))?/, (msg, match) => {
const chatId = msg.chat.id;
const token = match && match[1] ? match[1].trim() : null;

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
  // Notificar admin quando participante confirma no bot
  if (TELEGRAM_TEAM_CHAT_ID && !TELEGRAM_TEAM_CHAT_ID.includes("xxxx")) {
    var _num = String(reserva.numero).padStart(3, "0");
    var _tg = msg.from.username ? "@" + msg.from.username : msg.from.first_name;
    bot.sendMessage(TELEGRAM_TEAM_CHAT_ID,
      "✅ Confirmou no bot!\n\n" +
      "Nome: " + reserva.nome_real + "\n" +
      "ID TGJOGO: " + reserva.player_id + "\n" +
      "Número: " + _num + "\n" +
      "Telegram: " + _tg
    ).catch(function(e) { console.error("[Bot] Notif admin:", e.message); });
  }

const numero = String(reserva.numero).padStart(2, "0");
bot.sendMessage(chatId,
  `Participacao confirmada! Ã°ÂÂÂ\n\n` +
  `&#x1F3C6; NUMERO DA SORTE COPA TGJOGO\n\n` +
  `Ã°ÂÂÂÃ¯Â¸Â Seu numero: ${numero}\n` +
  `Ã°ÂÂÂ ID do jogador: ${reserva.player_id}\n` +
  `Ã°ÂÂÂ¤ Nome: ${reserva.nome_real}\n` +
  `&#x2705; Status: registrado\n\n` +
  `Aguarde o sorteio oficial aqui no Telegram. Boa sorte!`
);
});

// --------------------------------------------------------------------
// /meu_numero &mdash; jogador consulta seu numero pelo bot
// --------------------------------------------------------------------
bot.onText(/\/meu_numero/, async (msg) => {
const chatId = msg.chat.id;
let reserva = reservas.find((r) => r.telegram_chat === chatId);
if (!reserva && msg.from.username) {
  const uname = "@" + msg.from.username;
  reserva = reservas.find((r) => r.telegram_nome.toLowerCase() === uname.toLowerCase());
}
if (reserva) {
  const numero = String(reserva.numero).padStart(2, "0");
  bot.sendMessage(
    chatId,
    "Ã°ÂÂÂ¯ Seu número da sorte é o *" + numero + "*!\n\n" +
    "Ã°ÂÂÂ¤ Nome: " + reserva.nome_real + "\n" +
    "Ã°ÂÂÂ ID: " + reserva.player_id + "\n\n" +
    "Boa sorte na Copa TGJOGO! Ã¢ÂÂ½",
    { parse_mode: "Markdown" }
  );
} else {
  bot.sendMessage(
    chatId,
    "Ã¢ÂÂ VocÃÂª ainda não tem um número registrado.\n\n" +
    "Acesse o site e escolha o seu! Ã°ÂÂÂÃ¯Â¸Â"
  );
}
});

function avisarGradeCheia() {
if (!TELEGRAM_TEAM_CHAT_ID || TELEGRAM_TEAM_CHAT_ID.includes("xxxx")) return;
bot.sendMessage(TELEGRAM_TEAM_CHAT_ID,
  `Ã°ÂÂÂ GRADE COMPLETA! - COPA TGJOGO\n\n` +
  `Todos os ${TOTAL} números foram preenchidos!\n\n` +
  `O sorteio pode ser realizado agora. &#x1F3C6;`
).catch((e) => console.error("Erro ao avisar grade cheia:", e.message));
}

function avisarEquipe(reserva) {
if (!TELEGRAM_TEAM_CHAT_ID || TELEGRAM_TEAM_CHAT_ID.includes("xxxx")) return;
const agora = new Date();
const data = agora.toLocaleDateString("pt-BR");
const hora = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const numero = String(reserva.numero).padStart(2, "0");
bot.sendMessage(TELEGRAM_TEAM_CHAT_ID,
  `Ã°ÂÂÂÃ¯Â¸Â NOVA PARTICIPACAO - COPA TGJOGO\n\n` +
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
app.set("trust proxy", 1);
app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, "site"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
    }
  }
}));

app.use(rateLimit({
windowMs: 60 * 1000,
max: 60,
standardHeaders: true,
legacyHeaders: false,
message: { ok: false, erro: "Muitas tentativas. Aguarde um instante." },
}));

const limiteConfirmar = rateLimit({
windowMs: 15 * 60 * 1000,
max: 5,
standardHeaders: true,
legacyHeaders: false,
message: { ok: false, erro: "Limite de confirmacoes atingido. Tente novamente em 15 minutos." },
});

// --------------------------------------------------------------------
// MIDDLEWARE DE AUTENTICACAO ADMIN (HTTP Basic Auth)
// --------------------------------------------------------------------
function checkAdmin(req, res, next) {
if (!ADMIN_PASSWORD) {
  return res.status(503).send("Painel admin nao configurado. Defina ADMIN_PASSWORD nas variaveis de ambiente do Render.");
}
const auth = req.headers["authorization"] || "";
if (!auth.startsWith("Basic ")) {
  res.set("WWW-Authenticate", 'Basic realm="Admin Copa TGJOGO"');
  return res.status(401).send("Autenticacao necessaria.");
}
const decoded = Buffer.from(auth.slice(6), "base64").toString();
const senha = decoded.includes(":") ? decoded.split(":").slice(1).join(":") : decoded;
if (senha !== ADMIN_PASSWORD) {
  res.set("WWW-Authenticate", 'Basic realm="Admin Copa TGJOGO"');
  return res.status(401).send("Senha incorreta.");
}
next();
}

// --------------------------------------------------------------------
// ROTA WEBHOOK DO TELEGRAM (deve ficar antes do rate-limit geral)
// --------------------------------------------------------------------
app.post(WEBHOOK_PATH, (req, res) => {
bot.processUpdate(req.body);
res.sendStatus(200);
});

// --------------------------------------------------------------------
// KEEP-ALIVE &mdash; usado por UptimeRobot ou similar para evitar cold start
// Configure o monitor para pingar GET /ping a cada 5 minutos
// --------------------------------------------------------------------
app.get("/ping", (req, res) => {
res.json({ ok: true, ts: Date.now(), inscritos: reservas.length, disponiveis: TOTAL - reservas.length });
});

// --------------------------------------------------------------------
// ROTAS PUBLICAS
// --------------------------------------------------------------------
app.get("/api/config", (req, res) => {
res.json({ ok: true, total: TOTAL, botUsername: username });
});
// Rate limit especifico para rotas admin: max 20 por 5 min por IP
const limiteAdmin = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, erro: "Muitas tentativas no admin. Aguarde 5 minutos." },
});

app.use('/api/admin', limiteAdmin);

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

  if (!inscricoesAbertas) {
    return res.status(403).json({ ok: false, erro: "As inscrições estão encerradas." });
  }  if (dataHoraSorteio && new Date() >= new Date(dataHoraSorteio)) {
    return res.status(403).json({ ok: false, erro: "O prazo para participar encerrou." });
  }
const numero = Number(req.body?.numero);
const playerId = sanitizar(String(req.body?.playerId ?? ""));
const nomeReal = sanitizar(String(req.body?.nomeReal ?? ""));
const telegramNome = sanitizar(String(req.body?.telegramNome ?? ""));

if (!idValido(playerId)) return res.status(400).json({ ok: false, erro: "Informe seu ID de jogador (1 a 40 caracteres)." });
if (!numeroValido(numero)) return res.status(400).json({ ok: false, erro: "Numero invalido." });
if (!nomeValido(nomeReal)) return res.status(400).json({ ok: false, erro: "Informe seu nome real (3 a 60 caracteres)." });
if (!telegramValido(telegramNome)) return res.status(400).json({ ok: false, erro: "Informe seu nome de usuario no Telegram." });

const jaRegistrado = acharPorPlayer(playerId);
if (jaRegistrado) {
  const numExistente = String(jaRegistrado.numero).padStart(2, "0");
  return res.status(409).json({ ok: false, erro: `Este ID ja esta registrado com o numero ${numExistente}. Cada ID participa apenas uma vez.` });
}
const jaUsouTelegram = reservas.find((r) => r.telegram_nome.toLowerCase() === telegramNome.toLowerCase());
if (jaUsouTelegram) {
  const numExistente = String(jaUsouTelegram.numero).padStart(2, "0");
  return res.status(409).json({ ok: false, erro: `Este Telegram ja esta registrado com o numero ${numExistente}. Cada conta Telegram participa apenas uma vez.` });
}
if (acharPorNumero(numero)) {
  return res.status(409).json({ ok: false, erro: "Este numero acabou de ser reservado por outra pessoa. Escolha outro." });
}

const claimToken = crypto.randomBytes(16).toString("hex");
const reserva = {
  numero, player_id: playerId, nome_real: nomeReal, telegram_nome: telegramNome,
  status: "confirmado", claim_token: claimToken, telegram_chat: null,
  criado_em: new Date().toISOString(),
};
reservas.push(reserva);
await salvarReservas(reservas);
avisarEquipe(reserva);
if (reservas.length === TOTAL) avisarGradeCheia();

res.json({ ok: true, numero, playerId, nomeReal, telegramNome,
  telegramLink: `https://t.me/${username}?start=${claimToken}` });
});

// --------------------------------------------------------------------
// ROTAS ADMIN (protegidas por senha)
// --------------------------------------------------------------------
app.get("/api/admin/participantes", checkAdmin, (req, res) => {
const lista = reservas.map((r) => ({
  numero: String(r.numero).padStart(2, "0"),
  player_id: r.player_id,
  nome_real: r.nome_real,
  telegram_nome: r.telegram_nome,
  telegram_chat: r.telegram_chat ? "Confirmado no bot" : "Pendente",
  criado_em: new Date(r.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  criado_em_iso: r.criado_em,
}));
res.json({ ok: true, total: lista.length, disponiveis: TOTAL - lista.length, participantes: lista });
});

app.get("/api/admin/exportar", checkAdmin, (req, res) => {
const linhas = [
  "Numero,ID TGJOGO,Nome Real,Telegram,Bot Confirmado,Data/Hora",
  ...reservas.map((r) =>
    [`"${String(r.numero).padStart(2,"0")}"`,
     `"${r.player_id}"`,
     `"${r.nome_real}"`,
     `"${r.telegram_nome}"`,
     r.telegram_chat ? "Sim" : "Nao",
     `"${new Date(r.criado_em).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}"`
    ].join(",")
  ),
].join("\n");
res.set("Content-Type", "text/csv; charset=utf-8");
res.set("Content-Disposition", 'attachment; filename="participantes-copa-tgjogo.csv"');
res.send("\xEF\xBB\xBF" + linhas);
});

// --------------------------------------------------------------------
// LIBERAR NUMERO (admin) -- remove participante e libera o slot
// --------------------------------------------------------------------
app.post("/api/admin/liberar/:numero", checkAdmin, async (req, res) => {
const num = parseInt(req.params.numero, 10);
if (!numeroValido(num)) return res.status(400).json({ ok: false, erro: "Numero invalido." });
const idx = reservas.findIndex((r) => r.numero === num);
if (idx === -1) return res.status(404).json({ ok: false, erro: "Numero nao registrado." });
const removida = reservas.splice(idx, 1)[0];
await salvarReservas(reservas);
console.log(`[Admin] Numero ${num} liberado (era de ${removida.player_id})`);
res.json({ ok: true, numero: num, player_id: removida.player_id });
});

// --------------------------------------------------------------------
// RESETAR GRADE (admin) -- apaga todos os participantes
// --------------------------------------------------------------------
app.post("/api/admin/reset", checkAdmin, async (req, res) => {
const confirmacao = req.body?.confirmacao;
if (confirmacao !== "RESETAR") {
  return res.status(400).json({ ok: false, erro: 'Envie { "confirmacao": "RESETAR" } para confirmar.' });
}
reservas = [];
await salvarReservas(reservas);
console.log("[Admin] Grade resetada!");
res.json({ ok: true, mensagem: "Grade resetada com sucesso. Todos os numeros estao disponiveis." });
});


// ===== SORTEIO AO VIVO =====
function maskName(nome) {
  if (!nome) return '***';
  return nome.trim().split(/\s+/).map(function(p) {
    var vis = Math.min(3, p.length);
    return p.substring(0, vis) + '*'.repeat(Math.max(4, p.length - vis));
  }).join(' ');
}

function maskId(id) {
  var s = String(id || '');
  if (!s || s.length <= 4) return '****' + s;
  return '*'.repeat(s.length - 4) + s.slice(-4);
}

// ---------------------------------------------------------------
// SORTEIOS — persistidos no Redis
// ---------------------------------------------------------------
const REDIS_KEY_SORTEIOS = "tgjogo:sorteios";
var sorteiosAtivos = {};

async function salvarSorteios() {
  if (usandoRedis) {
    try { await redisSet(REDIS_KEY_SORTEIOS, sorteiosAtivos); }
    catch (e) { console.error("[Redis] Erro salvar sorteios:", e.message); }
  }
}

sorteiosAtivos = usandoRedis ? (await redisGet(REDIS_KEY_SORTEIOS) || {}) : {};
console.log("[Redis] Sorteios carregados:", Object.keys(sorteiosAtivos).length);

// ---------------------------------------------------------------
// ESTADO — inscricoes abertas/fechadas
// ---------------------------------------------------------------
const REDIS_KEY_ESTADO = "tgjogo:estado";
var inscricoesAbertas = true;
var dataHoraSorteio = null;

async function salvarEstado() {
  if (usandoRedis) {
    try { await redisSet(REDIS_KEY_ESTADO, { inscricoesAbertas, dataHoraSorteio }); }
    catch (e) { console.error("[Redis] Erro salvar estado:", e.message); }
  }
}

const _estado = usandoRedis ? (await redisGet(REDIS_KEY_ESTADO) || {}) : {};
inscricoesAbertas = _estado.inscricoesAbertas !== false;
dataHoraSorteio = _estado.dataHoraSorteio || null;
console.log("[Estado] Inscricoes:", inscricoesAbertas ? "abertas" : "fechadas");

app.post("/api/admin/sortear", checkAdmin, function(req, res) {
  if (!reservas.length) return res.json({ erro: "Nenhum participante inscrito." });
  var vencedor = reservas[Math.floor(Math.random() * reservas.length)];
  var sorteioId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  sorteiosAtivos[sorteioId] = Object.assign({}, vencedor, { sorteadoEm: new Date().toISOString() });
  salvarSorteios();
  console.log("[Sorteio] " + sorteioId + " - " + vencedor.nome_real + " #" + vencedor.numero);

  // Notificar ganhador no Telegram (apenas se tiver confirmado no bot)
  var notificado = false;
  if (vencedor.telegram_chat) {
    var numStr = String(vencedor.numero).padStart(3, '0');
    var msgGanhador =
      '🏆 PARABÉNS, ' + vencedor.nome_real + '!\n\n' +
      'Você foi SORTEADO na Copa TGJOGO!\n\n' +
      '🎯 Número da sorte: ' + numStr + '\n' +
      '🎮 ID TGJOGO: ' + vencedor.player_id + '\n\n' +
      '📣 A equipe TGJOGO entrará em contato em breve sobre o prêmio.\n\n' +
      'Parabéns e obrigado por participar! ⚽️';
    bot.sendMessage(vencedor.telegram_chat, msgGanhador).then(function() {
      console.log('[Sorteio] Notificação enviada ao ganhador chat_id=' + vencedor.telegram_chat);
    }).catch(function(e) {
      console.error('[Sorteio] Erro ao notificar ganhador:', e.message);
    });
    notificado = true;
  } else {
    console.warn('[Sorteio] Ganhador sem telegram confirmado - notificação não enviada.');
  }
    res.json({ ok: true, sorteioId: sorteioId, redirectUrl: "/sorteio-ao-vivo?id_sorteio=" + sorteioId, notificado: notificado });
});

app.get("/api/sorteio/:id", function(req, res) {
  var s = sorteiosAtivos[req.params.id];
  if (!s) return res.status(404).json({ erro: "Sorteio nao encontrado." });
  res.json({ numero: s.numero, nomeMascarado: maskName(s.nome_real), idMascarado: maskId(s.player_id), sorteadoEm: s.sorteadoEm });
});

app.get("/api/sorteio/:id/nomes", function(req, res) {
  var s = sorteiosAtivos[req.params.id];
  if (!s) return res.json({ nomes: ["Jogador****","Gamer****","Player****"] });
  var lista = reservas.map(function(r) { return maskName(r.nome_real); });
  while (lista.length < 8) lista = lista.concat(lista);
  lista.sort(function() { return Math.random() - 0.5; });
  res.json({ nomes: lista });
});

app.get("/sorteio-ao-vivo", function(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sorteio ao Vivo - Copa TGJOGO</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/canvas-confetti/1.9.3/confetti.browser.min.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#061a0d;color:#fff;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;position:relative}
.bg{position:fixed;inset:0;background:radial-gradient(ellipse at 20% 50%,rgba(46,158,91,.18),transparent 60%),radial-gradient(ellipse at 80% 20%,rgba(255,216,77,.12),transparent 60%),#061a0d;z-index:0}
.wrap{position:relative;z-index:1;text-align:center;width:92%;max-width:680px;padding:20px 0}
.logo-tag{font-size:12px;color:#ffd84d;font-weight:700;letter-spacing:.2em;text-transform:uppercase;margin-bottom:6px;opacity:.75}
.h1{font-size:clamp(20px,5vw,34px);font-weight:900;margin-bottom:28px;text-shadow:0 0 40px rgba(255,216,77,.4)}
.slot-box{background:rgba(255,255,255,.04);border:2px solid rgba(255,216,77,.3);border-radius:22px;height:220px;overflow:hidden;position:relative;margin-bottom:20px}
.slot-box::before,.slot-box::after{content:'';position:absolute;left:0;right:0;height:68px;z-index:2;pointer-events:none}
.slot-box::before{top:0;background:linear-gradient(#061a0d,transparent)}
.slot-box::after{bottom:0;background:linear-gradient(transparent,#061a0d)}
.slot-hl{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:72px;border-top:2px solid rgba(255,216,77,.55);border-bottom:2px solid rgba(255,216,77,.55);background:rgba(255,216,77,.06);z-index:1;pointer-events:none}
.reel{display:flex;flex-direction:column;align-items:center}
.reel-item{height:72px;display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:800;color:rgba(255,255,255,.4);padding:0 20px;white-space:nowrap;width:100%;transition:color .08s,font-size .08s}
.reel-item.hl{color:#ffd84d;font-size:26px;text-shadow:0 0 20px rgba(255,216,77,.7)}
.fase{font-size:14px;color:#7fb89a;min-height:22px;letter-spacing:.04em}
.winner{display:none;background:linear-gradient(145deg,#0a3020,#0f4530);border:3px solid #ffd84d;border-radius:26px;padding:32px 36px;box-shadow:0 0 60px rgba(255,216,77,.3);animation:pop .6s cubic-bezier(.34,1.56,.64,1)}
@keyframes pop{from{transform:scale(.4) rotate(-4deg);opacity:0}to{transform:scale(1);opacity:1}}
.w-tit{font-size:16px;color:#ffd84d;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:18px}
.w-num{font-size:82px;font-weight:900;color:#ffd84d;line-height:1;margin-bottom:6px;text-shadow:0 0 50px rgba(255,216,77,.7);letter-spacing:.04em}
.w-rows{display:grid;gap:9px;margin-top:18px;text-align:left}
.w-row{display:flex;align-items:center;gap:12px;background:rgba(0,0,0,.3);border-radius:12px;padding:12px 16px}
.w-lbl{font-size:11px;color:#7ba891;font-weight:700;text-transform:uppercase;letter-spacing:.08em;min-width:80px}
.w-val{font-size:16px;font-weight:800;color:#fff;letter-spacing:.06em}
.badge{background:linear-gradient(90deg,#2e9e5b,#1e8448);color:#fff;font-weight:800;padding:4px 16px;border-radius:20px;font-size:13px}
</style>
</head>
<body>
<div class="bg"></div>
<div class="wrap">
  <div class="logo-tag">&#x26BD; COPA TGJOGO</div>
  <div class="h1" id="titH1">&#x1F3B2; SORTEIO AO VIVO</div>
  <div class="slot-box" id="slotBox">
    <div class="slot-hl"></div>
    <div class="reel" id="reel"><div class="reel-item hl">Carregando...</div></div>
  </div>
  <div class="winner" id="winnerBox">
    <div class="w-tit">&#x1F389; GANHADOR SORTEADO &#x1F389;</div>
    <div class="w-num" id="wNum">&mdash;</div>
    <div class="w-rows">
      <div class="w-row"><div class="w-lbl">Nome</div><div class="w-val" id="wNome">&mdash;</div></div>
      <div class="w-row"><div class="w-lbl">ID TGJOGO</div><div class="w-val" id="wId">&mdash;</div></div>
      <div class="w-row"><div class="w-lbl">Status</div><div class="w-val"><span class="badge">&#x1F3C6; Premiado</span></div></div>
    </div>
  </div>
  <div class="fase" id="faseEl">Preparando sorteio...</div>
</div>
<script>
var sid = new URLSearchParams(location.search).get('id_sorteio');
var nomes = [];
var winner = null;
var reel = document.getElementById('reel');
var ROWS = 5;
function buildReel(arr, hlIdx) {
  reel.innerHTML = '';
  arr.forEach(function(n, i) {
    var d = document.createElement('div');
    d.className = 'reel-item' + (i === hlIdx ? ' hl' : '');
    d.textContent = n;
    reel.appendChild(d);
  });
}
function getWindow(arr, center) {
  var half = Math.floor(ROWS / 2);
  var out = [];
  for (var i = -half; i <= half; i++) {
    out.push(arr[((center + i) % arr.length + arr.length) % arr.length]);
  }
  return out;
}
async function init() {
  if (!sid) { document.getElementById('faseEl').textContent = 'ID invalido.'; return; }
  try {
    var r1 = await fetch('/api/sorteio/' + sid + '/nomes');
    var r2 = await fetch('/api/sorteio/' + sid);
    var d1 = await r1.json();
    var d2 = await r2.json();
    nomes = d1.nomes || ['Jogador****'];
    winner = d2;
    if (winner.erro) { document.getElementById('faseEl').textContent = 'Sorteio nao encontrado.'; return; }
    animar();
  } catch(e) {
    document.getElementById('faseEl').textContent = 'Erro ao carregar.';
  }
}
function animar() {
  document.getElementById('faseEl').textContent = 'Sorteando...';
  var schedule = [
    {delay:75, count:22, label:'&#x26A1; Sorteando...'},
    {delay:130, count:12, label:'&#x1F504; Desacelerando...'},
    {delay:230, count:8, label:'&#x23F3; Quase la...'},
    {delay:400, count:5, label:'&#x1F3AF; Prestes a parar...'},
    {delay:680, count:3, label:'&#x1F3AF; Prestes a parar...'}
  ];
  var fi = 0, ci = 0, pos = 0;
  function step() {
    var f = schedule[fi];
    document.getElementById('faseEl').innerHTML = f.label;
    pos = (pos + 1) % nomes.length;
    buildReel(getWindow(nomes, pos), Math.floor(ROWS / 2));
    ci++;
    if (ci >= f.count) { fi++; ci = 0; }
    if (fi >= schedule.length) { setTimeout(revelar, 500); return; }
    setTimeout(step, schedule[fi].delay);
  }
  setTimeout(step, 700);
}
function revelar() {
  document.getElementById('slotBox').style.display = 'none';
  document.getElementById('faseEl').style.display = 'none';
  document.getElementById('titH1').textContent = '\uD83C\uDFC6 GANHADOR';
  document.getElementById('wNum').textContent = ('000' + winner.numero).slice(-3);
  document.getElementById('wNome').textContent = winner.nomeMascarado;
  document.getElementById('wId').textContent = winner.idMascarado;
  document.getElementById('winnerBox').style.display = 'block';
  var c = confetti;
  setTimeout(function(){ c({particleCount:130,spread:80,origin:{y:.6},colors:['#ffd84d','#f5a623','#fff','#2e9e5b']}); },200);
  setTimeout(function(){ c({particleCount:90,spread:100,angle:60,origin:{y:.5,x:.1},colors:['#ffd84d','#fff']}); },600);
  setTimeout(function(){ c({particleCount:90,spread:100,angle:120,origin:{y:.5,x:.9},colors:['#ffd84d','#fff']}); },1000);
  setTimeout(function(){ c({particleCount:60,spread:50,origin:{y:.3},colors:['#ffd84d','#27ae60']}); },1500);
}
init();
<\/script>
</body>
</html>`);
});

app.get("/admin", checkAdmin, (req, res) => {
res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin · Copa TGJOGO</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",system-ui,sans-serif;background:#0b3d2e;color:#f0faf5;min-height:100vh;padding:24px 16px}
.wrap{max-width:1100px;margin:0 auto}
h1{color:#ffd84d;font-size:22px;margin-bottom:4px}
.sub{color:#9fc4b3;font-size:13px;margin-bottom:20px}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.stat{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 20px;min-width:130px}
.stat .n{font-size:32px;font-weight:900;color:#ffd84d}
.stat .l{font-size:12px;color:#9fc4b3;margin-top:2px}
.btns{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px;align-items:center}
.btn{background:linear-gradient(180deg,#ffd84d,#f5a623);color:#0a2a20;font-weight:800;border:none;border-radius:10px;padding:11px 22px;font-size:14px;cursor:pointer;text-decoration:none;display:inline-block}
.btn:hover{filter:brightness(1.1)}
.btn-sortear{background:linear-gradient(180deg,#a855f7,#7c3aed);color:#fff;font-weight:800;border:none;border-radius:10px;padding:11px 22px;font-size:14px;cursor:pointer}
.btn-sortear:hover{filter:brightness(1.15)}
.btn-lib{background:rgba(255,80,60,.12);border:1px solid rgba(255,80,60,.35);color:#ff7070;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-weight:600}
.btn-lib:hover{background:rgba(255,80,60,.28)}
.btn-reset{background:rgba(255,50,50,.15);border:1px solid rgba(255,50,50,.4);color:#ff5555;border-radius:10px;padding:11px 22px;font-size:14px;cursor:pointer;font-weight:800}
.btn-reset:hover{background:rgba(255,50,50,.3)}
.chart-box{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:18px;margin-bottom:20px}
.chart-box h2{font-size:13px;color:#9fc4b3;text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px}
.chart-box canvas{max-height:180px}
.filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center}
.filter-btn{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);color:#9fc4b3;border-radius:20px;padding:5px 14px;font-size:12px;cursor:pointer;font-weight:600;transition:.15s}
.filter-btn.active{background:rgba(255,216,77,.15);border-color:#ffd84d;color:#ffd84d}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:rgba(255,255,255,.1);padding:10px 12px;text-align:left;color:#ffd84d;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:middle}
tr:hover td{background:rgba(255,255,255,.04)}
.num{font-weight:900;font-size:18px;color:#ffd84d}
.ok{color:#2e9e5b;font-weight:700}
.pend{color:#9fc4b3}
.empty{text-align:center;padding:40px;color:#9fc4b3}
.refresh{font-size:12px;color:#9fc4b3;margin-bottom:12px}
input[type=text]{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:8px 12px;color:#fff;font-size:13px;width:260px}
input[type=text]::placeholder{color:#9fc4b3}
/* Sorteio modal */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;align-items:center;justify-content:center}
.modal-overlay.show{display:flex}
.modal{background:#0f4a35;border:2px solid #ffd84d;border-radius:20px;padding:36px 40px;text-align:center;max-width:400px;width:90%;animation:popIn .35s cubic-bezier(.34,1.56,.64,1)}
@keyframes popIn{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
.modal h2{color:#ffd84d;font-size:18px;margin-bottom:6px}
.modal .num-grande{font-size:72px;font-weight:900;color:#ffd84d;line-height:1;margin:16px 0 8px}
.modal .nome-sort{font-size:16px;color:#f0faf5;margin-bottom:4px;font-weight:700}
.modal .id-sort{font-size:13px;color:#9fc4b3;margin-bottom:20px}
.modal .aviso{font-size:11px;color:#9fc4b3;margin-bottom:20px;line-height:1.5}
.btn-fechar{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:10px;padding:10px 24px;font-size:14px;cursor:pointer}
.btn-fechar:hover{background:rgba(255,255,255,.18)}
</style>
</head>
<body>
<div class="wrap">
<h1>&#x1F3C6; Painel Admin · Copa TGJOGO</h1>
<div class="sub" id="atualizado">Carregando...</div>

<div class="stats">
<div class="stat"><div class="n" id="sTotal">&mdash;</div><div class="l">Inscritos</div></div>
<div class="stat"><div class="n" id="sDisp">&mdash;</div><div class="l">Disponíveis</div></div>
<div class="stat"><div class="n" id="sBot">&mdash;</div><div class="l">Confirmados no Bot</div></div>
<div class="stat"><div class="n" id="sPct">&mdash;</div><div class="l">% Bot confirmado</div></div>
</div>

<div class="btns">
<a class="btn" href="/api/admin/exportar">&#x2B07;&#xFE0F; Exportar CSV</a>
<button class="btn-sortear" onclick="sortear()">&#x1F3AF; Sortear Ganhador</button>
          <button id="btnToggleInscricoes" onclick="toggleInscricoes()" style="background:#e67e22;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:13px;margin-left:8px;">&#x1F512; Encerrar Inscri&#xe7;&#xf5;es</button>
          <!-- DATA DO SORTEIO -->
          <div style="margin-top:12px;padding:11px 16px;background:rgba(255,216,77,.06);border:1px solid rgba(255,216,77,.2);border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="color:#ffd84d;font-weight:700;font-size:13px;">&#x23F0; Data do Sorteio:</span>
            <input type="datetime-local" id="inputDataSorteio" style="background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.2);border-radius:6px;color:#fff;padding:6px 10px;font-size:13px;" />
            <button onclick="definirDataSorteio()" style="background:#f5a623;color:#0a2a20;border:none;border-radius:6px;padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer;">Definir</button>
            <span id="dataSorteioInfo" style="font-size:12px;color:#9fc4b3;"></span>
          </div>
<button class="btn-reset" onclick="resetarGrade()">&#x1F5D1;&#xFE0F; Resetar Grade</button>
</div>

<div class="chart-box">
<h2>&#x1F4C8; Inscrições por hora</h2>
<canvas id="chartHoras"></canvas>
</div>

<div class="refresh">&#x1F504; Atualiza automaticamente a cada 30 segundos</div>
<div class="filters">
<button class="filter-btn active" onclick="setFiltro('todos',this)">Todos</button>
<button class="filter-btn" onclick="setFiltro('confirmado',this)">&#x2705; Confirmado no Bot</button>
<button class="filter-btn" onclick="setFiltro('pendente',this)">&#x23F3; Pendente</button>
<input type="text" id="busca" placeholder="Buscar por nome, ID ou Telegram..." oninput="filtrar()" style="margin-left:auto"/>
</div>

<table>
<thead>
<tr>
<th>Nº</th>
<th>ID TGJOGO</th>
<th>Nome Real</th>
<th>Telegram</th>
<th>Bot</th>
<th>Data/Hora</th>
<th>Ações</th>
</tr>
</thead>
<tbody id="tbody"></tbody>
</table>
          <!-- HISTORICO DE SORTEIOS -->
          <div style="margin-top:28px">
            <h3 style="color:#ffd84d;font-size:15px;font-weight:700;margin-bottom:12px">&#x1F3C6; Hist&#xf3;rico de Sorteios</h3>
            <div id="historicoContainer"><p style="color:#9fc4b3;font-size:13px">Carregando...</p></div>
          </div>
</div>

<!-- Modal sorteio -->
<div class="modal-overlay" id="modalOverlay" onclick="fecharModal(event)">
<div class="modal">
<h2>&#x1F3B2; Número Sorteado (Preview)</h2>
<div class="num-grande" id="mNumero">&mdash;</div>
<div class="nome-sort" id="mNome">&mdash;</div>
<div class="id-sort" id="mId">&mdash;</div>
<div class="aviso">&#x26A0;&#xFE0F; Este é apenas um preview. Para oficializar, use o comando /sortear no bot (em breve).</div>
<button class="btn-fechar" onclick="document.getElementById('modalOverlay').classList.remove('show')">Fechar</button>
</div>
</div>

<script>
let todos = [];
let filtroAtivo = 'todos';
let grafico = null;

async function carregar() {
try {
const r = await fetch('/api/admin/participantes', { credentials: 'include' });
const d = await r.json();
todos = d.participantes || [];
const confirmados = todos.filter(p => p.telegram_chat === 'Confirmado no bot').length;
document.getElementById('sTotal').textContent = d.total;
document.getElementById('sDisp').textContent = d.disponiveis;
document.getElementById('sBot').textContent = confirmados;
document.getElementById('sPct').textContent = d.total > 0 ? Math.round(confirmados/d.total*100) + '%' : '\u2014';
document.getElementById('atualizado').textContent = 'Última atualização: ' + new Date().toLocaleTimeString('pt-BR');
filtrar();
renderChart();
} catch(e) {
document.getElementById('atualizado').textContent = 'Erro ao carregar dados.';
}
}

function setFiltro(f, btn) {
filtroAtivo = f;
document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
btn.classList.add('active');
filtrar();
}

function filtrar() {
const q = document.getElementById('busca').value.toLowerCase();
let lista = todos;
if (filtroAtivo === 'confirmado') lista = lista.filter(p => p.telegram_chat === 'Confirmado no bot');
if (filtroAtivo === 'pendente') lista = lista.filter(p => p.telegram_chat !== 'Confirmado no bot');
if (q) lista = lista.filter(p =>
p.nome_real.toLowerCase().includes(q) ||
p.player_id.toLowerCase().includes(q) ||
p.telegram_nome.toLowerCase().includes(q)
);
const tbody = document.getElementById('tbody');
if (!lista.length) {
tbody.innerHTML = '<tr><td colspan="7" class="empty">Nenhum participante encontrado.</td></tr>';
return;
}
tbody.innerHTML = lista.map(p => \`<tr>
<td class="num">\${p.numero}</td>
<td>\${p.player_id}</td>
<td>\${p.nome_real}</td>
<td>\${p.telegram_nome}</td>
<td class="\${p.telegram_chat === 'Confirmado no bot' ? 'ok' : 'pend'}">\${p.telegram_chat}</td>
<td>\${p.criado_em}</td>
<td><button class="btn-lib" onclick="liberar(\${parseInt(p.numero)})">\ud83d\uddd1\ufe0f Liberar</button></td>
</tr>\`).join('');
}

function renderChart() {
const contagem = {};
todos.forEach(p => {
const iso = p.criado_em_iso;
if (!iso) return;
const d = new Date(iso);
const chave = d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).replace(',', '');
contagem[chave] = (contagem[chave] || 0) + 1;
});
const labels = Object.keys(contagem).sort();
const data = labels.map(l => contagem[l]);
if (grafico) grafico.destroy();
const ctx = document.getElementById('chartHoras').getContext('2d');
grafico = new Chart(ctx, {
type: 'bar',
data: {
labels,
datasets: [{
label: 'Inscrições',
data,
backgroundColor: 'rgba(255,216,77,.7)',
borderColor: '#ffd84d',
borderWidth: 1,
borderRadius: 4,
}]
},
options: {
responsive: true,
plugins: { legend: { display: false } },
scales: {
x: { ticks: { color: '#9fc4b3', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.06)' } },
y: { ticks: { color: '#9fc4b3', stepSize: 1 }, grid: { color: 'rgba(255,255,255,.08)' }, beginAtZero: true }
}
}
});
}

async function sortear() {
if (!todos.length) { alert('Nenhum participante inscrito.'); return; }
if (!confirm('Sortear o ganhador OFICIAL agora?\\nEsta acao nao pode ser desfeita.')) return;
try {
const r = await fetch('/api/admin/sortear', { method: 'POST', credentials: 'include' });
const d = await r.json();
if (d.ok) { window.open(d.redirectUrl, '_blank'); }
else { alert('Erro: ' + (d.erro || 'desconhecido')); }
} catch(e) { alert('Erro: ' + e.message); }
}

function fecharModal(e) {
if (e.target === document.getElementById('modalOverlay'))
document.getElementById('modalOverlay').classList.remove('show');
}

async function liberar(numero) {
const n = String(numero).padStart(2, '0');
if (!confirm('Liberar o número ' + n + '?\\nEsta ação remove o participante e libera o slot.')) return;
try {
const r = await fetch('/api/admin/liberar/' + numero, { method: 'POST' });
const d = await r.json();
if (d.ok) { alert('\u2705 Número ' + n + ' liberado!'); carregar(); }
else alert('Erro: ' + d.erro);
} catch(e) { alert('Erro de conexão.'); }
}

async function resetarGrade() {
if (!confirm('\u26a0\ufe0f ATENÇÃO: Isso vai apagar TODOS os participantes e liberar todos os números.\\n\\nTem certeza?')) return;
if (!confirm('Segunda confirmação: realmente resetar toda a grade?')) return;
try {
const r = await fetch('/api/admin/reset', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ confirmacao: 'RESETAR' }) });
const d = await r.json();
if (d.ok) { alert('\u2705 Grade resetada! Todos os números estão disponíveis.'); carregar(); }
else alert('Erro: ' + d.erro);
} catch(e) { alert('Erro de conexão.'); }
}

carregar();
setInterval(carregar, 30000);
  async function toggleInscricoes() {
    const btn = document.getElementById('btnToggleInscricoes');
    btn.disabled = true;
    try {
      const r = await fetch('/api/admin/toggle-inscricoes', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (d.ok) {
        btn.innerHTML = d.inscricoesAbertas ? '&#x1F512; Encerrar Inscri&#xe7;&#xf5;es' : '&#x1F513; Abrir Inscri&#xe7;&#xf5;es';
        btn.style.background = d.inscricoesAbertas ? '#e67e22' : '#27ae60';
        alert(d.inscricoesAbertas ? 'Inscrições ABERTAS!' : 'Inscrições ENCERRADAS!');
      } else { alert(d.erro || 'Erro'); }
    } catch(e) { alert('Erro: ' + e.message); }
    btn.disabled = false;
  }
  async function definirDataSorteio() {
    var val = document.getElementById('inputDataSorteio').value;
    if (!val) { alert('Selecione uma data e hora.'); return; }
    var r = await fetch('/api/admin/set-countdown', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ dataHora: val }) });
    var d = await r.json();
    if (d.ok) {
      document.getElementById('dataSorteioInfo').textContent = 'Definido: ' + new Date(val).toLocaleString('pt-BR');
      alert('Data do sorteio definida!');
    }
  }

  async function carregarHistorico() {
    try {
      var r = await fetch('/api/admin/sorteios', { credentials: 'include' });
      var d = await r.json();
      var cont = document.getElementById('historicoContainer');
      if (!d.ok || !d.sorteios || !d.sorteios.length) {
        cont.innerHTML = '<p style="color:#9fc4b3;font-size:13px;padding:8px 0">Nenhum sorteio realizado ainda.</p>';
        return;
      }
      var rows = d.sorteios.map(function(s) {
        var dt = new Date(s.sorteadoEm).toLocaleString('pt-BR');
        var num = String(s.numero).padStart(3,'0');
        var bot = s.telegram_chat ? '&#x2705;' : '&#x2014;';
        return '<tr style="border-bottom:1px solid rgba(255,255,255,.07)">' +
          '<td style="padding:7px 10px;color:#9fc4b3;font-size:12px">' + dt + '</td>' +
          '<td style="padding:7px 10px;color:#ffd84d;font-weight:700">' + num + '</td>' +
          '<td style="padding:7px 10px">' + (s.nome_real||'&mdash;') + '</td>' +
          '<td style="padding:7px 10px;color:#9fc4b3">' + (s.player_id||'&mdash;') + '</td>' +
          '<td style="padding:7px 10px;text-align:center">' + bot + '</td></tr>';
      }).join('');
      cont.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<tr style="color:#9fc4b3;font-size:11px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.15)">' +
        '<th style="padding:7px 10px;text-align:left">Data/Hora</th>' +
        '<th style="padding:7px 10px;text-align:left">N&deg;</th>' +
        '<th style="padding:7px 10px;text-align:left">Nome</th>' +
        '<th style="padding:7px 10px;text-align:left">ID</th>' +
        '<th style="padding:7px 10px;text-align:center">Bot</th></tr>' +
        rows + '</table>';
    } catch(e) {
      document.getElementById('historicoContainer').innerHTML = '<p style="color:#9fc4b3;font-size:13px">Erro ao carregar hist&oacute;rico.</p>';
    }
  }
  carregarHistorico();

async function carregarDataSorteio() {
  try {
    var r = await fetch('/api/sorteio-info');
    var d = await r.json();
    if (d.ok && d.dataHoraSorteio) {
      document.getElementById('inputDataSorteio').value = d.dataHoraSorteio;
      document.getElementById('dataSorteioInfo').textContent = 'Definido: ' + new Date(d.dataHoraSorteio).toLocaleString('pt-BR');
    }
    var btn = document.getElementById('btnToggleInscricoes');
    if (btn) {
      btn.innerHTML = d.inscricoesAbertas === false ? '🔓 Abrir Inscrições' : '🔒 Encerrar Inscrições';
      btn.style.background = d.inscricoesAbertas === false ? '#27ae60' : '#e67e22';
    }
  } catch(e) {}
}
carregarDataSorteio();
</script>
</body>
</html>`);
});

app.post("/api/admin/toggle-inscricoes", checkAdmin, async function(req, res) {
  inscricoesAbertas = !inscricoesAbertas;
  await salvarEstado();
  console.log("[Admin] Inscricoes:", inscricoesAbertas ? "abertas" : "fechadas");
  res.json({ ok: true, inscricoesAbertas });
});
app.get("/api/sorteio-info", function(req, res) {
  res.json({ ok: true, dataHoraSorteio, inscricoesAbertas });
});

app.post("/api/admin/set-countdown", checkAdmin, async function(req, res) {
  var dh = req.body && req.body.dataHora ? req.body.dataHora : null;
  dataHoraSorteio = dh;
  await salvarEstado();
  console.log("[Admin] Data sorteio:", dataHoraSorteio || "removida");
  res.json({ ok: true, dataHoraSorteio });
});

app.get("/api/admin/sorteios", checkAdmin, function(req, res) {
  var lista = Object.entries(sorteiosAtivos).map(function(entry) {
    return Object.assign({ sorteioId: entry[0] }, entry[1]);
  }).sort(function(a, b) { return new Date(b.sorteadoEm) - new Date(a.sorteadoEm); });
  res.json({ ok: true, sorteios: lista });
});


app.listen(PORT, "0.0.0.0", () => {
console.log(`Servidor no ar na porta ${PORT}.`);
console.log(`Grade configurada de 1 a ${TOTAL}.`);
if (ADMIN_PASSWORD) console.log("[Admin] Painel disponível em /admin");
else console.warn("[Admin] ADMIN_PASSWORD nao definido - painel desabilitado.");
})
