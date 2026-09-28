// Brothers - integração com WhatsApp (Baileys, não-oficial)
"use strict";
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const RECONNECT_MITIGATION_MS = 6 * 60 * 60 * 1000; // reinício preventivo a cada 6h (mitigação sugerida pela comunidade pra mensagens que ficam "travadas")
const ACK_TIMEOUT_MS = 20000; // se não confirmar em 20s, avisa que pode não ter chegado

module.exports = function createWhatsApp(opts) {
  const AUTH_DIR = path.join(opts.dataDir, "wa-auth");
  let sock = null;
  let starting = false;
  let state = { status: "desconectado", qr: null };
  const pendingAcks = new Map(); // id da mensagem no WhatsApp -> { logId, timer }

  function getStatus() { return { status: state.status, qr: state.qr }; }
  function notifyChange() { if (opts.onStatusChange) opts.onStatusChange(getStatus()); }
  function logEntry(e) {
    e.at = new Date().toISOString();
    return opts.onMessage ? opts.onMessage(e) : e;
  }

  async function start() {
    if (starting) return;
    starting = true;
    try {
      const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      let version;
      try { version = (await fetchLatestBaileysVersion()).version; }
      catch (e) { console.error("Não consegui checar a versão mais recente do protocolo do WhatsApp (provável falta de rede de saída) — usando a versão padrão da biblioteca:", e.message); }
      sock = makeWASocket({ auth: authState, version: version, logger: pino({ level: "silent" }), printQRInTerminal: false });
      sock.ev.on("creds.update", saveCreds);
      sock.ev.on("connection.update", async (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) { state.qr = await QRCode.toDataURL(qr); state.status = "aguardando_qr"; notifyChange(); }
        if (connection === "open") { state.status = "conectado"; state.qr = null; notifyChange(); }
        if (connection === "close") {
          state.status = "desconectado"; state.qr = null; notifyChange();
          starting = false;
          const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
          if (code !== DisconnectReason.loggedOut) setTimeout(start, 3000);
        }
      });
      sock.ev.on("messages.upsert", async (m) => {
        try { await handleIncoming(m); } catch (e) { console.error("Erro processando mensagem do WhatsApp:", e.message); }
      });
      // confirmação real de entrega: só marcamos como "entregue" quando o WhatsApp confirma via ACK,
      // não apenas quando sock.sendMessage() retorna sem erro (isso é um bug conhecido e sem correção
      // definitiva da própria biblioteca: às vezes ela "resolve" a promessa sem a mensagem chegar de verdade)
      sock.ev.on("messages.update", (updates) => {
        (updates || []).forEach((u) => {
          if (!u.key || !u.key.fromMe || !u.key.id) return;
          const pending = pendingAcks.get(u.key.id);
          if (!pending) return;
          const ackStatus = u.update && u.update.status;
          if (typeof ackStatus === "number" && ackStatus >= 3) {
            clearTimeout(pending.timer);
            pendingAcks.delete(u.key.id);
            if (opts.onMessageUpdate) opts.onMessageUpdate(pending.logId, { status: "entregue" });
          }
        });
      });
    } catch (e) {
      console.error("Erro iniciando WhatsApp:", e.message);
      state = { status: "desconectado", qr: null };
      starting = false;
      setTimeout(start, 5000);
    }
  }

  // mitigação sugerida pela comunidade do Baileys pra reduzir mensagens que ficam "travadas"
  // sem confirmar entrega: reinicia a conexão periodicamente, sem precisar escanear o QR de novo
  setInterval(() => {
    if (state.status === "conectado" && sock) {
      console.log("Reiniciando a conexão do WhatsApp preventivamente (mitigação de mensagens travadas)...");
      try { sock.end(undefined); } catch (e) {}
    }
  }, RECONNECT_MITIGATION_MS);

  async function logout() {
    try { if (sock) await sock.logout(); } catch (e) {}
    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
    state = { status: "desconectado", qr: null };
    notifyChange();
    setTimeout(start, 500);
  }

  function guessNumbers(phoneDigitsRaw) {
    let p = String(phoneDigitsRaw || "").replace(/\D/g, "");
    if (p.length <= 11) p = "55" + p; // assume Brasil quando não vier com código do país
    const out = [p];
    // erro de digitação mais comum no Brasil: o 9º dígito extra do celular presente ou faltando
    if (p.length === 13 && p.startsWith("55")) {
      const ddd = p.slice(2, 4), rest = p.slice(4);
      if (rest.length === 9 && rest[0] === "9") out.push("55" + ddd + rest.slice(1));
      else if (rest.length === 8) out.push("55" + ddd + "9" + rest);
    }
    return out;
  }
  // confere de verdade se o número existe no WhatsApp antes de mandar — isso evita o caso mais comum
  // de "mostra como enviado mas não chega": número digitado errado ou sem o 9º dígito
  async function resolveJid(phoneDigitsRaw) {
    for (const candidate of guessNumbers(phoneDigitsRaw)) {
      try {
        const res = await sock.onWhatsApp(candidate + "@s.whatsapp.net");
        if (res && res[0] && res[0].exists) return res[0].jid;
      } catch (e) {}
    }
    return null;
  }

  async function sendMessage(phone, text, kind, directJid) {
    const phoneDigits = String(phone || "").replace(/\D/g, "");
    if (!sock || state.status !== "conectado") {
      logEntry({ direction: "out", phone: phoneDigits, text: text, status: "erro", error: "WhatsApp não está conectado. Escaneie o QR Code na aba WhatsApp.", kind: kind || "geral" });
      return false;
    }
    // resposta a uma mensagem recebida: usa exatamente o mesmo endereço de onde ela veio
    const jid = directJid || await resolveJid(phoneDigits);
    if (!jid) {
      logEntry({ direction: "out", phone: phoneDigits, text: text, status: "erro", error: "Esse número não foi encontrado no WhatsApp — confira se está certo, com DDD.", kind: kind || "geral" });
      return false;
    }
    try {
      const sent = await sock.sendMessage(jid, { text: text });
      const entry = logEntry({ direction: "out", phone: phoneDigits, text: text, status: "enviado", kind: kind || "geral" });
      if (entry && entry.id && sent && sent.key && sent.key.id) {
        const timer = setTimeout(() => {
          pendingAcks.delete(sent.key.id);
          if (opts.onMessageUpdate) opts.onMessageUpdate(entry.id, { status: "sem_confirmacao", error: "O WhatsApp não confirmou a entrega em 20s — pode não ter chegado (isso é um problema conhecido e ainda sem correção da biblioteca não-oficial que usamos)." });
        }, ACK_TIMEOUT_MS);
        pendingAcks.set(sent.key.id, { logId: entry.id, timer: timer });
      }
      return true;
    } catch (e) {
      logEntry({ direction: "out", phone: phoneDigits, text: text, status: "erro", error: e.message, kind: kind || "geral" });
      return false;
    }
  }

  function orderStatusText(order) {
    const num = "#" + String(order.number).padStart(3, "0");
    if (order.status === "solicitacao") return "Recebemos seu pedido " + num + "! Já estamos confirmando por aqui. ✅";
    if (order.status === "producao") return "Seu pedido " + num + " foi aceito e já está em preparo! 👨‍🍳";
    if (order.status === "pronto") {
      if (order.dispatched) return "Seu pedido " + num + " já saiu para entrega! 🛵";
      if (order.type === "delivery") return "Seu pedido " + num + " está pronto! Em instantes sai para entrega. 🛵";
      if (order.type === "retirada") return "Seu pedido " + num + " está pronto para retirada! Pode vir buscar. 🥡";
      return "Seu pedido " + num + " está pronto! 🎉";
    }
    if (order.status === "finalizado") return "Seu pedido " + num + " foi concluído. Obrigado pela preferência! 🙏";
    return "Não encontrei um pedido em andamento com esse número.";
  }

  function orderConfirmationText(order, fmtMoney) {
    const num = "#" + String(order.number).padStart(3, "0");
    const lines = order.lines.map((l) => {
      var t = "- " + l.qty + "x " + l.name + " (" + fmtMoney(l.price * l.qty) + ")";
      if (l.addons && l.addons.length) t += "\n  + " + l.addons.map((a) => a.name).join(", ");
      return t;
    }).join("\n");
    var addr = order.delivery ? ("\nEntrega em: " + order.delivery.street + ", " + order.delivery.number + " - " + order.delivery.neighborhood + " (taxa " + fmtMoney(order.delivery.fee) + ")") : "";
    return "Recebemos seu pedido " + num + "! ✅\n\n" + lines + addr + "\n\n*Total: " + fmtMoney(order.total) + "*\n\nJá vamos confirmar e te avisamos por aqui a cada etapa.";
  }

  async function handleIncoming(m) {
    const msg = m.messages && m.messages[0];
    if (!msg || msg.key.fromMe) return;
    const jid = msg.key.remoteJid || "";
    // versões novas do WhatsApp podem endereçar o contato como "@lid" (id interno) em vez do número;
    // quando vier o número real como alternativa, usamos ele só pra exibir/agrupar a conversa
    const alt = msg.key.remoteJidAlt || "";
    const isPerson = jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
    if (!isPerson) return;
    const phoneJid = jid.endsWith("@s.whatsapp.net") ? jid : (alt.endsWith("@s.whatsapp.net") ? alt : jid);
    const phone = phoneJid.split("@")[0].split(":")[0];
    const text = ((msg.message && (msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text))) || "").trim();
    if (!text) return;
    logEntry({ direction: "in", phone: phone, text: text, status: "recebido" });

    const lower = text.toLowerCase().trim();
    if (/^(parar|sair|cancelar cadastro|descadastrar)$/i.test(lower)) {
      if (opts.onOptOut) opts.onOptOut(phone);
      await sendMessage(phone, "Combinado, você não vai mais receber nossas mensagens promocionais. Se precisar, é só chamar de novo. 🙏", "opt-out", jid);
      return;
    }
    if (!opts.getBotEnabled || !opts.getBotEnabled()) return;

    const ctx = opts.getBotContext ? opts.getBotContext() : {};
    let reply;
    if (/^1\b|cardap|menu/.test(lower)) {
      reply = ctx.menuUrl ? "Aqui está nosso cardápio: " + ctx.menuUrl : "Peça pro atendente te passar o link do nosso cardápio, já estamos vendo sua mensagem.";
    } else if (/^2\b|status|meu pedido|pedido/.test(lower)) {
      const order = ctx.findActiveOrderByPhone ? ctx.findActiveOrderByPhone(phone) : null;
      reply = order ? orderStatusText(order) : "Não encontrei nenhum pedido em andamento com esse número.";
    } else if (/^3\b|atendente|humano/.test(lower)) {
      reply = "Combinado, um atendente humano vai te responder por aqui em instantes.";
    } else {
      reply = "Olá! 👋\n1 - Ver cardápio\n2 - Status do meu pedido\n3 - Falar com atendente";
    }
    await sendMessage(phone, reply, "bot", jid);
  }

  start();
  return { getStatus, logout, sendMessage, orderStatusText, orderConfirmationText };
};
