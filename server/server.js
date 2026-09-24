// Brothers - backend (Express + arquivo JSON persistido em disco) - v2
"use strict";
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "brothers-dev-secret-troque-isso";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function defaultBusinessHours() {
  const h = {};
  WEEKDAYS.forEach((d) => { h[d] = { closed: false, open: "00:00", close: "23:59" }; });
  return h;
}
function randomSlug() { return crypto.randomBytes(5).toString("hex"); }

// ---------- persistência ----------
function defaultData() {
  return {
    menu: [
      { id: "m1", name: "X-Burger", description: "Pão, hambúrguer, queijo, alface e tomate.", price: 22.0, category: "Lanches", order: 0, image: "", active: true, addonGroupIds: [], stock: { enabled: false, quantity: 0 } },
      { id: "m2", name: "X-Salada", description: "Pão, hambúrguer, queijo, alface, tomate e maionese da casa.", price: 24.0, category: "Lanches", order: 1, image: "", active: true, addonGroupIds: [], stock: { enabled: false, quantity: 0 } },
      { id: "m3", name: "Batata frita", description: "Porção de batata frita crocante.", price: 15.0, category: "Porções", order: 0, image: "", active: true, addonGroupIds: [], stock: { enabled: false, quantity: 0 } },
      { id: "m4", name: "Refrigerante lata", description: "", price: 6.0, category: "Bebidas", order: 0, image: "", active: true, addonGroupIds: [], stock: { enabled: false, quantity: 0 } },
      { id: "m5", name: "Suco natural", description: "", price: 8.0, category: "Bebidas", order: 1, image: "", active: true, addonGroupIds: [], stock: { enabled: false, quantity: 0 } }
    ],
    orders: [],
    dayCounter: { date: "", count: 0 },
    users: [
      { id: "u1", username: "admin", passwordHash: bcrypt.hashSync("admin", 10), role: "admin", name: "Administrador" },
      { id: "u2", username: "garcom", passwordHash: bcrypt.hashSync("garcom", 10), role: "garcom", name: "Garçom" }
    ],
    config: {
      whatsapp: "", pixKey: "", pixName: "", onlinePaymentEnabled: false,
      accentColor: "#B9862F", logoImage: "", coverImage: "",
      categoryOrder: [], disabledCategories: [], deliveryZones: [],
      addonGroups: [],
      staffSlug: randomSlug(),
      notificationSound: "",
      timezone: "America/Manaus",
      businessHours: defaultBusinessHours(),
      emergencyClosed: false
    }
  };
}

// migra bancos antigos que não tinham os campos novos
function migrate(data) {
  data.config = Object.assign({
    whatsapp: "", pixKey: "", pixName: "", onlinePaymentEnabled: false,
    accentColor: "#B9862F", logoImage: "", coverImage: "",
    categoryOrder: [], disabledCategories: [], deliveryZones: [],
    addonGroups: [], staffSlug: randomSlug(), notificationSound: "",
    timezone: "America/Manaus", businessHours: defaultBusinessHours(), emergencyClosed: false
  }, data.config || {});
  if (!data.config.businessHours) data.config.businessHours = defaultBusinessHours();
  if (!data.config.staffSlug) data.config.staffSlug = randomSlug();
  if (!Array.isArray(data.config.addonGroups)) data.config.addonGroups = [];
  if (!Array.isArray(data.config.disabledCategories)) data.config.disabledCategories = [];

  data.menu = (data.menu || []).map((m, idx) => {
    const item = Object.assign({ order: idx, image: "", description: "", active: true, addonGroupIds: [], stock: { enabled: false, quantity: 0 } }, m);
    // migra o formato antigo (item.addons embutido) para um grupo de complementos
    if (Array.isArray(m.addons) && m.addons.length && !m.addonGroupIds) {
      const group = { id: crypto.randomBytes(8).toString("hex"), name: item.name + " - complementos", type: "multi", options: m.addons.map((a) => ({ id: a.id || crypto.randomBytes(8).toString("hex"), name: a.name, price: a.price })) };
      data.config.addonGroups.push(group);
      item.addonGroupIds = [group.id];
    }
    delete item.addons;
    return item;
  });
  data.orders = (data.orders || []).map((o) => Object.assign({ delivery: null, stockReturned: false }, o));
  return data;
}

let db;
function loadData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    db = defaultData();
    persist();
  } else {
    try {
      db = migrate(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
    } catch (e) {
      console.error("Falha ao ler data.json, recriando com dados padrão.", e);
      db = defaultData();
      persist();
    }
  }
}
let writeQueue = Promise.resolve();
function persist() {
  writeQueue = writeQueue.then(() =>
    new Promise((resolve) => {
      const tmp = DATA_FILE + ".tmp";
      fs.writeFile(tmp, JSON.stringify(db, null, 2), (err) => {
        if (err) { console.error("Erro salvando dados:", err); return resolve(); }
        fs.rename(tmp, DATA_FILE, (err2) => {
          if (err2) console.error("Erro substituindo data.json:", err2);
          resolve();
        });
      });
    })
  );
  return writeQueue;
}
loadData();

// ---------- tempo real (Server-Sent Events) ----------
const sseClients = new Set();
function broadcast(type, payload) {
  const msg = "event: " + type + "\ndata: " + JSON.stringify(payload || {}) + "\n\n";
  for (const res of sseClients) { try { res.write(msg); } catch (e) {} }
}

// ---------- helpers ----------
function uid() { return crypto.randomBytes(8).toString("hex"); }
function todayStr(d) {
  d = d || new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function nextDailyNumber() {
  const t = todayStr();
  if (db.dayCounter.date !== t) db.dayCounter = { date: t, count: 0 };
  db.dayCounter.count += 1;
  return db.dayCounter.count;
}

// ---------- horário de funcionamento ----------
function nowInZone(tz) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = fmt.formatToParts(new Date());
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  const weekdayMap = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };
  let hour = map.hour === "24" ? "00" : map.hour;
  return { day: weekdayMap[map.weekday], hm: hour + ":" + map.minute };
}
function openStatus() {
  if (db.config.emergencyClosed) return { open: false, reason: "fechado_emergencia" };
  const tz = db.config.timezone || "America/Manaus";
  let n;
  try { n = nowInZone(tz); } catch (e) { return { open: true, reason: "fuso_invalido" }; }
  const cfg = (db.config.businessHours || {})[n.day];
  if (!cfg || cfg.closed) return { open: false, reason: "fechado_hoje" };
  if (n.hm < cfg.open || n.hm > cfg.close) return { open: false, reason: "fora_do_horario" };
  return { open: true };
}

function publicConfig() {
  return {
    whatsapp: db.config.whatsapp || "",
    pixKey: db.config.pixKey || "",
    pixName: db.config.pixName || "",
    onlinePaymentEnabled: !!db.config.onlinePaymentEnabled,
    accentColor: db.config.accentColor || "#B9862F",
    logoImage: db.config.logoImage || "",
    coverImage: db.config.coverImage || "",
    deliveryZones: db.config.deliveryZones || [],
    status: openStatus(),
    businessHours: db.config.businessHours,
    timezone: db.config.timezone,
    staffSlug: db.config.staffSlug
  };
}
function publicUser(u) { return { id: u.id, username: u.username, role: u.role, name: u.name }; }

function itemAddonGroups(item) {
  return (item.addonGroupIds || []).map((gid) => (db.config.addonGroups || []).find((g) => g.id === gid)).filter(Boolean);
}
function decorateItem(item) { return Object.assign({}, item, { addonGroups: itemAddonGroups(item) }); }

function sortedMenu(menu) {
  const catOrder = db.config.categoryOrder || [];
  const catIndex = (c) => { const i = catOrder.indexOf(c); return i === -1 ? 999 : i; };
  return [...menu].sort((a, b) => {
    const ca = catIndex(a.category), cb = catIndex(b.category);
    if (ca !== cb) return ca - cb;
    if (a.category !== b.category) return a.category.localeCompare(b.category, "pt-BR");
    return (a.order || 0) - (b.order || 0);
  });
}
function publicMenuList() {
  const disabled = db.config.disabledCategories || [];
  return sortedMenu(db.menu).filter((m) => m.active !== false && disabled.indexOf(m.category) === -1).map(decorateItem);
}
function staffMenuList() { return sortedMenu(db.menu).map(decorateItem); }

function resolveOrderLines(lines) {
  const resolvedLines = [];
  for (const l of lines) {
    const item = db.menu.find((m) => m.id === l.menuId);
    if (!item) throw { code: 400, msg: "item de cardápio inválido" };
    if (item.active === false) throw { code: 400, msg: "item indisponível: " + item.name };
    const qty = Math.max(1, parseInt(l.qty, 10) || 1);
    if (item.stock && item.stock.enabled && item.stock.quantity < qty) throw { code: 400, msg: "sem estoque suficiente de: " + item.name };

    let addonsTotal = 0;
    const chosenAddons = [];
    const groups = itemAddonGroups(item);
    const chosenIds = Array.isArray(l.addonIds) ? l.addonIds : [];
    groups.forEach((g) => {
      const inGroup = g.options.filter((o) => chosenIds.indexOf(o.id) !== -1);
      if (g.type === "single" && inGroup.length > 1) throw { code: 400, msg: 'escolha apenas 1 opção em "' + g.name + '"' };
      inGroup.forEach((o) => { chosenAddons.push({ id: o.id, name: o.name, price: o.price, group: g.name }); addonsTotal += o.price; });
    });
    resolvedLines.push({ menuId: item.id, name: item.name, price: item.price + addonsTotal, basePrice: item.price, addons: chosenAddons, qty });
  }
  return resolvedLines;
}
function applyStockDelta(lines, sign) {
  for (const l of lines) {
    const item = db.menu.find((m) => m.id === l.menuId);
    if (item && item.stock && item.stock.enabled) item.stock.quantity = Math.max(0, item.stock.quantity + sign * l.qty);
  }
}
function deliveryFeeFor(neighborhood) {
  const zone = (db.config.deliveryZones || []).find((z) => z.name.toLowerCase() === String(neighborhood || "").toLowerCase());
  return zone ? zone.fee : null;
}

// ---------- CSV ----------
function csvEscape(v) {
  v = v === undefined || v === null ? "" : String(v);
  if (/[",\n;]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function menuToCsv() {
  const header = ["categoria", "nome", "descricao", "preco", "ativo", "estoque_ativo", "estoque_qtd", "grupos_complementos"];
  const rows = [header.join(",")];
  sortedMenu(db.menu).forEach((it) => {
    const groupNames = itemAddonGroups(it).map((g) => g.name).join(";");
    rows.push([
      csvEscape(it.category), csvEscape(it.name), csvEscape(it.description || ""), it.price,
      it.active === false ? "nao" : "sim",
      it.stock && it.stock.enabled ? "sim" : "nao",
      it.stock ? it.stock.quantity : 0,
      csvEscape(groupNames)
    ].join(","));
  });
  return rows.join("\n");
}
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && next === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] && r[0].trim() !== ""));
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: "12mb" }));

function signToken(user) { return jwt.sign({ sub: user.id, role: user.role, username: user.username, name: user.name }, JWT_SECRET, { expiresIn: "12h" }); }
function verifyToken(token) { return jwt.verify(token, JWT_SECRET); }
function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "não autenticado" });
  try { req.user = verifyToken(token); next(); } catch (e) { return res.status(401).json({ error: "sessão inválida ou expirada" }); }
}
function requireAdmin(req, res, next) { if (req.user.role !== "admin") return res.status(403).json({ error: "somente admin" }); next(); }

// ---------- auth ----------
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) return res.status(401).json({ error: "usuário ou senha inválidos" });
  res.json({ token: signToken(user), user: publicUser(user) });
});
app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = db.users.find((u) => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: "usuário não existe mais" });
  res.json({ user: publicUser(user) });
});

// ---------- eventos em tempo real ----------
app.get("/api/events", (req, res) => {
  try { verifyToken(req.query.token || ""); } catch (e) { return res.status(401).end(); }
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders && res.flushHeaders();
  res.write(": conectado\n\n");
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 25000);
  req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
});

// ---------- público (sem login) ----------
app.get("/api/public/menu", (req, res) => res.json({ menu: publicMenuList() }));
app.get("/api/public/config", (req, res) => res.json({ config: publicConfig() }));

app.post("/api/public/orders", (req, res) => {
  const status = openStatus();
  if (!status.open) return res.status(403).json({ error: "restaurante fechado no momento", reason: status.reason });

  const body = req.body || {};
  const { customerName, customerPhone, type, payment, lines, delivery } = body;
  if (!customerName || !customerPhone) return res.status(400).json({ error: "nome e whatsapp são obrigatórios" });
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: "pedido vazio" });
  if (!["local", "delivery", "retirada"].includes(type)) return res.status(400).json({ error: "tipo inválido" });
  const method = payment && payment.method;
  const allowedMethods = ["dinheiro", "cartao", "pix_entrega"].concat(publicConfig().onlinePaymentEnabled ? ["pix_online"] : []);
  if (!allowedMethods.includes(method)) return res.status(400).json({ error: "forma de pagamento inválida" });

  let deliveryInfo = null;
  if (type === "delivery") {
    if (!delivery || !delivery.street || !delivery.number || !delivery.neighborhood) return res.status(400).json({ error: "endereço de entrega incompleto" });
    const fee = deliveryFeeFor(delivery.neighborhood);
    if (fee === null) return res.status(400).json({ error: "bairro não atendido para entrega" });
    deliveryInfo = { street: String(delivery.street).slice(0, 160), number: String(delivery.number).slice(0, 20), neighborhood: delivery.neighborhood, fee };
  }

  let resolvedLines;
  try { resolvedLines = resolveOrderLines(lines); } catch (e) { return res.status(e.code || 400).json({ error: e.msg || "erro no pedido" }); }
  const itemsTotal = resolvedLines.reduce((s, l) => s + l.price * l.qty, 0);
  const total = itemsTotal + (deliveryInfo ? deliveryInfo.fee : 0);

  const order = {
    id: uid(), number: nextDailyNumber(), source: "publico", lines: resolvedLines, type,
    customerName: String(customerName).slice(0, 120), customerPhone: String(customerPhone).slice(0, 40),
    delivery: deliveryInfo, total,
    payment: { method, status: method === "pix_online" ? "aguardando" : "nao_aplica" },
    status: "solicitacao", createdAt: new Date().toISOString(), acceptedAt: null, finalizedAt: null, stockReturned: false
  };
  applyStockDelta(resolvedLines, -1);
  db.orders.push(order);
  persist();
  broadcast("orders_changed", { reason: "novo_pedido" });
  res.status(201).json({ order });
});

// ---------- cardápio (autenticado) ----------
app.get("/api/menu", requireAuth, (req, res) => res.json({ menu: staffMenuList() }));
app.post("/api/menu", requireAuth, (req, res) => {
  const { name, category, price, image, description, addonGroupIds, stock, active } = req.body || {};
  const p = parseFloat(price);
  if (!name || isNaN(p) || p < 0) return res.status(400).json({ error: "nome e preço válidos são obrigatórios" });
  const cat = (category || "Outros").slice(0, 60);
  const siblingsCount = db.menu.filter((m) => m.category === cat).length;
  const item = {
    id: uid(), name: String(name).slice(0, 120), category: cat, price: p, order: siblingsCount,
    description: typeof description === "string" ? description.slice(0, 500) : "",
    image: typeof image === "string" ? image.slice(0, 3000000) : "",
    active: active === undefined ? true : !!active,
    addonGroupIds: Array.isArray(addonGroupIds) ? addonGroupIds.filter((id) => (db.config.addonGroups || []).some((g) => g.id === id)) : [],
    stock: stock && stock.enabled ? { enabled: true, quantity: Math.max(0, parseInt(stock.quantity, 10) || 0) } : { enabled: false, quantity: 0 }
  };
  db.menu.push(item);
  if (!db.config.categoryOrder.includes(cat)) db.config.categoryOrder.push(cat);
  persist();
  broadcast("menu_changed", {});
  res.status(201).json({ item: decorateItem(item) });
});
app.put("/api/menu/:id", requireAuth, (req, res) => {
  const item = db.menu.find((m) => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: "item não encontrado" });
  const { name, category, price, image, description, addonGroupIds, stock, active } = req.body || {};
  if (name !== undefined) item.name = String(name).slice(0, 120);
  if (category !== undefined) {
    const cat = String(category).slice(0, 60);
    item.category = cat;
    if (!db.config.categoryOrder.includes(cat)) db.config.categoryOrder.push(cat);
  }
  if (price !== undefined) {
    const p = parseFloat(price);
    if (isNaN(p) || p < 0) return res.status(400).json({ error: "preço inválido" });
    item.price = p;
  }
  if (description !== undefined) item.description = String(description).slice(0, 500);
  if (image !== undefined) item.image = typeof image === "string" ? image.slice(0, 3000000) : "";
  if (active !== undefined) item.active = !!active;
  if (addonGroupIds !== undefined) item.addonGroupIds = Array.isArray(addonGroupIds) ? addonGroupIds.filter((id) => (db.config.addonGroups || []).some((g) => g.id === id)) : [];
  if (stock !== undefined) item.stock = stock && stock.enabled ? { enabled: true, quantity: Math.max(0, parseInt(stock.quantity, 10) || 0) } : { enabled: false, quantity: 0 };
  persist();
  broadcast("menu_changed", {});
  res.json({ item: decorateItem(item) });
});
app.delete("/api/menu/:id", requireAuth, (req, res) => {
  const before = db.menu.length;
  db.menu = db.menu.filter((m) => m.id !== req.params.id);
  if (db.menu.length === before) return res.status(404).json({ error: "item não encontrado" });
  persist();
  broadcast("menu_changed", {});
  res.json({ ok: true });
});
app.put("/api/menu/reorder", requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: "lista de ids inválida" });
  ids.forEach((id, idx) => { const item = db.menu.find((m) => m.id === id); if (item) item.order = idx; });
  persist();
  broadcast("menu_changed", {});
  res.json({ ok: true });
});

// ---------- exportar / importar cardápio (CSV) ----------
app.get("/api/menu/export", requireAuth, (req, res) => {
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="cardapio-brothers.csv"' });
  res.send("\uFEFF" + menuToCsv());
});
app.post("/api/menu/import", requireAuth, (req, res) => {
  const { csv } = req.body || {};
  if (typeof csv !== "string" || !csv.trim()) return res.status(400).json({ error: "arquivo CSV vazio" });
  const rows = parseCsv(csv.trim());
  if (!rows.length) return res.status(400).json({ error: "CSV sem linhas" });
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  let created = 0, updated = 0;
  const unknownGroups = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const category = (r[idx("categoria")] || "Outros").trim() || "Outros";
    const name = (r[idx("nome")] || "").trim();
    if (!name) continue;
    const description = (r[idx("descricao")] || "").trim();
    const price = parseFloat(r[idx("preco")]) || 0;
    const active = (r[idx("ativo")] || "sim").trim().toLowerCase() !== "nao";
    const stockEnabled = (r[idx("estoque_ativo")] || "nao").trim().toLowerCase() === "sim";
    const stockQty = parseInt(r[idx("estoque_qtd")], 10) || 0;
    const groupNames = (r[idx("grupos_complementos")] || "").split(";").map((s) => s.trim()).filter(Boolean);
    const groupIds = [];
    groupNames.forEach((gn) => {
      const g = (db.config.addonGroups || []).find((gg) => gg.name.toLowerCase() === gn.toLowerCase());
      if (g) groupIds.push(g.id); else unknownGroups.add(gn);
    });
    let item = db.menu.find((m) => m.name.toLowerCase() === name.toLowerCase() && m.category.toLowerCase() === category.toLowerCase());
    if (item) {
      item.description = description; item.price = price; item.active = active;
      item.stock = { enabled: stockEnabled, quantity: stockQty }; item.addonGroupIds = groupIds;
      updated++;
    } else {
      const siblingsCount = db.menu.filter((m) => m.category === category).length;
      db.menu.push({ id: uid(), name, category, description, price, order: siblingsCount, image: "", active, addonGroupIds: groupIds, stock: { enabled: stockEnabled, quantity: stockQty } });
      created++;
    }
    if (!db.config.categoryOrder.includes(category)) db.config.categoryOrder.push(category);
  }
  persist();
  broadcast("menu_changed", {});
  res.json({ ok: true, created, updated, unknownGroups: Array.from(unknownGroups) });
});

// ---------- pedidos (autenticado) ----------
app.get("/api/orders", requireAuth, (req, res) => {
  let list = db.orders;
  if (req.query.status) list = list.filter((o) => o.status === req.query.status);
  res.json({ orders: list });
});
app.post("/api/orders", requireAuth, (req, res) => {
  const { customerName, customerPhone, type, lines, delivery } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: "pedido vazio" });
  if (!["local", "delivery", "retirada"].includes(type)) return res.status(400).json({ error: "tipo inválido" });
  let resolvedLines;
  try { resolvedLines = resolveOrderLines(lines); } catch (e) { return res.status(e.code || 400).json({ error: e.msg || "erro no pedido" }); }
  let deliveryInfo = null;
  if (type === "delivery" && delivery && delivery.street) {
    const fee = delivery.neighborhood ? (deliveryFeeFor(delivery.neighborhood) || 0) : 0;
    deliveryInfo = { street: delivery.street, number: delivery.number || "", neighborhood: delivery.neighborhood || "", fee };
  }
  const itemsTotal = resolvedLines.reduce((s, l) => s + l.price * l.qty, 0);
  const total = itemsTotal + (deliveryInfo ? deliveryInfo.fee : 0);
  const order = {
    id: uid(), number: nextDailyNumber(), source: "balcao", lines: resolvedLines, type,
    customerName: (customerName || "").slice(0, 120), customerPhone: (customerPhone || "").slice(0, 40), delivery: deliveryInfo, total,
    payment: { method: "balcao", status: "nao_aplica" }, status: "producao",
    createdAt: new Date().toISOString(), acceptedAt: null, finalizedAt: null, stockReturned: false
  };
  applyStockDelta(resolvedLines, -1);
  db.orders.push(order);
  persist();
  broadcast("orders_changed", { reason: "novo_pedido_balcao" });
  res.status(201).json({ order });
});
app.put("/api/orders/:id", requireAuth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "pedido não encontrado" });
  const { customerName, customerPhone, type, lines } = req.body || {};
  if (Array.isArray(lines)) {
    applyStockDelta(order.lines, +1);
    let resolvedLines;
    try { resolvedLines = resolveOrderLines(lines); } catch (e) { applyStockDelta(order.lines, -1); return res.status(e.code || 400).json({ error: e.msg || "erro no pedido" }); }
    order.lines = resolvedLines;
    applyStockDelta(resolvedLines, -1);
    order.total = resolvedLines.reduce((s, l) => s + l.price * l.qty, 0) + (order.delivery ? order.delivery.fee : 0);
  }
  if (type) order.type = type;
  if (customerName !== undefined) order.customerName = customerName;
  if (customerPhone !== undefined) order.customerPhone = customerPhone;
  persist();
  broadcast("orders_changed", { reason: "pedido_editado" });
  res.json({ order });
});
app.patch("/api/orders/:id/status", requireAuth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "pedido não encontrado" });
  const { status } = req.body || {};
  const allowed = ["solicitacao", "producao", "pronto", "finalizado", "recusado"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "status inválido" });
  if ((status === "recusado" || status === "cancelado") && !order.stockReturned) { applyStockDelta(order.lines, +1); order.stockReturned = true; }
  order.status = status;
  if (status === "producao" && !order.acceptedAt) order.acceptedAt = new Date().toISOString();
  if (status === "finalizado") order.finalizedAt = new Date().toISOString();
  persist();
  broadcast("orders_changed", { reason: "status_alterado" });
  res.json({ order });
});
app.patch("/api/orders/:id/payment", requireAuth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "pedido não encontrado" });
  const { status } = req.body || {};
  if (!["aguardando", "confirmado", "nao_aplica"].includes(status)) return res.status(400).json({ error: "status de pagamento inválido" });
  order.payment.status = status;
  persist();
  broadcast("orders_changed", { reason: "pagamento_confirmado" });
  res.json({ order });
});
app.delete("/api/orders/:id", requireAuth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "pedido não encontrado" });
  if (!order.stockReturned && ["solicitacao", "producao", "pronto"].includes(order.status)) applyStockDelta(order.lines, +1);
  db.orders = db.orders.filter((o) => o.id !== req.params.id);
  persist();
  broadcast("orders_changed", { reason: "pedido_cancelado" });
  res.json({ ok: true });
});
app.get("/api/orders/history", requireAuth, (req, res) => {
  let from = req.query.from, to = req.query.to;
  if (req.user.role === "garcom") {
    const min = new Date(); min.setDate(min.getDate() - 3);
    const minStr = todayStr(min);
    if (!from || from < minStr) from = minStr;
  }
  let list = db.orders.filter((o) => o.status === "finalizado");
  if (from) list = list.filter((o) => todayStr(new Date(o.finalizedAt)) >= from);
  if (to) list = list.filter((o) => todayStr(new Date(o.finalizedAt)) <= to);
  list.sort((a, b) => new Date(b.finalizedAt) - new Date(a.finalizedAt));
  res.json({ orders: list });
});
app.get("/api/reports", requireAuth, requireAdmin, (req, res) => {
  const { from, to } = req.query;
  let list = db.orders.filter((o) => o.status === "finalizado");
  if (from) list = list.filter((o) => todayStr(new Date(o.finalizedAt)) >= from);
  if (to) list = list.filter((o) => todayStr(new Date(o.finalizedAt)) <= to);
  const revenue = list.reduce((s, o) => s + o.total, 0);
  const count = list.length;
  const avg = count ? revenue / count : 0;
  const byType = { local: 0, delivery: 0, retirada: 0 };
  list.forEach((o) => { byType[o.type] = (byType[o.type] || 0) + o.total; });
  const itemTotals = {};
  list.forEach((o) => o.lines.forEach((l) => {
    if (!itemTotals[l.name]) itemTotals[l.name] = { qty: 0, revenue: 0 };
    itemTotals[l.name].qty += l.qty;
    itemTotals[l.name].revenue += l.price * l.qty;
  }));
  const topItems = Object.keys(itemTotals).map((k) => ({ name: k, ...itemTotals[k] })).sort((a, b) => b.qty - a.qty).slice(0, 8);
  res.json({ revenue, count, avg, byType, topItems });
});

// ---------- configurações (autenticado / admin) ----------
app.get("/api/config", requireAuth, (req, res) => res.json({ config: db.config }));
app.put("/api/config", requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  if (b.whatsapp !== undefined) db.config.whatsapp = String(b.whatsapp).replace(/\D/g, "");
  if (b.pixKey !== undefined) db.config.pixKey = String(b.pixKey);
  if (b.pixName !== undefined) db.config.pixName = String(b.pixName);
  if (b.onlinePaymentEnabled !== undefined) db.config.onlinePaymentEnabled = !!b.onlinePaymentEnabled;
  if (b.accentColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(b.accentColor)) db.config.accentColor = b.accentColor;
  if (b.logoImage !== undefined) db.config.logoImage = typeof b.logoImage === "string" ? b.logoImage.slice(0, 3000000) : "";
  if (b.coverImage !== undefined) db.config.coverImage = typeof b.coverImage === "string" ? b.coverImage.slice(0, 3000000) : "";
  if (Array.isArray(b.categoryOrder)) db.config.categoryOrder = b.categoryOrder.map((c) => String(c).slice(0, 60));
  if (Array.isArray(b.disabledCategories)) db.config.disabledCategories = b.disabledCategories.map((c) => String(c).slice(0, 60));
  if (Array.isArray(b.deliveryZones)) db.config.deliveryZones = b.deliveryZones.map((z) => ({ id: z.id || uid(), name: String(z.name || "").slice(0, 80), fee: Math.max(0, parseFloat(z.fee) || 0) }));
  if (Array.isArray(b.addonGroups)) db.config.addonGroups = b.addonGroups.map((g) => ({
    id: g.id || uid(), name: String(g.name || "").slice(0, 80), type: g.type === "single" ? "single" : "multi",
    options: Array.isArray(g.options) ? g.options.map((o) => ({ id: o.id || uid(), name: String(o.name || "").slice(0, 80), price: parseFloat(o.price) || 0 })) : []
  }));
  if (b.notificationSound !== undefined) db.config.notificationSound = typeof b.notificationSound === "string" ? b.notificationSound.slice(0, 4000000) : "";
  if (b.timezone !== undefined) db.config.timezone = String(b.timezone).slice(0, 60);
  if (b.businessHours !== undefined && typeof b.businessHours === "object") {
    const bh = defaultBusinessHours();
    WEEKDAYS.forEach((d) => { if (b.businessHours[d]) bh[d] = { closed: !!b.businessHours[d].closed, open: b.businessHours[d].open || "00:00", close: b.businessHours[d].close || "23:59" }; });
    db.config.businessHours = bh;
  }
  if (b.emergencyClosed !== undefined) db.config.emergencyClosed = !!b.emergencyClosed;
  if (b.staffSlug !== undefined && String(b.staffSlug).trim()) db.config.staffSlug = String(b.staffSlug).trim().replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 60);
  persist();
  broadcast("config_changed", {});
  res.json({ config: db.config });
});

// ---------- usuários (admin) ----------
app.get("/api/users", requireAuth, requireAdmin, (req, res) => res.json({ users: db.users.map(publicUser) }));
app.post("/api/users", requireAuth, requireAdmin, (req, res) => {
  const { username, password, role, name } = req.body || {};
  if (!username || !password || !["admin", "garcom"].includes(role)) return res.status(400).json({ error: "dados inválidos" });
  if (db.users.some((u) => u.username === username)) return res.status(409).json({ error: "usuário já existe" });
  const user = { id: uid(), username, passwordHash: bcrypt.hashSync(password, 10), role, name: name || username };
  db.users.push(user);
  persist();
  res.status(201).json({ user: publicUser(user) });
});
app.delete("/api/users/:id", requireAuth, requireAdmin, (req, res) => {
  if (req.params.id === req.user.sub) return res.status(400).json({ error: "não é possível excluir o próprio usuário" });
  const before = db.users.length;
  db.users = db.users.filter((u) => u.id !== req.params.id);
  if (db.users.length === before) return res.status(404).json({ error: "usuário não encontrado" });
  persist();
  res.json({ ok: true });
});

// ---------- frontend estático ----------
app.use(express.static(path.join(__dirname, "..", "public")));
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log("Brothers backend rodando na porta " + PORT);
});
