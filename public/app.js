(function () {
  "use strict";
  var API = ""; // mesmo domínio (web e Electron apontam para o backend hospedado)
  var token = null;
  var me = null;
  try { token = localStorage.getItem("brothers_token"); } catch (e) {}

  var publicMenuCache = [];
  var publicConfigCache = { whatsapp: "", pixKey: "", pixName: "", onlinePaymentEnabled: false };
  var staffMenuCache = [];
  var pollTimer = null;

  function fmtMoney(v) { return "R$ " + (Math.round(v * 100) / 100).toFixed(2).replace(".", ","); }
  function fmtDateTime(iso) { var d = new Date(iso); return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  function typeLabel(t) { return t === "local" ? "Consumo no local" : t === "delivery" ? "Delivery" : "Retirada"; }
  function payLabel(p) { return { dinheiro: "Dinheiro", cartao: "Cartão", pix_entrega: "Pix na entrega", pix_online: "Pix (online)", balcao: "Balcão" }[p] || p; }
  function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function showToast(msg) { var t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); setTimeout(function () { t.classList.remove("show"); }, 2600); }

  async function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (token) headers.Authorization = "Bearer " + token;
    var res = await fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      if (res.status === 401 && path !== "/api/auth/login") { logout(); }
      throw new Error((data && data.error) || ("erro " + res.status));
    }
    return data;
  }

  // ===================== TELAS =====================
  function showScreen(name) {
    document.getElementById("public-screen").style.display = name === "public" ? "block" : "none";
    document.getElementById("login-screen").style.display = name === "login" ? "block" : "none";
    document.getElementById("staff-screen").style.display = name === "staff" ? "block" : "none";
  }

  async function boot() {
    await loadPublicMenuAndConfig();
    resetPublicOrder();
    if (token) {
      try {
        var r = await api("/api/auth/me");
        me = r.user;
        enterStaff();
        return;
      } catch (e) { token = null; try { localStorage.removeItem("brothers_token"); } catch (e2) {} }
    }
    showScreen("public");
  }

  document.getElementById("link-staff-login").addEventListener("click", function () { showScreen("login"); document.getElementById("login-error").style.display = "none"; });
  document.getElementById("link-back-public").addEventListener("click", function () { showScreen("public"); });
  document.getElementById("btn-login").addEventListener("click", async function () {
    var u = document.getElementById("login-user").value.trim();
    var p = document.getElementById("login-pass").value;
    try {
      var r = await api("/api/auth/login", { method: "POST", body: { username: u, password: p } });
      token = r.token; me = r.user;
      try { localStorage.setItem("brothers_token", token); } catch (e) {}
      enterStaff();
    } catch (e) {
      document.getElementById("login-error").style.display = "block";
    }
  });
  document.getElementById("btn-logout").addEventListener("click", logout);
  function logout() {
    token = null; me = null;
    try { localStorage.removeItem("brothers_token"); } catch (e) {}
    if (pollTimer) clearInterval(pollTimer);
    showScreen("public");
  }

  async function enterStaff() {
    showScreen("staff");
    document.getElementById("who-label").textContent = me.name + " (" + (me.role === "admin" ? "admin" : "garçom") + ")";
    buildStaffTabs();
    await Promise.all([loadStaffMenu(), renderKanban(), renderSolicitacoes()]);
    if (me.role === "admin") { await loadConfigForm(); await renderUsersTable(); }
    resetStaffOrder();
    switchStaffView("solicitacoes");
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async function () {
      var active = document.querySelector("#staff-screen .view.active");
      if (!active) return;
      if (active.id === "view-solicitacoes") renderSolicitacoes();
      if (active.id === "view-pedidos") renderKanban();
    }, 6000);
  }

  var ALL_TABS = [
    { id: "solicitacoes", label: "Solicitações", roles: ["admin", "garcom"] },
    { id: "novo", label: "Novo Pedido", roles: ["admin", "garcom"] },
    { id: "pedidos", label: "Pedidos", roles: ["admin", "garcom"] },
    { id: "cardapio", label: "Cardápio", roles: ["admin", "garcom"] },
    { id: "historico", label: "Histórico", roles: ["admin", "garcom"] },
    { id: "relatorios", label: "Relatórios", roles: ["admin"] },
    { id: "config", label: "Configurações", roles: ["admin"] }
  ];
  function buildStaffTabs() {
    var nav = document.getElementById("staff-tabs");
    nav.innerHTML = "";
    ALL_TABS.filter(function (t) { return t.roles.indexOf(me.role) >= 0; }).forEach(function (t) {
      var b = document.createElement("button");
      b.textContent = t.label; b.dataset.view = t.id;
      b.addEventListener("click", function () { switchStaffView(t.id); });
      nav.appendChild(b);
    });
  }
  function switchStaffView(id) {
    document.querySelectorAll("#staff-tabs button").forEach(function (b) { b.classList.toggle("active", b.dataset.view === id); });
    document.querySelectorAll("#staff-screen .view").forEach(function (v) { v.classList.remove("active"); });
    document.getElementById("view-" + id).classList.add("active");
    if (id === "pedidos") renderKanban();
    if (id === "cardapio") renderMenuTable();
    if (id === "historico") renderHistorico();
    if (id === "relatorios") applyReportRange("today");
    if (id === "solicitacoes") renderSolicitacoes();
    if (id === "config") { loadConfigForm(); renderUsersTable(); }
  }

  function menuPickerHtml(menu) {
    if (menu.length === 0) return '<div class="empty-hint">Nenhum item cadastrado ainda.</div>';
    var cats = {};
    menu.forEach(function (it) { var c = it.category || "Outros"; if (!cats[c]) cats[c] = []; cats[c].push(it); });
    var html = "";
    Object.keys(cats).sort().forEach(function (cat) {
      html += '<div class="cat-block"><h3>' + escapeHtml(cat) + '</h3><div class="menu-grid">';
      cats[cat].forEach(function (it) {
        html += '<button type="button" class="menu-item-btn" data-id="' + it.id + '"><span class="nm">' + escapeHtml(it.name) + '</span><span class="pr">' + fmtMoney(it.price) + '</span></button>';
      });
      html += '</div></div>';
    });
    return html;
  }

  // ===================== PEDIDO PÚBLICO =====================
  var pubOrder = { type: "local", pay: "dinheiro", lines: [] };
  async function loadPublicMenuAndConfig() {
    try {
      var m = await api("/api/public/menu"); publicMenuCache = m.menu;
      var c = await api("/api/public/config"); publicConfigCache = c.config;
    } catch (e) { showToast("Não foi possível carregar o cardápio."); }
    document.getElementById("pub-menu-picker").innerHTML = menuPickerHtml(publicMenuCache);
    document.querySelectorAll("#pub-menu-picker .menu-item-btn").forEach(function (btn) { btn.addEventListener("click", function () { addPubLine(btn.dataset.id); }); });
    document.getElementById("pub-pay-online-btn").style.display = publicConfigCache.onlinePaymentEnabled ? "inline-block" : "none";
  }
  function addPubLine(menuId) {
    var item = publicMenuCache.find(function (m) { return m.id === menuId; });
    if (!item) return;
    var line = pubOrder.lines.find(function (l) { return l.menuId === menuId; });
    if (line) line.qty++; else pubOrder.lines.push({ menuId: menuId, name: item.name, price: item.price, qty: 1 });
    renderPubLines();
  }
  function renderPubLines() {
    var wrap = document.getElementById("pub-order-lines");
    if (pubOrder.lines.length === 0) { wrap.innerHTML = '<div class="empty-hint">Toque em um item do cardápio para adicionar.</div>'; }
    else {
      wrap.innerHTML = pubOrder.lines.map(function (l, idx) {
        return '<div class="order-line" data-idx="' + idx + '"><span class="nm">' + escapeHtml(l.name) + '</span>' +
          '<span class="qty-ctrl"><button type="button" class="qminus">−</button><span>' + l.qty + '</span><button type="button" class="qplus">+</button></span>' +
          '<span class="lp">' + fmtMoney(l.price * l.qty) + '</span><span class="rm">remover</span></div>';
      }).join("");
      wrap.querySelectorAll(".order-line").forEach(function (row) {
        var idx = parseInt(row.dataset.idx, 10);
        row.querySelector(".qplus").addEventListener("click", function () { pubOrder.lines[idx].qty++; renderPubLines(); });
        row.querySelector(".qminus").addEventListener("click", function () { pubOrder.lines[idx].qty--; if (pubOrder.lines[idx].qty <= 0) pubOrder.lines.splice(idx, 1); renderPubLines(); });
        row.querySelector(".rm").addEventListener("click", function () { pubOrder.lines.splice(idx, 1); renderPubLines(); });
      });
    }
    var total = pubOrder.lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    document.getElementById("pub-order-total").textContent = fmtMoney(total);
    document.getElementById("pub-pix-total").textContent = fmtMoney(total);
  }
  document.querySelectorAll("#pub-type-toggle button").forEach(function (b) {
    b.addEventListener("click", function () { pubOrder.type = b.dataset.type; document.querySelectorAll("#pub-type-toggle button").forEach(function (x) { x.classList.remove("sel"); }); b.classList.add("sel"); });
  });
  document.querySelectorAll("#pub-pay-toggle button").forEach(function (b) {
    b.addEventListener("click", function () {
      pubOrder.pay = b.dataset.pay;
      document.querySelectorAll("#pub-pay-toggle button").forEach(function (x) { x.classList.remove("sel"); });
      b.classList.add("sel");
      var showPix = pubOrder.pay === "pix_online";
      document.getElementById("pub-pix-box").style.display = showPix ? "block" : "none";
      if (showPix) document.getElementById("pub-pix-key").textContent = publicConfigCache.pixKey ? publicConfigCache.pixKey + (publicConfigCache.pixName ? " — " + publicConfigCache.pixName : "") : "Chave Pix ainda não configurada pelo restaurante.";
    });
  });
  document.getElementById("btn-copy-pix").addEventListener("click", function () {
    var key = publicConfigCache.pixKey || "";
    if (!key) { showToast("Chave Pix não configurada."); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(key).then(function () { showToast("Chave Pix copiada."); });
    else showToast(key);
  });
  function resetPublicOrder() {
    pubOrder = { type: "local", pay: "dinheiro", lines: [] };
    document.getElementById("pub-cust-name").value = ""; document.getElementById("pub-cust-phone").value = "";
    document.querySelectorAll("#pub-type-toggle button").forEach(function (b) { b.classList.toggle("sel", b.dataset.type === "local"); });
    document.querySelectorAll("#pub-pay-toggle button").forEach(function (b) { b.classList.toggle("sel", b.dataset.pay === "dinheiro"); });
    document.getElementById("pub-pix-box").style.display = "none";
    document.getElementById("pub-confirm-box").style.display = "none";
    renderPubLines();
  }
  document.getElementById("btn-pub-submit").addEventListener("click", async function () {
    if (pubOrder.lines.length === 0) { showToast("Adicione ao menos um item."); return; }
    var name = document.getElementById("pub-cust-name").value.trim();
    var phone = document.getElementById("pub-cust-phone").value.trim();
    if (!name || !phone) { showToast("Preencha seu nome e WhatsApp."); return; }
    try {
      var r = await api("/api/public/orders", {
        method: "POST",
        body: { customerName: name, customerPhone: phone, type: pubOrder.type, payment: { method: pubOrder.pay }, lines: pubOrder.lines.map(function (l) { return { menuId: l.menuId, qty: l.qty }; }) }
      });
      var order = r.order;
      var msg = buildWhatsAppOrderText(order);
      var restNumber = digitsOnly(publicConfigCache.whatsapp);
      var box = document.getElementById("pub-confirm-box");
      box.style.display = "block";
      if (restNumber) {
        box.innerHTML = "Pedido nº " + String(order.number).padStart(3, "0") + " registrado! Vamos abrir o WhatsApp para você enviar a confirmação ao restaurante.";
        window.open("https://wa.me/55" + restNumber + "?text=" + encodeURIComponent(msg), "_blank");
      } else {
        box.innerHTML = "Pedido nº " + String(order.number).padStart(3, "0") + " registrado! Avise o restaurante pelo WhatsApp com os detalhes do seu pedido.";
      }
      resetPublicOrder();
    } catch (e) { showToast("Não foi possível enviar: " + e.message); }
  });
  function buildWhatsAppOrderText(order) {
    var lines = order.lines.map(function (l) { return "- " + l.qty + "x " + l.name; }).join("\n");
    return "*NOVO PEDIDO - BROTHERS*\nCliente: " + order.customerName + "\nWhatsApp: " + order.customerPhone + "\nTipo: " + typeLabel(order.type) +
      "\nPagamento: " + payLabel(order.payment.method) + "\nItens:\n" + lines + "\nTotal: " + fmtMoney(order.total);
  }

  // ===================== SOLICITAÇÕES =====================
  async function renderSolicitacoes() {
    var r; try { r = await api("/api/orders?status=solicitacao"); } catch (e) { return; }
    var list = r.orders.sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
    var wrap = document.getElementById("solic-list");
    if (list.length === 0) { wrap.innerHTML = '<div class="empty-hint">Nenhuma solicitação pendente.</div>'; return; }
    wrap.innerHTML = list.map(function (o) {
      var itemsTxt = o.lines.map(function (l) { return l.qty + "x " + l.name; }).join(", ");
      var pixTag = "";
      if (o.payment.method === "pix_online") pixTag = o.payment.status === "confirmado" ? '<span class="tag pix-ok">Pix confirmado</span>' : '<span class="tag pix-wait">Aguardando Pix</span>';
      var canAccept = !(o.payment.method === "pix_online" && o.payment.status !== "confirmado");
      return '<div class="order-card" data-id="' + o.id + '" data-phone="' + digitsOnly(o.customerPhone) + '" data-number="' + o.number + '"><div class="oc-top"><div><div class="num">#' + String(o.number).padStart(3, "0") + '</div>' +
        '<div class="meta">' + fmtDateTime(o.createdAt) + ' · ' + escapeHtml(o.customerName) + ' · ' + escapeHtml(o.customerPhone) + '</div></div>' +
        '<div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end;"><span class="tag">' + typeLabel(o.type) + '</span><span class="tag">' + payLabel(o.payment.method) + '</span>' + pixTag + '</div></div>' +
        '<div class="items">' + escapeHtml(itemsTxt) + '</div><div class="foot"><span class="amt">' + fmtMoney(o.total) + '</span></div>' +
        '<div class="actions">' +
        (o.payment.method === "pix_online" && o.payment.status !== "confirmado" ? '<button class="btn btn-ghost btn-small confirm-pix">Confirmar pagamento Pix</button>' : '') +
        '<button class="btn btn-primary btn-small accept" ' + (canAccept ? '' : 'disabled style="opacity:.5;cursor:not-allowed;"') + '>Aceitar pedido</button>' +
        '<button class="btn btn-ghost btn-small notify-accept">Avisar cliente (WhatsApp)</button>' +
        '<button class="btn btn-danger btn-small refuse">Recusar</button></div></div>';
    }).join("");
    wrap.querySelectorAll(".order-card").forEach(function (card) {
      var id = card.dataset.id;
      var cp = card.querySelector(".confirm-pix");
      if (cp) cp.addEventListener("click", async function () { try { await api("/api/orders/" + id + "/payment", { method: "PATCH", body: { status: "confirmado" } }); renderSolicitacoes(); } catch (e) { showToast(e.message); } });
      var acc = card.querySelector(".accept");
      if (acc) acc.addEventListener("click", async function () {
        if (acc.disabled) return;
        try { var r2 = await api("/api/orders/" + id + "/status", { method: "PATCH", body: { status: "producao" } }); showToast("Pedido #" + String(r2.order.number).padStart(3, "0") + " aceito, indo para produção."); renderSolicitacoes(); renderKanban(); } catch (e) { showToast(e.message); }
      });
      card.querySelector(".notify-accept").addEventListener("click", function () {
        openWhatsAppRaw(card.dataset.phone, "Oi! Seu pedido #" + String(card.dataset.number).padStart(3, "0") + " na Brothers foi confirmado e já vai para a produção. Obrigado!");
      });
      card.querySelector(".refuse").addEventListener("click", async function () {
        if (!confirm("Recusar este pedido?")) return;
        try { await api("/api/orders/" + id + "/status", { method: "PATCH", body: { status: "recusado" } }); renderSolicitacoes(); } catch (e) { showToast(e.message); }
      });
    });
  }
  function openWhatsAppRaw(numDigits, text) {
    if (!numDigits) { showToast("Telefone do cliente não informado."); return; }
    window.open("https://wa.me/55" + numDigits + "?text=" + encodeURIComponent(text), "_blank");
  }

  // ===================== NOVO PEDIDO (balcão) =====================
  var currentOrder = { type: "local", lines: [] };
  var editingOrderId = null;
  async function loadStaffMenu() {
    try { var r = await api("/api/menu"); staffMenuCache = r.menu; } catch (e) { staffMenuCache = []; }
    document.getElementById("menu-picker").innerHTML = menuPickerHtml(staffMenuCache);
    document.querySelectorAll("#menu-picker .menu-item-btn").forEach(function (btn) { btn.addEventListener("click", function () { addLine(btn.dataset.id); }); });
  }
  document.querySelectorAll("#staff-type-toggle button").forEach(function (b) {
    b.addEventListener("click", function () { currentOrder.type = b.dataset.type; document.querySelectorAll("#staff-type-toggle button").forEach(function (x) { x.classList.remove("sel"); }); b.classList.add("sel"); });
  });
  function addLine(menuId) {
    var item = staffMenuCache.find(function (m) { return m.id === menuId; });
    if (!item) return;
    var line = currentOrder.lines.find(function (l) { return l.menuId === menuId; });
    if (line) line.qty++; else currentOrder.lines.push({ menuId: menuId, name: item.name, price: item.price, qty: 1 });
    renderOrderLines();
  }
  function renderOrderLines() {
    var wrap = document.getElementById("order-lines");
    if (currentOrder.lines.length === 0) { wrap.innerHTML = '<div class="empty-hint">Toque em um item do cardápio para adicionar.</div>'; }
    else {
      wrap.innerHTML = currentOrder.lines.map(function (l, idx) {
        return '<div class="order-line" data-idx="' + idx + '"><span class="nm">' + escapeHtml(l.name) + '</span>' +
          '<span class="qty-ctrl"><button type="button" class="qminus">−</button><span>' + l.qty + '</span><button type="button" class="qplus">+</button></span>' +
          '<span class="lp">' + fmtMoney(l.price * l.qty) + '</span><span class="rm">remover</span></div>';
      }).join("");
      wrap.querySelectorAll(".order-line").forEach(function (row) {
        var idx = parseInt(row.dataset.idx, 10);
        row.querySelector(".qplus").addEventListener("click", function () { currentOrder.lines[idx].qty++; renderOrderLines(); });
        row.querySelector(".qminus").addEventListener("click", function () { currentOrder.lines[idx].qty--; if (currentOrder.lines[idx].qty <= 0) currentOrder.lines.splice(idx, 1); renderOrderLines(); });
        row.querySelector(".rm").addEventListener("click", function () { currentOrder.lines.splice(idx, 1); renderOrderLines(); });
      });
    }
    var total = currentOrder.lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    document.getElementById("order-total").textContent = fmtMoney(total);
  }
  function resetStaffOrder() {
    currentOrder = { type: "local", lines: [] }; editingOrderId = null;
    document.getElementById("cust-name").value = ""; document.getElementById("cust-phone").value = "";
    document.querySelectorAll("#staff-type-toggle button").forEach(function (b) { b.classList.toggle("sel", b.dataset.type === "local"); });
    document.getElementById("btn-cancel-edit").style.display = "none";
    document.getElementById("order-panel-title").textContent = "Pedido atual";
    document.getElementById("btn-submit-order").textContent = "Enviar pedido e imprimir";
    renderOrderLines();
  }
  document.getElementById("btn-clear-order").addEventListener("click", function () { if (currentOrder.lines.length && !confirm("Limpar itens do pedido atual?")) return; resetStaffOrder(); });
  document.getElementById("btn-cancel-edit").addEventListener("click", resetStaffOrder);
  document.getElementById("btn-submit-order").addEventListener("click", async function () {
    if (currentOrder.lines.length === 0) { showToast("Adicione ao menos um item."); return; }
    var name = document.getElementById("cust-name").value.trim();
    var phone = document.getElementById("cust-phone").value.trim();
    var payload = { customerName: name, customerPhone: phone, type: currentOrder.type, lines: currentOrder.lines.map(function (l) { return { menuId: l.menuId, qty: l.qty }; }) };
    try {
      var order;
      if (editingOrderId) {
        var r = await api("/api/orders/" + editingOrderId, { method: "PUT", body: payload });
        order = r.order;
        showToast("Pedido #" + String(order.number).padStart(3, "0") + " atualizado.");
      } else {
        var r2 = await api("/api/orders", { method: "POST", body: payload });
        order = r2.order;
        showToast("Pedido #" + String(order.number).padStart(3, "0") + " enviado para produção.");
      }
      printReceipt(order); resetStaffOrder(); renderKanban();
    } catch (e) { showToast(e.message); }
  });
  function printReceipt(order) {
    document.getElementById("pr-sub").innerHTML = "Pedido #" + String(order.number).padStart(3, "0") + " — " + typeLabel(order.type) + "<br>" + fmtDateTime(order.createdAt) +
      (order.customerName ? "<br>Cliente: " + escapeHtml(order.customerName) : "") + (order.customerPhone ? "<br>Tel: " + escapeHtml(order.customerPhone) : "");
    document.getElementById("pr-lines").innerHTML = order.lines.map(function (l) { return '<div class="pline"><span>' + l.qty + 'x ' + escapeHtml(l.name) + '</span><span>' + fmtMoney(l.price * l.qty) + '</span></div>'; }).join("");
    document.getElementById("pr-total").textContent = fmtMoney(order.total);
    document.getElementById("pr-footer").textContent = "Obrigado pela preferência!";
    window.print();
  }

  // ===================== KANBAN =====================
  async function renderKanban() {
    var r; try { r = await api("/api/orders"); } catch (e) { return; }
    var prod = r.orders.filter(function (o) { return o.status === "producao"; });
    var ready = r.orders.filter(function (o) { return o.status === "pronto"; });
    document.getElementById("count-producao").textContent = prod.length;
    document.getElementById("count-pronto").textContent = ready.length;
    document.getElementById("col-producao").innerHTML = prod.length ? prod.map(orderCardHtml).join("") : '<div class="empty-hint">Nenhum pedido em produção.</div>';
    document.getElementById("col-pronto").innerHTML = ready.length ? ready.map(orderCardHtml).join("") : '<div class="empty-hint">Nenhum pedido pronto.</div>';
    document.querySelectorAll("#col-producao .order-card, #col-pronto .order-card").forEach(function (card) {
      var id = card.dataset.id;
      var advBtn = card.querySelector(".adv"); if (advBtn) advBtn.addEventListener("click", function () { advanceStatus(id, card.dataset.status); });
      var editBtn = card.querySelector(".edt"); if (editBtn) editBtn.addEventListener("click", function () { loadOrderForEdit(id); });
      var printBtn = card.querySelector(".prt"); if (printBtn) printBtn.addEventListener("click", function () { var o = r.orders.find(function (x) { return x.id === id; }); if (o) printReceipt(o); });
      var notifyBtn = card.querySelector(".notify"); if (notifyBtn) notifyBtn.addEventListener("click", function () {
        var o = r.orders.find(function (x) { return x.id === id; });
        var txt = o.status === "producao" ? "Seu pedido #" + String(o.number).padStart(3, "0") + " está em produção!" : "Seu pedido #" + String(o.number).padStart(3, "0") + " está pronto!";
        openWhatsAppRaw(digitsOnly(o.customerPhone), txt);
      });
      var delBtn = card.querySelector(".del"); if (delBtn) delBtn.addEventListener("click", async function () {
        if (!confirm("Cancelar este pedido?")) return;
        try { await api("/api/orders/" + id, { method: "DELETE" }); renderKanban(); } catch (e) { showToast(e.message); }
      });
    });
  }
  function orderCardHtml(o) {
    var itemsTxt = o.lines.map(function (l) { return l.qty + "x " + l.name; }).join(", ");
    var advLabel = o.status === "producao" ? "Marcar como pronto" : "Finalizar pedido";
    var hasPhone = !!digitsOnly(o.customerPhone);
    return '<div class="order-card" data-id="' + o.id + '" data-status="' + o.status + '"><div class="oc-top"><div><div class="num">#' + String(o.number).padStart(3, "0") + '</div>' +
      '<div class="meta">' + fmtDateTime(o.createdAt) + (o.customerName ? " · " + escapeHtml(o.customerName) : "") + '</div></div><span class="tag">' + typeLabel(o.type) + '</span></div>' +
      '<div class="items">' + escapeHtml(itemsTxt) + '</div><div class="foot"><span class="amt">' + fmtMoney(o.total) + '</span></div>' +
      '<div class="actions"><button class="btn btn-primary btn-small adv">' + advLabel + '</button>' +
      '<button class="btn btn-ghost btn-small edt">Editar</button><button class="btn btn-ghost btn-small prt">Imprimir</button>' +
      (hasPhone ? '<button class="btn btn-ghost btn-small notify">Avisar cliente</button>' : '') +
      '<button class="btn btn-danger btn-small del">Cancelar</button></div></div>';
  }
  async function advanceStatus(id, current) {
    var next = current === "producao" ? "pronto" : "finalizado";
    try { await api("/api/orders/" + id + "/status", { method: "PATCH", body: { status: next } }); renderKanban(); } catch (e) { showToast(e.message); }
  }
  async function loadOrderForEdit(id) {
    var r = await api("/api/orders"); var o = r.orders.find(function (x) { return x.id === id; }); if (!o) return;
    editingOrderId = id;
    currentOrder = { type: o.type, lines: o.lines.map(function (l) { return Object.assign({}, l); }) };
    document.getElementById("cust-name").value = o.customerName || ""; document.getElementById("cust-phone").value = o.customerPhone || "";
    document.querySelectorAll("#staff-type-toggle button").forEach(function (b) { b.classList.toggle("sel", b.dataset.type === o.type); });
    document.getElementById("btn-cancel-edit").style.display = "block";
    document.getElementById("order-panel-title").textContent = "Editando pedido #" + String(o.number).padStart(3, "0");
    document.getElementById("btn-submit-order").textContent = "Salvar alterações e imprimir";
    renderOrderLines();
    switchStaffView("novo");
  }

  // ===================== CARDÁPIO =====================
  document.getElementById("btn-add-menu-item").addEventListener("click", async function () {
    var name = document.getElementById("new-item-name").value.trim();
    var cat = document.getElementById("new-item-cat").value.trim() || "Outros";
    var price = parseFloat(document.getElementById("new-item-price").value);
    if (!name || isNaN(price) || price < 0) { showToast("Preencha nome e preço válidos."); return; }
    try {
      await api("/api/menu", { method: "POST", body: { name: name, category: cat, price: price } });
      document.getElementById("new-item-name").value = ""; document.getElementById("new-item-cat").value = ""; document.getElementById("new-item-price").value = "";
      await renderMenuTable(); await loadStaffMenu(); await loadPublicMenuAndConfig();
      showToast("Item adicionado.");
    } catch (e) { showToast(e.message); }
  });
  async function renderMenuTable() {
    var r; try { r = await api("/api/menu"); } catch (e) { return; }
    var body = document.getElementById("menu-table-body");
    if (r.menu.length === 0) { body.innerHTML = '<tr><td colspan="4"><div class="empty-hint">Nenhum item cadastrado.</div></td></tr>'; }
    else {
      body.innerHTML = r.menu.map(function (it) {
        return '<tr data-id="' + it.id + '"><td>' + escapeHtml(it.name) + '</td><td>' + escapeHtml(it.category) + '</td><td>' + fmtMoney(it.price) + '</td>' +
          '<td><button class="btn btn-ghost btn-small edit-item">Editar</button> <button class="btn btn-danger btn-small del-item">Excluir</button></td></tr>';
      }).join("");
      body.querySelectorAll("tr").forEach(function (tr) {
        var id = tr.dataset.id;
        tr.querySelector(".del-item").addEventListener("click", async function () {
          if (!confirm("Excluir este item?")) return;
          try { await api("/api/menu/" + id, { method: "DELETE" }); await renderMenuTable(); await loadStaffMenu(); await loadPublicMenuAndConfig(); } catch (e) { showToast(e.message); }
        });
        tr.querySelector(".edit-item").addEventListener("click", async function () {
          var item = r.menu.find(function (m) { return m.id === id; });
          var nn = prompt("Nome do item:", item.name); if (nn === null) return;
          var nc = prompt("Categoria:", item.category); if (nc === null) return;
          var np = prompt("Preço (ex: 12.50):", item.price); if (np === null) return;
          var npv = parseFloat(String(np).replace(",", "."));
          if (!nn.trim() || isNaN(npv) || npv < 0) { showToast("Valores inválidos."); return; }
          try {
            await api("/api/menu/" + id, { method: "PUT", body: { name: nn.trim(), category: nc.trim() || "Outros", price: npv } });
            await renderMenuTable(); await loadStaffMenu(); await loadPublicMenuAndConfig();
          } catch (e) { showToast(e.message); }
        });
      });
    }
    var cats = Array.from(new Set(r.menu.map(function (m) { return m.category; })));
    document.getElementById("cat-list").innerHTML = cats.map(function (c) { return '<option value="' + escapeHtml(c) + '">'; }).join("");
  }

  // ===================== HISTÓRICO =====================
  async function renderHistorico() {
    var from = document.getElementById("hist-from").value;
    var to = document.getElementById("hist-to").value;
    if (me.role === "garcom") {
      var minDate = new Date(); minDate.setDate(minDate.getDate() - 3);
      var minStr = minDate.toISOString().slice(0, 10);
      document.getElementById("hist-from").min = minStr;
      if (!from || from < minStr) from = minStr;
    }
    var qs = [];
    if (from) qs.push("from=" + from); if (to) qs.push("to=" + to);
    var r; try { r = await api("/api/orders/history" + (qs.length ? "?" + qs.join("&") : "")); } catch (e) { return; }
    var body = document.getElementById("hist-table-body");
    document.getElementById("hist-empty").style.display = r.orders.length ? "none" : "block";
    body.innerHTML = r.orders.map(function (o) {
      var itemsTxt = o.lines.map(function (l) { return l.qty + "x " + l.name; }).join(", ");
      return '<tr><td>#' + String(o.number).padStart(3, "0") + '</td><td>' + fmtDateTime(o.finalizedAt) + '</td><td>' + escapeHtml(o.customerName || "—") + '</td>' +
        '<td>' + typeLabel(o.type) + '</td><td>' + escapeHtml(itemsTxt) + '</td><td>' + fmtMoney(o.total) + '</td></tr>';
    }).join("");
  }
  document.getElementById("btn-hist-filter").addEventListener("click", renderHistorico);
  document.getElementById("btn-hist-clear").addEventListener("click", function () { document.getElementById("hist-from").value = ""; document.getElementById("hist-to").value = ""; renderHistorico(); });

  // ===================== RELATÓRIOS =====================
  function applyReportRange(preset) {
    var now = new Date(); var from, to;
    if (preset === "today") { from = to = now.toISOString().slice(0, 10); }
    else if (preset === "week") { var day = now.getDay(); var monday = new Date(now); monday.setDate(now.getDate() - ((day + 6) % 7)); from = monday.toISOString().slice(0, 10); to = now.toISOString().slice(0, 10); }
    else if (preset === "month") { var first = new Date(now.getFullYear(), now.getMonth(), 1); from = first.toISOString().slice(0, 10); to = now.toISOString().slice(0, 10); }
    document.getElementById("rep-from").value = from; document.getElementById("rep-to").value = to;
    renderReport(from, to);
  }
  document.querySelectorAll("[data-range]").forEach(function (btn) { btn.addEventListener("click", function () { applyReportRange(btn.dataset.range); }); });
  document.getElementById("btn-rep-custom").addEventListener("click", function () {
    var from = document.getElementById("rep-from").value, to = document.getElementById("rep-to").value;
    if (!from || !to) { showToast("Selecione as duas datas."); return; }
    renderReport(from, to);
  });
  async function renderReport(from, to) {
    var r; try { r = await api("/api/reports?from=" + from + "&to=" + to); } catch (e) { return; }
    document.getElementById("rep-revenue").textContent = fmtMoney(r.revenue);
    document.getElementById("rep-count").textContent = r.count;
    document.getElementById("rep-avg").textContent = fmtMoney(r.avg);
    var maxType = Math.max(1, r.byType.local, r.byType.delivery, r.byType.retirada);
    document.getElementById("rep-by-type").innerHTML = ["local", "delivery", "retirada"].map(function (t) {
      var pct = Math.round((r.byType[t] / maxType) * 100);
      return '<div class="bar-row"><span class="lbl">' + typeLabel(t) + '</span><span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span><span class="val">' + fmtMoney(r.byType[t]) + '</span></div>';
    }).join("");
    var maxQty = Math.max(1, r.topItems.length ? r.topItems[0].qty : 1);
    document.getElementById("rep-top-items").innerHTML = r.topItems.length ? r.topItems.map(function (it) {
      var pct = Math.round((it.qty / maxQty) * 100);
      return '<div class="bar-row"><span class="lbl">' + escapeHtml(it.name) + '</span><span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span><span class="val">' + it.qty + ' un · ' + fmtMoney(it.revenue) + '</span></div>';
    }).join("") : '<div class="empty-hint">Sem dados no período.</div>';
  }

  // ===================== CONFIGURAÇÕES =====================
  async function loadConfigForm() {
    var r; try { r = await api("/api/config"); } catch (e) { return; }
    document.getElementById("cfg-whatsapp").value = r.config.whatsapp || "";
    document.getElementById("cfg-pix-name").value = r.config.pixName || "";
    document.getElementById("cfg-pix-key").value = r.config.pixKey || "";
    document.getElementById("cfg-online-toggle").checked = !!r.config.onlinePaymentEnabled;
  }
  document.getElementById("btn-save-config").addEventListener("click", async function () {
    try {
      await api("/api/config", {
        method: "PUT", body: {
          whatsapp: document.getElementById("cfg-whatsapp").value,
          pixName: document.getElementById("cfg-pix-name").value.trim(),
          pixKey: document.getElementById("cfg-pix-key").value.trim(),
          onlinePaymentEnabled: document.getElementById("cfg-online-toggle").checked
        }
      });
      await loadPublicMenuAndConfig();
      showToast("Configurações salvas.");
    } catch (e) { showToast(e.message); }
  });
  async function renderUsersTable() {
    var r; try { r = await api("/api/users"); } catch (e) { return; }
    var body = document.getElementById("users-table-body");
    body.innerHTML = r.users.map(function (u) {
      return '<tr data-id="' + u.id + '"><td>' + escapeHtml(u.username) + '</td><td>' + (u.role === "admin" ? "Admin" : "Garçom") + '</td>' +
        '<td>' + (r.users.length > 1 ? '<button class="btn btn-danger btn-small del-user">Excluir</button>' : '') + '</td></tr>';
    }).join("");
    body.querySelectorAll(".del-user").forEach(function (btn) {
      var tr = btn.closest("tr"); var id = tr.dataset.id;
      btn.addEventListener("click", async function () {
        if (id === me.id) { showToast("Você não pode excluir seu próprio usuário."); return; }
        if (!confirm("Excluir este usuário?")) return;
        try { await api("/api/users/" + id, { method: "DELETE" }); renderUsersTable(); } catch (e) { showToast(e.message); }
      });
    });
  }
  document.getElementById("btn-add-user").addEventListener("click", async function () {
    var u = document.getElementById("new-user-username").value.trim();
    var p = document.getElementById("new-user-password").value;
    var role = document.getElementById("new-user-role").value;
    if (!u || !p) { showToast("Preencha usuário e senha."); return; }
    try {
      await api("/api/users", { method: "POST", body: { username: u, password: p, role: role, name: u } });
      document.getElementById("new-user-username").value = ""; document.getElementById("new-user-password").value = "";
      renderUsersTable();
      showToast("Usuário adicionado.");
    } catch (e) { showToast(e.message); }
  });

  boot();
})();
