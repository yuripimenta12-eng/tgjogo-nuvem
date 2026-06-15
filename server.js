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
// ARMAZENAMENTO — Upstash Redis (permanente) ou arquivo JSON (local)
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
// Handle double-encoding: if still a string after first parse, parse again
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
console.log("[Storage] Usando Upstash Redis — dados persistentes.");
} else {
console.warn("[Storage] Upstash nao configurado — usando arquivo local.");
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
// BOT DO TELEGRAM (modo webhook — sem conflito 409 entre deploys)
// --------------------------------------------------------------------
const WEBHOOK_PATH = `/tg/${TELEGRAM_BOT_TOKEN}`;
const WEBHOOK_URL  = `https://numerodasortetg.onrender.com${WEBHOOK_PATH}`;

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

// --------------------------------------------------------------------
// /meu_numero — jogador consulta seu numero pelo bot
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
"🎯 Seu número da sorte é o *" + numero + "*!\n\n" +
"👤 Nome: " + reserva.nome_real + "\n" +
"🆔 ID: " + reserva.player_id + "\n\n" +
"Boa sorte na Copa TGJOGO! ⚽",
{ parse_mode: "Markdown" }
);
} else {
bot.sendMessage(
chatId,
"❌ Você ainda não tem um número registrado.\n\n" +
"Acesse o site e escolha o seu! 🎟️"
);
}
});

function avisarEquipe(reserva) {
if (!TELEGRAM_TEAM_CHAT_ID || TELEGRAM_TEAM_CHAT_ID.includes("xxxx")) return;
const agora = new Date();
const data = agora.toLocaleDateString("pt-BR");
const hora = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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
app.set("trust proxy", 1);
app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.static(path.join(__dirname, "site")));

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
// ROTAS PUBLICAS
// --------------------------------------------------------------------
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
res.send("﻿" + linhas);
});

// --------------------------------------------------------------------
// LIBERAR NUMERO (admin) -- remove participante e libera o slot
// --------------------------------------------------------------------
app.post("/api/admin/liberar/:numero", checkAdmin, async (req, res) => {
const num = parseInt(req.params.numero, 10);
if (!numeroValido(num)) return res.status(400).json({ ok: false, erro: "Número inválido." });
const idx = reservas.findIndex((r) => r.numero === num);
if (idx === -1) return res.status(404).json({ ok: false, erro: "Número não registrado." });
const removida = reservas.splice(idx, 1)[0];
await salvarReservas(reservas);
console.log(`[Admin] Número ${num} liberado (era de ${removida.player_id})`);
res.json({ ok: true, numero: num, player_id: removida.player_id });
});

app.get("/admin", checkAdmin, (req, res) => {
res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin · Copa TGJOGO</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",system-ui,sans-serif;background:#0b3d2e;color:#f0faf5;min-height:100vh;padding:24px 16px}
.wrap{max-width:1100px;margin:0 auto}
h1{color:#ffd84d;font-size:22px;margin-bottom:4px}
.sub{color:#9fc4b3;font-size:13px;margin-bottom:20px}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.stat{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 20px;min-width:130px}
.stat .{font-size:32px;font-weight:900;color:#ffd84d}
.stat .l{font-size:12px;color:#9fc4b3;margin-top:2px}
.btn{background:linear-gradient(180deg,#ffd84d,#f5a623);color:#0a2a20;font-weight:800;border:none;border-radius:10px;padding:11px 22px;font-size:14px;cursor:pointer;text-decoration:none;display:inline-block;margin-bottom:18px}
.btn:hover{filter:brightness(1.1)}
.btn-lib{background:rgba(255,80,60,.12);border:1px solid rgba(255,80,60,.35);color:#ff7070;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-weight:600}
.btn-lib:hover{background:rgba(255,80,60,.28)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:rgba(255,255,255,.1);padding:10px 12px;text-align:left;color:#ffd84d;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:middle}
tr:hover td{background:rgba(255,255,255,.04)}
.num{font-weight:900;font-size:18px;color:#ffd84d}
.ok{color:#2e9e5b;font-weight:700}
.pend{color:#9fc4b3}
.empty{text-align:center;padding:40px;color:#9fc4b3}
.refresh{font-size:12px;color:#9fc4b3;margin-bottom:12px}
input[type=text]{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:8px 12px;color:#fff;font-size:13px;width:260px;margin-bottom:14px}
input[type=text]::placeholder{color:#9fc4b3}
</style>
</head>
<body>
<div class="wrap">
<h1>🏆 Painel Admin · Copa TGJOGO</h1>
<div class="sub" id="atualizado">Carregando...</div>

<div class="stats">
<div class="stat"><div class="n" id="sTotal">—</div><div class="l">Inscritos</div></div>
<div class="stat"><div class="n" id="sDisp">—</div><div class="l">Disponíveis</div></div>
<div class="stat"><div class="n" id="sBot">—</div><div class="l">Confirmados no Bot</div></div>
</div>

<a class="btn" href="/api/admin/exportar">⬇️ Exportar CSV</a>

<div class="refresh">🔄 Atualiza automaticamente a cada 30 segundos</div>
<input type="text" id="busca" placeholder="Buscar por nome, ID ou Telegram..." oninput="filtrar()"/>

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
</div>
<script>
let todos = [];

async function carregar() {
try {
const r = await fetch('/api/admin/participantes', { credentials: 'include' });
const d = await r.json();
todos = d.participantes || [];
document.getElementById('sTotal').textContent = d.total;
document.getElementById('sDisp').textContent = d.disponiveis;
document.getElementById('sBot').textContent = todos.filter(p => p.telegram_chat === 'Confirmado no bot').length;
document.getElementById('atualizado').textContent = 'Última atualização: ' + new Date().toLocaleTimeString('pt-BR');
filtrar();
} catch(e) {
document.getElementById('atualizado').textContent = 'Erro ao carregar dados.';
}
}

function filtrar() {
const q = document.getElementById('busca').value.toLowerCase();
const lista = q ? todos.filter(p =>
p.nome_real.toLowerCase().includes(q) ||
p.player_id.toLowerCase().includes(q) ||
p.telegram_nome.toLowerCase().includes(q)
) : todos;
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
<td><button class="btn-lib" onclick="liberar(\${parseInt(p.numero)})">🗑️ Liberar</button></td>
</tr>\`).join('');
}

async function liberar(numero) {
const n = String(numero).padStart(2, '0');
if (!confirm('Liberar o número ' + n + '?\\nEsta ação remove o participante e libera o slot.')) return;
try {
const r = await fetch('/api/admin/liberar/' + numero, { method: 'POST' });
const d = await r.json();
if (d.ok) { alert('✅ Número ' + n + ' liberado!'); carregar(); }
else alert('Erro: ' + d.erro);
} catch(e) { alert('Erro de conexão.'); }
}

carregar();
setInterval(carregar, 30000);
</script>
</body>
</html>`);
});

app.listen(PORT, "0.0.0.0", () => {
console.log(`Servidor no ar na porta ${PORT}.`);
console.log(`Grade configurada de 1 a ${TOTAL}.`);
if (ADMIN_PASSWORD) console.log("[Admin] Painel disponível em /admin");
else console.warn("[Admin] ADMIN_PASSWORD nao definido - painel desabilitado.");
});
