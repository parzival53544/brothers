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

module.exports = function createWhatsApp(opts) {
  const AUTH_DIR = path.join(opts.dataDir, "wa-auth");
  let sock = null;
  let starting = false;
  let state = { status: "desconectado", qr: null };

  function getStatus() { return { status: state.status, qr: state.qr }; }
  function notifyChange() { if (opts.onStatusChange) opts.onStatusChange(getStatus()); }

  async function start() {
    if (starting) return;
    starting = true;
    try {
      const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      let version;
      try { version = (await fetchLatestBaileysVersion()).version; } catch (e) {}
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
    } catch (e) {
      console.error("Erro iniciando WhatsApp:", e.message);
      state = { status: "desconectado", qr: null };
      starting = false;
      setTimeout(start, 5000);
    }
  }

  async function logout() {
    try { if (sock) await sock.logout(); } catch (e) {}
    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
    state = { status: "desconectado", qr: null };
    notifyChange();
    setTimeout(start, 500);
  }

  function jidFor(phoneDigitsRaw) {
    let p = String(phoneDigitsRaw || "").replace(/\D/g, "");
    if (p.length <= 11) p = "55" + p; // assume Brasil quando não vier com código do país
    return p + "@s.whatsapp.net";
  }

  // sempre loga a tentativa (sucesso ou erro), pra dar visibilidade no painel
  async function sendMessage(phone, text, kind) {
    const phoneDigits = String(phone || "").replace(/\D/g, "");
    if (!sock || state.status !== "conectado") {
      if (opts.onMessage) opts.onMessage({ direction: "out", phone: phoneDigits, text: text, at: new Date().toISOString(), status: "erro", error: "WhatsApp não está conectado. Escaneie o QR Code na aba WhatsApp.", kind: kind || "geral" });
      return false;
    }
    try {
      await sock.sendMessage(jidFor(phone), { text: text });
      if (opts.onMessage) opts.onMessage({ direction: "out", phone: phoneDigits, text: text, at: new Date().toISOString(), status: "enviado", kind: kind || "geral" });
      return true;
    } catch (e) {
      if (opts.onMessage) opts.onMessage({ direction: "out", phone: phoneDigits, text: text, at: new Date().toISOString(), status: "erro", error: e.message, kind: kind || "geral" });
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

  // texto detalhado enviado assim que o pedido chega (confirmação com o resumo completo)
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
    if (jid.endsWith("@g.us") || jid === "status@broadcast" || !jid.endsWith("@s.whatsapp.net")) return;
    const phone = jid.split("@")[0];
    const text = ((msg.message && (msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text))) || "").trim();
    if (!text) return;
    if (opts.onMessage) opts.onMessage({ direction: "in", phone: phone, text: text, at: new Date().toISOString(), status: "recebido" });

    const lower = text.toLowerCase().trim();
    // opt-out de listas de transmissão (padrão de mercado: sempre permitir sair, mesmo com o bot desligado)
    if (/^(parar|sair|cancelar cadastro|descadastrar)$/i.test(lower)) {
      if (opts.onOptOut) opts.onOptOut(phone);
      await sendMessage(phone, "Combinado, você não vai mais receber nossas mensagens promocionais. Se precisar, é só chamar de novo. 🙏", "opt-out");
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
    await sendMessage(phone, reply, "bot");
  }

  start();
  return { getStatus, logout, sendMessage, orderStatusText, orderConfirmationText };
};
