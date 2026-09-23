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
      { id: "m1", name: "X-Burger", price: 22.0, category: "Lanches" },
      { id: "m2", name: "X-Salada", price: 24.0, category: "Lanches" },
      { id: "m3", name: "Batata frita", price: 15.0, category: "Porções" },
      { id: "m4", name: "Refrigerante lata", price: 6.0, category: "Bebidas" },
      { id: "m5", name: "Suco natural", price: 8.0, category: "Bebidas" }
    ],
    orders: [],
    dayCounter: { date: "", count: 0 },
    users: [
      { id: "u1", username: "admin", passwordHash: bcrypt.hashSync("admin", 10), role: "admin", name: "Administrador" },
      { id: "u2", username: "garcom", passwordHash: bcrypt.hashSync("garcom", 10), role: "garcom", name: "Garçom" }
    ],
    config: { whatsapp: "", pixKey: "", pixName: "", onlinePaymentEnabled: false }
  };
}

let db;
function loadData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    db = defaultData();
    persist();
  } else {
    try {
      db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
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
    onlinePaymentEnabled: !!db.config.onlinePaymentEnabled
  };
}
function publicUser(u) { return { id: u.id, username: u.username, role: u.role, name: u.name }; }

// ---------- app ----------
const app = express();
app.use(express.json());

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, username: user.username, name: user.name }, JWT_SECRET, { expiresIn: "12h" });
}
function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "não autenticado" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "sessão inválida ou expirada" });
  }
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

// ---------- público (sem login) ----------
app.get("/api/public/menu", (req, res) => res.json({ menu: db.menu }));
app.get("/api/public/config", (req, res) => res.json({ config: publicConfig() }));

app.post("/api/public/orders", (req, res) => {
  const body = req.body || {};
  const { customerName, customerPhone, type, payment, lines } = body;
  if (!customerName || !customerPhone) return res.status(400).json({ error: "nome e whatsapp são obrigatórios" });
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: "pedido vazio" });
  if (!["local", "delivery", "retirada"].includes(type)) return res.status(400).json({ error: "tipo inválido" });
  const method = payment && payment.method;
  const allowedMethods = ["dinheiro", "cartao", "pix_entrega"].concat(publicConfig().onlinePaymentEnabled ? ["pix_online"] : []);
  if (!allowedMethods.includes(method)) return res.status(400).json({ error: "forma de pagamento inválida" });

  const resolvedLines = [];
  for (const l of lines) {
    const item = db.menu.find((m) => m.id === l.menuId);
    if (!item) return res.status(400).json({ error: "item de cardápio inválido: " + l.menuId });
    const qty = Math.max(1, parseInt(l.qty, 10) || 1);
    resolvedLines.push({ menuId: item.id, name: item.name, price: item.price, qty });
  }
  const total = resolvedLines.reduce((s, l) => s + l.price * l.qty, 0);

  const order = {
    id: uid(),
    number: nextDailyNumber(),
    source: "publico",
    lines: resolvedLines,
    type,
    customerName: String(customerName).slice(0, 120),
    customerPhone: String(customerPhone).slice(0, 40),
    total,
    payment: { method, status: method === "pix_online" ? "aguardando" : "nao_aplica" },
    status: "solicitacao",
    createdAt: new Date().toISOString(),
    acceptedAt: null,
    finalizedAt: null
  };
  db.orders.push(order);
  persist();
  res.status(201).json({ order });
});

// ---------- cardápio (autenticado) ----------
app.get("/api/menu", requireAuth, (req, res) => res.json({ menu: db.menu }));
app.post("/api/menu", requireAuth, (req, res) => {
  const { name, category, price } = req.body || {};
  const p = parseFloat(price);
  if (!name || isNaN(p) || p < 0) return res.status(400).json({ error: "nome e preço válidos são obrigatórios" });
  const item = { id: uid(), name: String(name).slice(0, 120), category: (category || "Outros").slice(0, 60), price: p };
  db.menu.push(item);
  persist();
  res.status(201).json({ item });
});
app.put("/api/menu/:id", requireAuth, (req, res) => {
  const item = db.menu.find((m) => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: "item não encontrado" });
  const { name, category, price } = req.body || {};
  if (name !== undefined) item.name = String(name).slice(0, 120);
  if (category !== undefined) item.category = String(category).slice(0, 60);
  if (price !== undefined) {
    const p = parseFloat(price);
    if (isNaN(p) || p < 0) return res.status(400).json({ error: "preço inválido" });
    item.price = p;
  }
  persist();
  res.json({ item });
});
app.delete("/api/menu/:id", requireAuth, (req, res) => {
  const before = db.menu.length;
  db.menu = db.menu.filter((m) => m.id !== req.params.id);
  if (db.menu.length === before) return res.status(404).json({ error: "item não encontrado" });
  persist();
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
  const { customerName, customerPhone, type, lines } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: "pedido vazio" });
  if (!["local", "delivery", "retirada"].includes(type)) return res.status(400).json({ error: "tipo inválido" });
  const resolvedLines = [];
  for (const l of lines) {
    const item = db.menu.find((m) => m.id === l.menuId);
    if (!item) return res.status(400).json({ error: "item de cardápio inválido" });
    const qty = Math.max(1, parseInt(l.qty, 10) || 1);
    resolvedLines.push({ menuId: item.id, name: item.name, price: item.price, qty });
  }
  const total = resolvedLines.reduce((s, l) => s + l.price * l.qty, 0);
  const order = {
    id: uid(), number: nextDailyNumber(), source: "balcao", lines: resolvedLines, type,
    customerName: (customerName || "").slice(0, 120), customerPhone: (customerPhone || "").slice(0, 40), total,
    payment: { method: "balcao", status: "nao_aplica" }, status: "producao",
    createdAt: new Date().toISOString(), acceptedAt: null, finalizedAt: null
  };
  db.orders.push(order);
  persist();
  res.status(201).json({ order });
});
app.put("/api/orders/:id", requireAuth, (req, res) => {
  // editar itens/tipo/cliente de um pedido existente (uso: editar pedido no balcão)
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "pedido não encontrado" });
  const { customerName, customerPhone, type, lines } = req.body || {};
  if (Array.isArray(lines)) {
    const resolvedLines = [];
    for (const l of lines) {
      const item = db.menu.find((m) => m.id === l.menuId);
      if (!item) return res.status(400).json({ error: "item de cardápio inválido" });
      const qty = Math.max(1, parseInt(l.qty, 10) || 1);
      resolvedLines.push({ menuId: item.id, name: item.name, price: item.price, qty });
    }
    order.lines = resolvedLines;
    order.total = resolvedLines.reduce((s, l) => s + l.price * l.qty, 0);
  }
  if (type) order.type = type;
  if (customerName !== undefined) order.customerName = customerName;
  if (customerPhone !== undefined) order.customerPhone = customerPhone;
  persist();
  res.json({ order });
});
app.patch("/api/orders/:id/status", requireAuth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "pedido não encontrado" });
  const { status } = req.body || {};
  const allowed = ["solicitacao", "producao", "pronto", "finalizado", "recusado"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "status inválido" });
  order.status = status;
  if (status === "producao" && !order.acceptedAt) order.acceptedAt = new Date().toISOString();
  if (status === "finalizado") order.finalizedAt = new Date().toISOString();
  persist();
  res.json({ order });
});
app.patch("/api/orders/:id/payment", requireAuth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "pedido não encontrado" });
  const { status } = req.body || {};
  if (!["aguardando", "confirmado", "nao_aplica"].includes(status)) return res.status(400).json({ error: "status de pagamento inválido" });
  order.payment.status = status;
  persist();
  res.json({ order });
});
app.delete("/api/orders/:id", requireAuth, (req, res) => {
  const before = db.orders.length;
  db.orders = db.orders.filter((o) => o.id !== req.params.id);
  if (db.orders.length === before) return res.status(404).json({ error: "pedido não encontrado" });
  persist();
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
  const { whatsapp, pixKey, pixName, onlinePaymentEnabled } = req.body || {};
  if (whatsapp !== undefined) db.config.whatsapp = String(whatsapp).replace(/\D/g, "");
  if (pixKey !== undefined) db.config.pixKey = String(pixKey);
  if (pixName !== undefined) db.config.pixName = String(pixName);
  if (onlinePaymentEnabled !== undefined) db.config.onlinePaymentEnabled = !!onlinePaymentEnabled;
  persist();
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
