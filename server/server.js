// Brothers - backend (Express + arquivo JSON persistido em disco)
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

// ---------- persistência ----------
function defaultData() {
  return {
    menu: [
      { id: "m1", name: "X-Burger", price: 22.0, category: "Lanches", order: 0, image: "", addons: [], stock: { enabled: false, quantity: 0 } },
      { id: "m2", name: "X-Salada", price: 24.0, category: "Lanches", order: 1, image: "", addons: [], stock: { enabled: false, quantity: 0 } },
      { id: "m3", name: "Batata frita", price: 15.0, category: "Porções", order: 0, image: "", addons: [], stock: { enabled: false, quantity: 0 } },
      { id: "m4", name: "Refrigerante lata", price: 6.0, category: "Bebidas", order: 0, image: "", addons: [], stock: { enabled: false, quantity: 0 } },
      { id: "m5", name: "Suco natural", price: 8.0, category: "Bebidas", order: 1, image: "", addons: [], stock: { enabled: false, quantity: 0 } }
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
      categoryOrder: [], deliveryZones: []
    }
  };
}

// migra bancos antigos que não tinham os campos novos
function migrate(data) {
  data.config = Object.assign({
    whatsapp: "", pixKey: "", pixName: "", onlinePaymentEnabled: false,
    accentColor: "#B9862F", logoImage: "", coverImage: "",
    categoryOrder: [], deliveryZones: []
  }, data.config || {});
  data.menu = (data.menu || []).map((m, idx) => Object.assign({
    order: idx, image: "", addons: [], stock: { enabled: false, quantity: 0 }
  }, m));
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
function publicConfig() {
  return {
    whatsapp: db.config.whatsapp || "",
    pixKey: db.config.pixKey || "",
    pixName: db.config.pixName || "",
    onlinePaymentEnabled: !!db.config.onlinePaymentEnabled,
    accentColor: db.config.accentColor || "#B9862F",
    logoImage: db.config.logoImage || "",
    coverImage: db.config.coverImage || "",
    deliveryZones: db.config.deliveryZones || []
  };
}
function publicUser(u) { return { id: u.id, username: u.username, role: u.role, name: u.name }; }
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
function resolveOrderLines(lines) {
  const resolvedLines = [];
  for (const l of lines) {
    const item = db.menu.find((m) => m.id === l.menuId);
    if (!item) throw { code: 400, msg: "item de cardápio inválido" };
    const qty = Math.max(1, parseInt(l.qty, 10) || 1);
    if (item.stock && item.stock.enabled && item.stock.quantity < qty) {
      throw { code: 400, msg: "sem estoque suficiente de: " + item.name };
    }
    let addonsTotal = 0;
    const chosenAddons = [];
    if (Array.isArray(l.addonIds) && l.addonIds.length) {
      for (const aid of l.addonIds) {
        const addon = (item.addons || []).find((a) => a.id === aid);
        if (addon) { chosenAddons.push({ id: addon.id, name: addon.name, price: addon.price }); addonsTotal += addon.price; }
      }
    }
    resolvedLines.push({ menuId: item.id, name: item.name, price: item.price + addonsTotal, basePrice: item.price, addons: chosenAddons, qty });
  }
  return resolvedLines;
}
function applyStockDelta(lines, sign) {
  for (const l of lines) {
    const item = db.menu.find((m) => m.id === l.menuId);
    if (item && item.stock && item.stock.enabled) {
      item.stock.quantity = Math.max(0, item.stock.quantity + sign * l.qty);
    }
  }
}
function deliveryFeeFor(neighborhood) {
  const zone = (db.config.deliveryZones || []).find((z) => z.name.toLowerCase() === String(neighborhood || "").toLowerCase());
  return zone ? zone.fee : null;
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: "12mb" }));

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, username: user.username, name: user.name }, JWT_SECRET, { expiresIn: "12h" });
}
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "não autenticado" });
  try { req.user = verifyToken(token); next(); }
  catch (e) { return res.status(401).json({ error: "sessão inválida ou expirada" }); }
}
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "somente admin" });
  next();
}

// ---------- auth ----------
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "usuário ou senha inválidos" });
  }
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
app.get("/api/public/menu", (req, res) => res.json({ menu: sortedMenu(db.menu) }));
app.get("/api/public/config", (req, res) => res.json({ config: publicConfig() }));

app.post("/api/public/orders", (req, res) => {
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
    if (!delivery || !delivery.street || !delivery.number || !delivery.neighborhood) {
      return res.status(400).json({ error: "endereço de entrega incompleto" });
    }
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
app.get("/api/menu", requireAuth, (req, res) => res.json({ menu: sortedMenu(db.menu) }));
app.post("/api/menu", requireAuth, (req, res) => {
  const { name, category, price, image, addons, stock } = req.body || {};
  const p = parseFloat(price);
  if (!name || isNaN(p) || p < 0) return res.status(400).json({ error: "nome e preço válidos são obrigatórios" });
  const cat = (category || "Outros").slice(0, 60);
  const siblingsCount = db.menu.filter((m) => m.category === cat).length;
  const item = {
    id: uid(), name: String(name).slice(0, 120), category: cat, price: p, order: siblingsCount,
    image: typeof image === "string" ? image.slice(0, 3000000) : "",
    addons: Array.isArray(addons) ? addons.map((a) => ({ id: a.id || uid(), name: String(a.name || "").slice(0, 80), price: parseFloat(a.price) || 0 })) : [],
    stock: stock && stock.enabled ? { enabled: true, quantity: Math.max(0, parseInt(stock.quantity, 10) || 0) } : { enabled: false, quantity: 0 }
  };
  db.menu.push(item);
  if (!db.config.categoryOrder.includes(cat)) db.config.categoryOrder.push(cat);
  persist();
  broadcast("menu_changed", {});
  res.status(201).json({ item });
});
app.put("/api/menu/:id", requireAuth, (req, res) => {
  const item = db.menu.find((m) => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: "item não encontrado" });
  const { name, category, price, image, addons, stock } = req.body || {};
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
  if (image !== undefined) item.image = typeof image === "string" ? image.slice(0, 3000000) : "";
  if (addons !== undefined) item.addons = Array.isArray(addons) ? addons.map((a) => ({ id: a.id || uid(), name: String(a.name || "").slice(0, 80), price: parseFloat(a.price) || 0 })) : [];
  if (stock !== undefined) item.stock = stock && stock.enabled ? { enabled: true, quantity: Math.max(0, parseInt(stock.quantity, 10) || 0) } : { enabled: false, quantity: 0 };
  persist();
  broadcast("menu_changed", {});
  res.json({ item });
});
app.delete("/api/menu/:id", requireAuth, (req, res) => {
  const before = db.menu.length;
  db.menu = db.menu.filter((m) => m.id !== req.params.id);
  if (db.menu.length === before) return res.status(404).json({ error: "item não encontrado" });
  persist();
  broadcast("menu_changed", {});
  res.json({ ok: true });
});
// reordenar itens dentro de uma categoria: envia a lista de ids na nova ordem
app.put("/api/menu/reorder", requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: "lista de ids inválida" });
  ids.forEach((id, idx) => {
    const item = db.menu.find((m) => m.id === id);
    if (item) item.order = idx;
  });
  persist();
  broadcast("menu_changed", {});
  res.json({ ok: true });
});

// ---------- pedidos (autenticado) ----------
app.get("/api/orders", requireAuth, (req, res) => {
  let list = db.orders;
  if (req.query.status) list = list.filter((o) => o.status === req.query.status);
  res.json({ orders: list });
});
app.post("/api/orders", requireAuth, (req, res) => {
  // pedido criado no balcão pela equipe -> vai direto pra produção
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
    applyStockDelta(order.lines, +1); // devolve estoque das linhas antigas
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
  if ((status === "recusado" || status === "cancelado") && !order.stockReturned) {
    applyStockDelta(order.lines, +1);
    order.stockReturned = true;
  }
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
  const { whatsapp, pixKey, pixName, onlinePaymentEnabled, accentColor, logoImage, coverImage, categoryOrder, deliveryZones } = req.body || {};
  if (whatsapp !== undefined) db.config.whatsapp = String(whatsapp).replace(/\D/g, "");
  if (pixKey !== undefined) db.config.pixKey = String(pixKey);
  if (pixName !== undefined) db.config.pixName = String(pixName);
  if (onlinePaymentEnabled !== undefined) db.config.onlinePaymentEnabled = !!onlinePaymentEnabled;
  if (accentColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(accentColor)) db.config.accentColor = accentColor;
  if (logoImage !== undefined) db.config.logoImage = typeof logoImage === "string" ? logoImage.slice(0, 3000000) : "";
  if (coverImage !== undefined) db.config.coverImage = typeof coverImage === "string" ? coverImage.slice(0, 3000000) : "";
  if (Array.isArray(categoryOrder)) db.config.categoryOrder = categoryOrder.map((c) => String(c).slice(0, 60));
  if (Array.isArray(deliveryZones)) db.config.deliveryZones = deliveryZones.map((z) => ({ id: z.id || uid(), name: String(z.name || "").slice(0, 80), fee: Math.max(0, parseFloat(z.fee) || 0) }));
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
