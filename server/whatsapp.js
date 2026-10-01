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
const { normalizePhoneBR, firstName } = require("./phone");

const RECONNECT_MITIGATION_MS = 6 * 60 * 60 * 1000; // reinício preventivo a cada 6h
const ACK_TIMEOUT_MS = 20000; // se o WhatsApp não confirmar em 20s, avisa que pode não ter chegado

const PAY_LABEL = { dinheiro: "Dinheiro", cartao: "Cartão", pix: "Pix", pix_entrega: "Pix na entrega", pix_online: "Pix (online)", balcao: "Balcão" };

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
      catch (e) { console.error("Não consegui checar a versão mais recente do protocolo do WhatsApp — usando a padrão da biblioteca:", e.message); }
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
      // só marcamos como "entregue" quando o WhatsApp confirma via ACK (sendMessage resolver sem erro não garante entrega)
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

  setInterval(() => {
    if (state.status === "conectado" && sock) {
      console.log("Reiniciando a conexão do WhatsApp preventivamente...");
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

  // candidatos de número: primeiro o normalizado (55 + DDD + 9 + número); depois, sem o 9
  // (algumas contas antigas do WhatsApp ainda existem sem o 9 extra)
  function guessNumbers(raw) {
    const p = normalizePhoneBR(raw);
    const out = [p];
    if (p.length === 13 && p.startsWith("55") && p[4] === "9") out.push(p.slice(0, 4) + p.slice(5));
    return out;
  }
  async function resolveJid(raw) {
    for (const candidate of guessNumbers(raw)) {
      try {
        const res = await sock.onWhatsApp(candidate + "@s.whatsapp.net");
        if (res && res[0] && res[0].exists) return res[0].jid;
      } catch (e) {}
    }
    return null;
  }

  // image (opcional): data URL da imagem; o texto vira a legenda
  async function sendMessage(phone, text, kind, directJid, image) {
    const phoneKey = normalizePhoneBR(phone);
    const base = { direction: "out", phone: phoneKey, text: text, kind: kind || "geral", hasImage: !!image };
    if (!sock || state.status !== "conectado") {
      logEntry(Object.assign({ status: "erro", error: "WhatsApp não está conectado. Escaneie o QR Code na aba WhatsApp." }, base));
      return false;
    }
    const jid = directJid || await resolveJid(phone);
    if (!jid) {
      logEntry(Object.assign({ status: "erro", error: "Esse número não foi encontrado no WhatsApp — confira se está certo, com DDD." }, base));
      return false;
    }
    try {
      let content = { text: text };
      if (image) {
        const m = /^data:image\/[\w.+-]+;base64,(.+)$/.exec(image);
        if (m) content = { image: Buffer.from(m[1], "base64"), caption: text };
      }
      const sent = await sock.sendMessage(jid, content);
      const entry = logEntry(Object.assign({ status: "enviado" }, base));
      if (entry && entry.id && sent && sent.key && sent.key.id) {
        const timer = setTimeout(() => {
          pendingAcks.delete(sent.key.id);
          if (opts.onMessageUpdate) opts.onMessageUpdate(entry.id, { status: "sem_confirmacao", error: "O WhatsApp não confirmou a entrega em 20s — pode não ter chegado (problema conhecido da biblioteca não-oficial que usamos)." });
        }, ACK_TIMEOUT_MS);
        pendingAcks.set(sent.key.id, { logId: entry.id, timer: timer });
      }
      return true;
    } catch (e) {
      logEntry(Object.assign({ status: "erro", error: e.message }, base));
      return false;
    }
  }

  // ---------- textos ----------
  function who(order) { return firstName(order.customerName) || "cliente"; }
  function numTag(order) { return "*#" + String(order.number).padStart(3, "0") + "*"; }

  function orderStatusText(order) {
    const n = who(order), num = numTag(order);
    if (order.status === "solicitacao") return "Oi, " + n + "! Recebemos seu pedido " + num + " e já estamos confirmando. ✅";
    if (order.status === "producao") return "Boa notícia, " + n + "! 🎉 Seu pedido " + num + " foi aceito e já está sendo preparado. 👨‍🍳";
    if (order.status === "pronto") {
      if (order.dispatched) return n + ", seu pedido " + num + " saiu para entrega! 🛵 Fica de olho, já já chega aí.";
      if (order.type === "delivery") return n + ", seu pedido " + num + " está prontinho! 😋 O entregador já vai sair.";
      if (order.type === "retirada") return n + ", seu pedido " + num + " está pronto para retirada! 🥡 Pode vir buscar, estamos te esperando.";
      return n + ", seu pedido " + num + " está pronto! 🍽️ Já já ele chega até você.";
    }
    if (order.status === "finalizado") return "Pedido " + num + " concluído! Obrigado pela preferência, " + n + ". 🙏 Quando bater a fome é só chamar de novo!";
    if (order.status === "recusado") return n + ", infelizmente não conseguimos aceitar seu pedido " + num + " agora. 😕 Fala com a gente por aqui que a gente resolve!";
    return "Não encontrei um pedido em andamento com esse número.";
  }

  function orderConfirmationText(order, fmtMoney, trackUrl) {
    const n = who(order), num = numTag(order);
    const lines = order.lines.map((l) => {
      let t = "• " + l.qty + "x " + l.name + " — " + fmtMoney(l.price * l.qty);
      if (l.addons && l.addons.length) t += "\n   + " + l.addons.map((a) => a.name).join(", ");
      return t;
    }).join("\n");
    const addr = order.delivery ? "\n📍 Entrega em: " + order.delivery.street + ", " + order.delivery.number + " — " + order.delivery.neighborhood + " (taxa " + fmtMoney(order.delivery.fee) + ")" : "";
    const pay = order.payment && order.payment.method ? "\n💳 Pagamento: " + (PAY_LABEL[order.payment.method] || order.payment.method) : "";
    const link = trackUrl ? "\n\nAcompanhe cada etapa em tempo real:\n" + trackUrl : "\n\nVamos te avisando por aqui a cada etapa.";
    return "Oi, " + n + "! 😊 Recebemos seu pedido " + num + "!\n\n" + lines + addr + pay + "\n\n*Total: " + fmtMoney(order.total) + "*" + link;
  }

  // ---------- mensagens recebidas / bot ----------
  async function handleIncoming(m) {
    const msg = m.messages && m.messages[0];
    if (!msg || msg.key.fromMe) return;
    const jid = msg.key.remoteJid || "";
    // versões novas do WhatsApp podem endereçar o contato como "@lid"; quando vem o número real como alternativa, usamos ele
    const alt = msg.key.remoteJidAlt || "";
    const isPerson = jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
    if (!isPerson) return;
    const phoneJid = jid.endsWith("@s.whatsapp.net") ? jid : (alt.endsWith("@s.whatsapp.net") ? alt : jid);
    const phone = normalizePhoneBR(phoneJid.split("@")[0].split(":")[0]);
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
    // enquanto um humano não respondeu, o robô fica quieto pra não atrapalhar a conversa
    if (opts.isHumanPending && opts.isHumanPending(phone)) return;

    const ctx = opts.getBotContext ? opts.getBotContext() : {};
    const nome = (ctx.findCustomerName && firstName(ctx.findCustomerName(phone))) || "";
    const oi = nome ? "Olá, " + nome + "! 👋" : "Olá! 👋";
    let reply;
    if (/^3\b|atendente|humano|atendimento|falar com (alguem|alguém|uma pessoa|pessoa)/.test(lower)) {
      if (opts.onHumanRequest) opts.onHumanRequest(phone, nome);
      reply = "Combinado" + (nome ? ", " + nome : "") + "! 🙋 Já avisamos nossa equipe — um atendente vai te responder por aqui em instantes.";
    } else if (/^1\b|cardap|menu/.test(lower)) {
      const url = ctx.menuUrl ? ctx.menuUrl() : "";
      reply = url ? "Aqui está nosso cardápio" + (nome ? ", " + nome : "") + " 😋\n" + url : "Já já um atendente te passa o link do nosso cardápio! 😊";
    } else if (/^2\b|status|meu pedido|pedido/.test(lower)) {
      const order = ctx.findActiveOrderByPhone ? ctx.findActiveOrderByPhone(phone) : null;
      if (order) {
        const link = ctx.trackUrlFor ? ctx.trackUrlFor(order) : "";
        reply = orderStatusText(order) + (link ? "\n\nAcompanhe em tempo real:\n" + link : "");
      } else reply = "Não encontrei nenhum pedido em andamento com esse número. 🤔";
    } else {
      reply = oi + "\nComo posso ajudar?\n\n1 - Ver cardápio\n2 - Status do meu pedido\n3 - Falar com atendente";
    }
    await sendMessage(phone, reply, "bot", jid);
  }

  start();
  return { getStatus, logout, sendMessage, orderStatusText, orderConfirmationText };
};
