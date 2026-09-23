(function () {
  "use strict";
  var API = "";
  var token = null;
  var me = null;
  try { token = localStorage.getItem("brothers_token"); } catch (e) {}

  var publicMenuCache = [];
  var publicConfigCache = { whatsapp: "", pixKey: "", pixName: "", onlinePaymentEnabled: false, accentColor: "#B9862F", logoImage: "", coverImage: "", deliveryZones: [] };
  var staffMenuCache = [];
  var staffConfigCache = null;
  var pollTimer = null;
  var evtSource = null;

  function fmtMoney(v) { return "R$ " + (Math.round(v * 100) / 100).toFixed(2).replace(".", ","); }
  function fmtDateTime(iso) { var d = new Date(iso); return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  function typeLabel(t) { return t === "local" ? "Consumo no local" : t === "delivery" ? "Delivery" : "Retirada"; }
  function payLabel(p) { return { dinheiro: "Dinheiro", cartao: "Cartão", pix_entrega: "Pix na entrega", pix_online: "Pix (online)", balcao: "Balcão" }[p] || p; }
  function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function showToast(msg) { var t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); setTimeout(function () { t.classList.remove("show"); }, 2600); }
  function uidLocal() { return Math.random().toString(36).slice(2, 10); }

  // ===================== cor de destaque =====================
  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 59, g: 18, b: 18 };
  }
  function rgbToHex(r, g, b) { return "#" + [r, g, b].map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"); }).join(""); }
  function darken(hex, amt) { var c = hexToRgb(hex); return rgbToHex(c.r * (1 - amt), c.g * (1 - amt), c.b * (1 - amt)); }
  function luminance(hex) { var c = hexToRgb(hex); var a = [c.r, c.g, c.b].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
  function applyAccentColor(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || "")) hex = "#B9862F";
    document.documentElement.style.setProperty("--wine", hex);
    document.documentElement.style.setProperty("--wine-dark", darken(hex, 0.3));
    document.documentElement.style.setProperty("--accent-text", luminance(hex) > 0.45 ? "#221600" : "#FFFFFF");
  }

  // ===================== redimensionar/recortar imagem =====================
  function fileToResizedDataUrl(file, square, maxDim) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var sw = img.width, sh = img.height, sx = 0, sy = 0;
          if (square) {
            var side = Math.min(sw, sh);
            sx = (sw - side) / 2; sy = (sh - side) / 2; sw = side; sh = side;
          }
          var outW = square ? Math.min(maxDim, sw) : Math.min(maxDim, sw);
          var scale = outW / sw;
          var outH = square ? outW : Math.round(sh * scale);
          var canvas = document.createElement("canvas");
          canvas.width = outW; canvas.height = outH;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (token) headers.Authorization = "Bearer " + token;
    var res = await fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      if (res.status === 401 && path !== "/api/auth/login") logout();
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
      try { var r = await api("/api/auth/me"); me = r.user; await enterStaff(); return; }
      catch (e) { token = null; try { localStorage.removeItem("brothers_token"); } catch (e2) {} }
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
      await enterStaff();
    } catch (e) { document.getElementById("login-error").style.display = "block"; }
  });
  document.getElementById("btn-logout").addEventListener("click", logout);
  function logout() {
    token = null; me = null;
    try { localStorage.removeItem("brothers_token"); } catch (e) {}
    if (pollTimer) clearInterval(pollTimer);
    if (evtSource) { evtSource.close(); evtSource = null; }
    applyAccentColor(publicConfigCache.accentColor);
    showScreen("public");
  }

  async function enterStaff() {
    showScreen("staff");
    document.getElementById("who-label").textContent = me.name + " (" + (me.role === "admin" ? "admin" : "garçom") + ")";
    buildStaffTabs();
    if (me.role === "admin") { staffConfigCache = (await api("/api/config")).config; applyAccentColor(staffConfigCache.accentColor); }
    else applyAccentColor(publicConfigCache.accentColor);
    await Promise.all([loadStaffMenu(), renderPedidosBoard()]);
    if (me.role === "admin") { await loadConfigForm(); await renderUsersTable(); }
    resetStaffOrder();
    switchStaffView("pedidos");
    connectEvents();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      var active = document.querySelector("#staff-screen .view.active");
      if (active && active.id === "view-pedidos") renderPedidosBoard();
    }, 15000); // rede de segurança caso o SSE caia
  }

  function connectEvents() {
    if (evtSource) evtSource.close();
    evtSource = new EventSource(API + "/api/events?token=" + encodeURIComponent(token));
    evtSource.addEventListener("orders_changed", function () {
      var active = document.querySelector("#staff-screen .view.active");
      if (active && active.id === "view-pedidos") renderPedidosBoard();
    });
    evtSource.addEventListener("menu_changed", function () {
      loadStaffMenu();
      var active = document.querySelector("#staff-screen .view.active");
      if (active && active.id === "view-cardapio") renderMenuByCategory();
    });
    evtSource.onerror = function () { /* o EventSource tenta reconectar sozinho */ };
  }

  var ALL_TABS = [
    { id: "pedidos", label: "Pedidos", roles: ["admin", "garcom"] },
    { id: "novo", label: "Novo Pedido", roles: ["admin", "garcom"] },
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
    if (id === "pedidos") renderPedidosBoard();
    if (id === "cardapio") renderMenuByCategory();
    if (id === "historico") renderHistorico();
    if (id === "relatorios") applyReportRange("today");
    if (id === "config") { loadConfigForm(); renderUsersTable(); }
  }

  function stockLabel(item) {
    if (!item.stock || !item.stock.enabled) return "";
    if (item.stock.quantity <= 0) return "Esgotado";
    if (item.stock.quantity <= 3) return "Só " + item.stock.quantity + " disponível(is)";
    return item.stock.quantity + " disponíveis";
  }
  function menuPickerHtml(menu) {
    if (menu.length === 0) return '<div class="empty-hint">Nenhum item cadastrado ainda.</div>';
    var cats = {};
    menu.forEach(function (it) { var c = it.category || "Outros"; if (!cats[c]) cats[c] = []; cats[c].push(it); });
    var html = "";
    Object.keys(cats).forEach(function (cat) {
      html += '<div class="cat-block"><h3>' + escapeHtml(cat) + '</h3><div class="menu-grid">';
      cats[cat].forEach(function (it) {
        var out = it.stock && it.stock.enabled && it.stock.quantity <= 0;
        var lbl = stockLabel(it);
        html += '<button type="button" class="menu-item-btn' + (out ? ' out' : '') + '" data-id="' + it.id + '" ' + (out ? 'disabled' : '') + '>' +
          '<span class="thumb" style="' + (it.image ? 'background-image:url(' + JSON.stringify(it.image) + ')' : '') + '"></span>' +
          '<span class="txt"><span class="nm">' + escapeHtml(it.name) + '</span><span class="pr">' + fmtMoney(it.price) + '</span>' +
          (lbl ? '<span class="stockflag' + (it.stock.quantity <= 3 ? ' low' : '') + '">' + lbl + '</span>' : '') + '</span></button>';
      });
      html += '</div></div>';
    });
    return html;
  }

  // ===================== modal de complementos (carrinho) =====================
  var addonModalResolve = null;
  function openAddonModal(item) {
    return new Promise(function (resolve) {
      addonModalResolve = resolve;
      document.getElementById("addon-modal-title").textContent = "Complementos — " + item.name;
      document.getElementById("addon-modal-list").innerHTML = item.addons.map(function (a) {
        return '<div class="addon-pick-row"><input type="checkbox" data-id="' + a.id + '" data-price="' + a.price + '" id="ao-' + a.id + '">' +
          '<label for="ao-' + a.id + '">' + escapeHtml(a.name) + ' (+' + fmtMoney(a.price) + ')</label></div>';
      }).join("");
      document.getElementById("addon-modal").classList.add("show");
    });
  }
  document.getElementById("addon-modal-confirm").addEventListener("click", function () {
    var chosen = [];
    document.querySelectorAll("#addon-modal-list input[type=checkbox]:checked").forEach(function (cb) { chosen.push({ id: cb.dataset.id, price: parseFloat(cb.dataset.price) }); });
    document.getElementById("addon-modal").classList.remove("show");
    if (addonModalResolve) addonModalResolve(chosen);
  });
  document.getElementById("addon-modal-cancel").addEventListener("click", function () {
    document.getElementById("addon-modal").classList.remove("show");
    if (addonModalResolve) addonModalResolve(null);
  });

  // ===================== PEDIDO PÚBLICO =====================
  var pubOrder = { type: "local", pay: "dinheiro", lines: [] };
  async function loadPublicMenuAndConfig() {
    try {
      var m = await api("/api/public/menu"); publicMenuCache = m.menu;
      var c = await api("/api/public/config"); publicConfigCache = c.config;
    } catch (e) { showToast("Não foi possível carregar o cardápio."); }
    applyAccentColor(publicConfigCache.accentColor);
    document.getElementById("pub-title").textContent = "BROTHERS";
    document.getElementById("pub-cover").style.backgroundImage = publicConfigCache.coverImage ? "url(" + JSON.stringify(publicConfigCache.coverImage) + ")" : "";
    document.getElementById("pub-avatar").style.backgroundImage = publicConfigCache.logoImage ? "url(" + JSON.stringify(publicConfigCache.logoImage) + ")" : "";
    document.getElementById("pub-menu-picker").innerHTML = menuPickerHtml(publicMenuCache);
    document.querySelectorAll("#pub-menu-picker .menu-item-btn").forEach(function (btn) { if (!btn.disabled) btn.addEventListener("click", function () { addPubLine(btn.dataset.id); }); });
    document.getElementById("pub-pay-online-btn").style.display = publicConfigCache.onlinePaymentEnabled ? "inline-block" : "none";
    var sel = document.getElementById("pub-addr-neighborhood");
    sel.innerHTML = '<option value="">Selecione...</option>' + publicConfigCache.deliveryZones.map(function (z) { return '<option value="' + escapeHtml(z.name) + '" data-fee="' + z.fee + '">' + escapeHtml(z.name) + ' — ' + fmtMoney(z.fee) + '</option>'; }).join("");
  }
  async function addPubLine(menuId) {
    var item = publicMenuCache.find(function (m) { return m.id === menuId; });
    if (!item) return;
    if (item.addons && item.addons.length) {
      var chosen = await openAddonModal(item);
      if (chosen === null) return;
      var addonsTotal = chosen.reduce(function (s, a) { return s + a.price; }, 0);
      var names = chosen.map(function (a) { var ad = item.addons.find(function (x) { return x.id === a.id; }); return ad ? ad.name : ""; }).filter(Boolean);
      pubOrder.lines.push({ lineId: uidLocal(), menuId: menuId, name: item.name, price: item.price + addonsTotal, qty: 1, addonIds: chosen.map(function (a) { return a.id; }), addonsLabel: names.join(", ") });
    } else {
      var line = pubOrder.lines.find(function (l) { return l.menuId === menuId && !l.addonIds; });
      if (line) line.qty++; else pubOrder.lines.push({ lineId: uidLocal(), menuId: menuId, name: item.name, price: item.price, qty: 1 });
    }
    renderPubLines();
  }
  function computeDeliveryFee() {
    var sel = document.getElementById("pub-addr-neighborhood");
    var opt = sel.selectedOptions[0];
    return opt && opt.value ? parseFloat(opt.dataset.fee || "0") : 0;
  }
  function renderPubLines() {
    var wrap = document.getElementById("pub-order-lines");
    if (pubOrder.lines.length === 0) { wrap.innerHTML = '<div class="empty-hint">Toque em um item do cardápio para adicionar.</div>'; }
    else {
      wrap.innerHTML = pubOrder.lines.map(function (l, idx) {
        return '<div class="order-line" data-idx="' + idx + '"><div class="row1"><span class="nm">' + escapeHtml(l.name) + (l.addonsLabel ? '<span class="addons-note"><br>+ ' + escapeHtml(l.addonsLabel) + '</span>' : '') + '</span>' +
          '<span class="qty-ctrl"><button type="button" class="qminus">−</button><span>' + l.qty + '</span><button type="button" class="qplus">+</button></span>' +
          '<span class="lp">' + fmtMoney(l.price * l.qty) + '</span><span class="rm">remover</span></div></div>';
      }).join("");
      wrap.querySelectorAll(".order-line").forEach(function (row) {
        var idx = parseInt(row.dataset.idx, 10);
        row.querySelector(".qplus").addEventListener("click", function () { pubOrder.lines[idx].qty++; renderPubLines(); });
        row.querySelector(".qminus").addEventListener("click", function () { pubOrder.lines[idx].qty--; if (pubOrder.lines[idx].qty <= 0) pubOrder.lines.splice(idx, 1); renderPubLines(); });
        row.querySelector(".rm").addEventListener("click", function () { pubOrder.lines.splice(idx, 1); renderPubLines(); });
      });
    }
    var itemsTotal = pubOrder.lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    var deliveryFee = pubOrder.type === "delivery" ? computeDeliveryFee() : 0;
    document.getElementById("pub-order-total").textContent = fmtMoney(itemsTotal + deliveryFee);
    document.getElementById("pub-pix-total").textContent = fmtMoney(itemsTotal + deliveryFee);
    var feeBox = document.getElementById("pub-delivery-fee-box");
    if (pubOrder.type === "delivery" && deliveryFee > 0) { feeBox.style.display = "block"; feeBox.textContent = "Taxa de entrega: " + fmtMoney(deliveryFee); }
    else feeBox.style.display = "none";
  }
  document.querySelectorAll("#pub-type-toggle button").forEach(function (b) {
    b.addEventListener("click", function () {
      pubOrder.type = b.dataset.type;
      document.querySelectorAll("#pub-type-toggle button").forEach(function (x) { x.classList.remove("sel"); });
      b.classList.add("sel");
      document.getElementById("pub-delivery-box").style.display = pubOrder.type === "delivery" ? "block" : "none";
      renderPubLines();
    });
  });
  document.getElementById("pub-addr-neighborhood").addEventListener("change", renderPubLines);
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
    document.getElementById("pub-addr-street").value = ""; document.getElementById("pub-addr-number").value = "";
    document.getElementById("pub-addr-neighborhood").value = "";
    document.querySelectorAll("#pub-type-toggle button").forEach(function (b) { b.classList.toggle("sel", b.dataset.type === "local"); });
    document.querySelectorAll("#pub-pay-toggle button").forEach(function (b) { b.classList.toggle("sel", b.dataset.pay === "dinheiro"); });
    document.getElementById("pub-delivery-box").style.display = "none";
    document.getElementById("pub-pix-box").style.display = "none";
    document.getElementById("pub-confirm-box").style.display = "none";
    renderPubLines();
  }
  document.getElementById("btn-pub-submit").addEventListener("click", async function () {
    if (pubOrder.lines.length === 0) { showToast("Adicione ao menos um item."); return; }
    var name = document.getElementById("pub-cust-name").value.trim();
    var phone = document.getElementById("pub-cust-phone").value.trim();
    if (!name || !phone) { showToast("Preencha seu nome e WhatsApp."); return; }
    var deliveryPayload = null;
    if (pubOrder.type === "delivery") {
      var street = document.getElementById("pub-addr-street").value.trim();
      var number = document.getElementById("pub-addr-number").value.trim();
      var neighborhood = document.getElementById("pub-addr-neighborhood").value;
      if (!street || !number || !neighborhood) { showToast("Preencha o endereço completo de entrega."); return; }
      deliveryPayload = { street: street, number: number, neighborhood: neighborhood };
    }
    try {
      var r = await api("/api/public/orders", {
        method: "POST",
        body: {
          customerName: name, customerPhone: phone, type: pubOrder.type, payment: { method: pubOrder.pay }, delivery: deliveryPayload,
          lines: pubOrder.lines.map(function (l) { return { menuId: l.menuId, qty: l.qty, addonIds: l.addonIds || [] }; })
        }
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
        box.innerHTML = "Pedido nº " + String(order.number).padStart(3, "0") + " registrado!";
      }
      resetPublicOrder();
      loadPublicMenuAndConfig();
    } catch (e) { showToast("Não foi possível enviar: " + e.message); }
  });
  function buildWhatsAppOrderText(order) {
    var lines = order.lines.map(function (l) { return "- " + l.qty + "x " + l.name; }).join("\n");
    var addr = order.delivery ? ("\nEndereço: " + order.delivery.street + ", " + order.delivery.number + " - " + order.delivery.neighborhood + " (taxa " + fmtMoney(order.delivery.fee) + ")") : "";
    return "*NOVO PEDIDO - BROTHERS*\nCliente: " + order.customerName + "\nWhatsApp: " + order.customerPhone + "\nTipo: " + typeLabel(order.type) + addr +
      "\nPagamento: " + payLabel(order.payment.method) + "\nItens:\n" + lines + "\nTotal: " + fmtMoney(order.total);
  }

  // ===================== PEDIDOS + SOLICITAÇÕES (board único) =====================
  async function renderPedidosBoard() {
    var r; try { r = await api("/api/orders"); } catch (e) { return; }
    var solic = r.orders.filter(function (o) { return o.status === "solicitacao"; }).sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
    var prod = r.orders.filter(function (o) { return o.status === "producao"; });
    var ready = r.orders.filter(function (o) { return o.status === "pronto"; });
    document.getElementById("count-solic").textContent = solic.length;
    document.getElementById("count-producao").textContent = prod.length;
    document.getElementById("count-pronto").textContent = ready.length;
    document.getElementById("col-solic").innerHTML = solic.length ? solic.map(solicCardHtml).join("") : '<div class="empty-hint">Nenhuma solicitação pendente.</div>';
    document.getElementById("col-producao").innerHTML = prod.length ? prod.map(orderCardHtml).join("") : '<div class="empty-hint">Nenhum pedido em produção.</div>';
    document.getElementById("col-pronto").innerHTML = ready.length ? ready.map(orderCardHtml).join("") : '<div class="empty-hint">Nenhum pedido pronto.</div>';
    wireSolicCards(r.orders);
    wireOrderCards(r.orders);
  }
  function addressLine(o) { return o.delivery ? ('<div class="addr">📍 ' + escapeHtml(o.delivery.street) + ', ' + escapeHtml(o.delivery.number) + ' — ' + escapeHtml(o.delivery.neighborhood) + ' (taxa ' + fmtMoney(o.delivery.fee) + ')</div>') : ""; }
  function lineItemsText(o) { return o.lines.map(function (l) { return l.qty + "x " + l.name + (l.addons && l.addons.length ? " (" + l.addons.map(function (a) { return a.name; }).join(", ") + ")" : ""); }).join(", "); }
  function solicCardHtml(o) {
    var pixTag = "";
    if (o.payment.method === "pix_online") pixTag = o.payment.status === "confirmado" ? '<span class="tag pix-ok">Pix confirmado</span>' : '<span class="tag pix-wait">Aguardando Pix</span>';
    var canAccept = !(o.payment.method === "pix_online" && o.payment.status !== "confirmado");
    return '<div class="order-card" data-id="' + o.id + '" data-phone="' + digitsOnly(o.customerPhone) + '" data-number="' + o.number + '"><div class="oc-top"><div><div class="num">#' + String(o.number).padStart(3, "0") + '</div>' +
      '<div class="meta">' + fmtDateTime(o.createdAt) + ' · ' + escapeHtml(o.customerName) + ' · ' + escapeHtml(o.customerPhone) + '</div></div>' +
      '<div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end;"><span class="tag">' + typeLabel(o.type) + '</span><span class="tag">' + payLabel(o.payment.method) + '</span>' + pixTag + '</div></div>' +
      '<div class="items">' + escapeHtml(lineItemsText(o)) + '</div>' + addressLine(o) + '<div class="foot"><span class="amt">' + fmtMoney(o.total) + '</span></div>' +
      '<div class="actions">' +
      (o.payment.method === "pix_online" && o.payment.status !== "confirmado" ? '<button class="btn btn-ghost btn-small confirm-pix">Confirmar pagamento Pix</button>' : '') +
      '<button class="btn btn-primary btn-small accept" ' + (canAccept ? '' : 'disabled style="opacity:.5;cursor:not-allowed;"') + '>Aceitar pedido</button>' +
      '<button class="btn btn-ghost btn-small notify-accept">Avisar cliente</button>' +
      '<button class="btn btn-danger btn-small refuse">Recusar</button></div></div>';
  }
  function wireSolicCards() {
    document.querySelectorAll("#col-solic .order-card").forEach(function (card) {
      var id = card.dataset.id;
      var cp = card.querySelector(".confirm-pix");
      if (cp) cp.addEventListener("click", async function () { try { await api("/api/orders/" + id + "/payment", { method: "PATCH", body: { status: "confirmado" } }); renderPedidosBoard(); } catch (e) { showToast(e.message); } });
      var acc = card.querySelector(".accept");
      if (acc) acc.addEventListener("click", async function () {
        if (acc.disabled) return;
        try { var r2 = await api("/api/orders/" + id + "/status", { method: "PATCH", body: { status: "producao" } }); showToast("Pedido #" + String(r2.order.number).padStart(3, "0") + " aceito."); renderPedidosBoard(); } catch (e) { showToast(e.message); }
      });
      card.querySelector(".notify-accept").addEventListener("click", function () {
        openWhatsAppRaw(card.dataset.phone, "Oi! Seu pedido #" + String(card.dataset.number).padStart(3, "0") + " na Brothers foi confirmado e já vai para a produção. Obrigado!");
      });
      card.querySelector(".refuse").addEventListener("click", async function () {
        if (!confirm("Recusar este pedido?")) return;
        try { await api("/api/orders/" + id + "/status", { method: "PATCH", body: { status: "recusado" } }); renderPedidosBoard(); } catch (e) { showToast(e.message); }
      });
    });
  }
  function openWhatsAppRaw(numDigits, text) {
    if (!numDigits) { showToast("Telefone do cliente não informado."); return; }
    window.open("https://wa.me/55" + numDigits + "?text=" + encodeURIComponent(text), "_blank");
  }
  function orderCardHtml(o) {
    var advLabel = o.status === "producao" ? "Marcar como pronto" : "Finalizar pedido";
    var hasPhone = !!digitsOnly(o.customerPhone);
    return '<div class="order-card" data-id="' + o.id + '" data-status="' + o.status + '" data-phone="' + digitsOnly(o.customerPhone) + '"><div class="oc-top"><div><div class="num">#' + String(o.number).padStart(3, "0") + '</div>' +
      '<div class="meta">' + fmtDateTime(o.createdAt) + (o.customerName ? " · " + escapeHtml(o.customerName) : "") + '</div></div><span class="tag">' + typeLabel(o.type) + '</span></div>' +
      '<div class="items">' + escapeHtml(lineItemsText(o)) + '</div>' + addressLine(o) + '<div class="foot"><span class="amt">' + fmtMoney(o.total) + '</span></div>' +
      '<div class="actions"><button class="btn btn-primary btn-small adv">' + advLabel + '</button>' +
      '<button class="btn btn-ghost btn-small edt">Editar</button><button class="btn btn-ghost btn-small prt">Imprimir</button>' +
      (hasPhone ? '<button class="btn btn-ghost btn-small notify">Avisar cliente</button>' : '') +
      '<button class="btn btn-danger btn-small del">Cancelar</button></div></div>';
  }
  function wireOrderCards(allOrders) {
    document.querySelectorAll("#col-producao .order-card, #col-pronto .order-card").forEach(function (card) {
      var id = card.dataset.id;
      var advBtn = card.querySelector(".adv"); if (advBtn) advBtn.addEventListener("click", function () { advanceStatus(id, card.dataset.status); });
      var editBtn = card.querySelector(".edt"); if (editBtn) editBtn.addEventListener("click", function () { loadOrderForEdit(id); });
      var printBtn = card.querySelector(".prt"); if (printBtn) printBtn.addEventListener("click", function () { var o = allOrders.find(function (x) { return x.id === id; }); if (o) printReceipt(o); });
      var notifyBtn = card.querySelector(".notify"); if (notifyBtn) notifyBtn.addEventListener("click", function () {
        var o = allOrders.find(function (x) { return x.id === id; });
        var txt = o.status === "producao" ? "Seu pedido #" + String(o.number).padStart(3, "0") + " está em produção!" : "Seu pedido #" + String(o.number).padStart(3, "0") + " está pronto!";
        openWhatsAppRaw(digitsOnly(o.customerPhone), txt);
      });
      var delBtn = card.querySelector(".del"); if (delBtn) delBtn.addEventListener("click", async function () {
        if (!confirm("Cancelar este pedido?")) return;
        try { await api("/api/orders/" + id, { method: "DELETE" }); renderPedidosBoard(); } catch (e) { showToast(e.message); }
      });
    });
  }
  async function advanceStatus(id, current) {
    var next = current === "producao" ? "pronto" : "finalizado";
    try { await api("/api/orders/" + id + "/status", { method: "PATCH", body: { status: next } }); renderPedidosBoard(); } catch (e) { showToast(e.message); }
  }

  // ===================== NOVO PEDIDO (balcão) =====================
  var currentOrder = { type: "local", lines: [] };
  var editingOrderId = null;
  async function loadStaffMenu() {
    try { var r = await api("/api/menu"); staffMenuCache = r.menu; } catch (e) { staffMenuCache = []; }
    document.getElementById("menu-picker").innerHTML = menuPickerHtml(staffMenuCache);
    document.querySelectorAll("#menu-picker .menu-item-btn").forEach(function (btn) { if (!btn.disabled) btn.addEventListener("click", function () { addLine(btn.dataset.id); }); });
  }
  document.querySelectorAll("#staff-type-toggle button").forEach(function (b) {
    b.addEventListener("click", function () { currentOrder.type = b.dataset.type; document.querySelectorAll("#staff-type-toggle button").forEach(function (x) { x.classList.remove("sel"); }); b.classList.add("sel"); });
  });
  async function addLine(menuId) {
    var item = staffMenuCache.find(function (m) { return m.id === menuId; });
    if (!item) return;
    if (item.addons && item.addons.length) {
      var chosen = await openAddonModal(item);
      if (chosen === null) return;
      var addonsTotal = chosen.reduce(function (s, a) { return s + a.price; }, 0);
      var names = chosen.map(function (a) { var ad = item.addons.find(function (x) { return x.id === a.id; }); return ad ? ad.name : ""; }).filter(Boolean);
      currentOrder.lines.push({ menuId: menuId, name: item.name, price: item.price + addonsTotal, qty: 1, addonIds: chosen.map(function (a) { return a.id; }), addonsLabel: names.join(", ") });
    } else {
      var line = currentOrder.lines.find(function (l) { return l.menuId === menuId && !l.addonIds; });
      if (line) line.qty++; else currentOrder.lines.push({ menuId: menuId, name: item.name, price: item.price, qty: 1 });
    }
    renderOrderLines();
  }
  function renderOrderLines() {
    var wrap = document.getElementById("order-lines");
    if (currentOrder.lines.length === 0) { wrap.innerHTML = '<div class="empty-hint">Toque em um item do cardápio para adicionar.</div>'; }
    else {
      wrap.innerHTML = currentOrder.lines.map(function (l, idx) {
        return '<div class="order-line" data-idx="' + idx + '"><div class="row1"><span class="nm">' + escapeHtml(l.name) + (l.addonsLabel ? '<span class="addons-note"><br>+ ' + escapeHtml(l.addonsLabel) + '</span>' : '') + '</span>' +
          '<span class="qty-ctrl"><button type="button" class="qminus">−</button><span>' + l.qty + '</span><button type="button" class="qplus">+</button></span>' +
          '<span class="lp">' + fmtMoney(l.price * l.qty) + '</span><span class="rm">remover</span></div></div>';
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
    var payload = { customerName: name, customerPhone: phone, type: currentOrder.type, lines: currentOrder.lines.map(function (l) { return { menuId: l.menuId, qty: l.qty, addonIds: l.addonIds || [] }; }) };
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
      printReceipt(order); resetStaffOrder(); renderPedidosBoard(); loadStaffMenu();
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

  // ===================== CARDÁPIO (categorias, itens, reordenar) =====================
  async function renderMenuByCategory() {
    var r; try { r = await api("/api/menu"); } catch (e) { return; }
    staffMenuCache = r.menu;
    var cats = [];
    var byCat = {};
    r.menu.forEach(function (it) { var c = it.category || "Outros"; if (!byCat[c]) { byCat[c] = []; cats.push(c); } byCat[c].push(it); });

    // painel de ordem das categorias
    document.getElementById("cat-order-list").innerHTML = cats.length ? cats.map(function (c, idx) {
      return '<div class="reorder-row" data-cat="' + escapeHtml(c) + '"><span class="lbl">' + escapeHtml(c) + '</span>' +
        '<span class="arrows"><button type="button" class="cat-up" ' + (idx === 0 ? 'disabled' : '') + '>↑</button><button type="button" class="cat-down" ' + (idx === cats.length - 1 ? 'disabled' : '') + '>↓</button></span></div>';
    }).join("") : '<div class="empty-hint">Adicione itens ao cardápio para organizar as categorias.</div>';
    document.querySelectorAll("#cat-order-list .cat-up").forEach(function (btn, idx) { btn.addEventListener("click", function () { moveCategory(cats, idx, -1); }); });
    document.querySelectorAll("#cat-order-list .cat-down").forEach(function (btn, idx) { btn.addEventListener("click", function () { moveCategory(cats, idx, 1); }); });

    // lista de itens por categoria com setas de ordenação
    document.getElementById("menu-by-category").innerHTML = cats.map(function (cat) {
      var items = byCat[cat];
      return '<div class="menu-cat-section"><h4>' + escapeHtml(cat) + '</h4>' + items.map(function (it, idx) {
        return '<div class="item-row" data-id="' + it.id + '" data-cat="' + escapeHtml(cat) + '">' +
          '<span class="thumb" style="' + (it.image ? 'background-image:url(' + JSON.stringify(it.image) + ')' : '') + '"></span>' +
          '<span class="info"><span class="nm">' + escapeHtml(it.name) + '</span><br><span class="meta">' + fmtMoney(it.price) + (it.stock && it.stock.enabled ? ' · estoque: ' + it.stock.quantity : '') + (it.addons && it.addons.length ? ' · ' + it.addons.length + ' complemento(s)' : '') + '</span></span>' +
          '<span class="arrows"><button type="button" class="it-up" ' + (idx === 0 ? 'disabled' : '') + '>↑</button><button type="button" class="it-down" ' + (idx === items.length - 1 ? 'disabled' : '') + '>↓</button></span>' +
          '<button class="btn btn-ghost btn-small it-edit">Editar</button><button class="btn btn-danger btn-small it-del">Excluir</button></div>';
      }).join("") + '</div>';
    }).join("");
    document.querySelectorAll(".item-row").forEach(function (row) {
      var id = row.dataset.id, cat = row.dataset.cat;
      var items = byCat[cat];
      var idx = items.findIndex(function (i) { return i.id === id; });
      var up = row.querySelector(".it-up"); if (up) up.addEventListener("click", function () { moveItem(items, idx, -1); });
      var down = row.querySelector(".it-down"); if (down) down.addEventListener("click", function () { moveItem(items, idx, 1); });
      row.querySelector(".it-edit").addEventListener("click", function () { openItemModal(r.menu.find(function (m) { return m.id === id; })); });
      row.querySelector(".it-del").addEventListener("click", async function () {
        if (!confirm("Excluir este item?")) return;
        try { await api("/api/menu/" + id, { method: "DELETE" }); renderMenuByCategory(); loadStaffMenu(); loadPublicMenuAndConfig(); } catch (e) { showToast(e.message); }
      });
    });
    var cats2 = Array.from(new Set(r.menu.map(function (m) { return m.category; })));
    document.getElementById("cat-list").innerHTML = cats2.map(function (c) { return '<option value="' + escapeHtml(c) + '">'; }).join("");
  }
  async function moveCategory(cats, idx, dir) {
    var newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= cats.length) return;
    var arr = cats.slice();
    var tmp = arr[idx]; arr[idx] = arr[newIdx]; arr[newIdx] = tmp;
    try { await api("/api/config", { method: "PUT", body: { categoryOrder: arr } }); renderMenuByCategory(); loadPublicMenuAndConfig(); } catch (e) { showToast(e.message); }
  }
  async function moveItem(items, idx, dir) {
    var newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= items.length) return;
    var arr = items.map(function (i) { return i.id; });
    var tmp = arr[idx]; arr[idx] = arr[newIdx]; arr[newIdx] = tmp;
    try { await api("/api/menu/reorder", { method: "PUT", body: { ids: arr } }); renderMenuByCategory(); loadPublicMenuAndConfig(); } catch (e) { showToast(e.message); }
  }

  // ---- modal de item (novo/editar) ----
  var itemModalEditingId = null;
  var itemModalImage = "";
  var itemModalAddons = [];
  document.getElementById("btn-open-new-item").addEventListener("click", function () { openItemModal(null); });
  function openItemModal(item) {
    itemModalEditingId = item ? item.id : null;
    itemModalImage = item ? (item.image || "") : "";
    itemModalAddons = item && item.addons ? item.addons.map(function (a) { return Object.assign({}, a); }) : [];
    document.getElementById("item-modal-title").textContent = item ? "Editar item" : "Novo item";
    document.getElementById("im-name").value = item ? item.name : "";
    document.getElementById("im-category").value = item ? item.category : "";
    document.getElementById("im-price").value = item ? item.price : "";
    document.getElementById("im-image-preview").style.backgroundImage = itemModalImage ? "url(" + JSON.stringify(itemModalImage) + ")" : "";
    document.getElementById("im-stock-enabled").checked = !!(item && item.stock && item.stock.enabled);
    document.getElementById("im-stock-qty").value = item && item.stock ? item.stock.quantity : 0;
    document.getElementById("im-stock-qty-box").style.display = item && item.stock && item.stock.enabled ? "block" : "none";
    renderAddonsEditor();
    document.getElementById("item-modal").classList.add("show");
  }
  document.getElementById("im-stock-enabled").addEventListener("change", function () { document.getElementById("im-stock-qty-box").style.display = this.checked ? "block" : "none"; });
  document.getElementById("im-image-input").addEventListener("change", async function () {
    if (!this.files[0]) return;
    itemModalImage = await fileToResizedDataUrl(this.files[0], true, 480);
    document.getElementById("im-image-preview").style.backgroundImage = "url(" + JSON.stringify(itemModalImage) + ")";
  });
  function renderAddonsEditor() {
    document.getElementById("im-addons-list").innerHTML = itemModalAddons.map(function (a, idx) {
      return '<div class="addon-mini-row" data-idx="' + idx + '"><input type="text" class="ad-name" placeholder="Ex: Catupiry" value="' + escapeHtml(a.name) + '">' +
        '<input type="number" step="0.01" min="0" class="ad-price" placeholder="Preço" value="' + a.price + '"><button type="button" class="ad-remove">remover</button></div>';
    }).join("");
    document.querySelectorAll("#im-addons-list .addon-mini-row").forEach(function (row) {
      var idx = parseInt(row.dataset.idx, 10);
      row.querySelector(".ad-name").addEventListener("input", function () { itemModalAddons[idx].name = this.value; });
      row.querySelector(".ad-price").addEventListener("input", function () { itemModalAddons[idx].price = parseFloat(this.value) || 0; });
      row.querySelector(".ad-remove").addEventListener("click", function () { itemModalAddons.splice(idx, 1); renderAddonsEditor(); });
    });
  }
  document.getElementById("im-add-addon").addEventListener("click", function () { itemModalAddons.push({ id: uidLocal(), name: "", price: 0 }); renderAddonsEditor(); });
  document.getElementById("im-cancel").addEventListener("click", function () { document.getElementById("item-modal").classList.remove("show"); });
  document.getElementById("im-save").addEventListener("click", async function () {
    var name = document.getElementById("im-name").value.trim();
    var category = document.getElementById("im-category").value.trim() || "Outros";
    var price = parseFloat(document.getElementById("im-price").value);
    if (!name || isNaN(price) || price < 0) { showToast("Preencha nome e preço válidos."); return; }
    var stockEnabled = document.getElementById("im-stock-enabled").checked;
    var stockQty = parseInt(document.getElementById("im-stock-qty").value, 10) || 0;
    var addons = itemModalAddons.filter(function (a) { return a.name.trim(); });
    var payload = { name: name, category: category, price: price, image: itemModalImage, addons: addons, stock: { enabled: stockEnabled, quantity: stockQty } };
    try {
      if (itemModalEditingId) await api("/api/menu/" + itemModalEditingId, { method: "PUT", body: payload });
      else await api("/api/menu", { method: "POST", body: payload });
      document.getElementById("item-modal").classList.remove("show");
      renderMenuByCategory(); loadStaffMenu(); loadPublicMenuAndConfig();
      showToast("Item salvo.");
    } catch (e) { showToast(e.message); }
  });

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
      return '<tr><td>#' + String(o.number).padStart(3, "0") + '</td><td>' + fmtDateTime(o.finalizedAt) + '</td><td>' + escapeHtml(o.customerName || "—") + '</td>' +
        '<td>' + typeLabel(o.type) + '</td><td>' + escapeHtml(lineItemsText(o)) + '</td><td>' + fmtMoney(o.total) + '</td></tr>';
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
    staffConfigCache = r.config;
    document.getElementById("cfg-whatsapp").value = r.config.whatsapp || "";
    document.getElementById("cfg-pix-name").value = r.config.pixName || "";
    document.getElementById("cfg-pix-key").value = r.config.pixKey || "";
    document.getElementById("cfg-online-toggle").checked = !!r.config.onlinePaymentEnabled;
    document.getElementById("cfg-accent").value = r.config.accentColor || "#B9862F";
    document.getElementById("cfg-accent-picker").value = r.config.accentColor || "#B9862F";
    document.getElementById("cfg-accent-preview").style.background = r.config.accentColor || "#B9862F";
    document.getElementById("cfg-cover-preview").style.backgroundImage = r.config.coverImage ? "url(" + JSON.stringify(r.config.coverImage) + ")" : "";
    document.getElementById("cfg-logo-preview").style.backgroundImage = r.config.logoImage ? "url(" + JSON.stringify(r.config.logoImage) + ")" : "";
    renderDeliveryZones(r.config.deliveryZones || []);
  }
  document.getElementById("cfg-accent").addEventListener("input", function () {
    if (/^#[0-9a-fA-F]{6}$/.test(this.value)) { document.getElementById("cfg-accent-preview").style.background = this.value; document.getElementById("cfg-accent-picker").value = this.value; applyAccentColor(this.value); }
  });
  document.getElementById("cfg-accent-picker").addEventListener("input", function () {
    document.getElementById("cfg-accent").value = this.value; document.getElementById("cfg-accent-preview").style.background = this.value; applyAccentColor(this.value);
  });
  document.getElementById("cfg-cover-input").addEventListener("change", async function () {
    if (!this.files[0]) return;
    var dataUrl = await fileToResizedDataUrl(this.files[0], false, 1000);
    document.getElementById("cfg-cover-preview").style.backgroundImage = "url(" + JSON.stringify(dataUrl) + ")";
    document.getElementById("cfg-cover-preview").dataset.value = dataUrl;
  });
  document.getElementById("cfg-logo-input").addEventListener("change", async function () {
    if (!this.files[0]) return;
    var dataUrl = await fileToResizedDataUrl(this.files[0], true, 400);
    document.getElementById("cfg-logo-preview").style.backgroundImage = "url(" + JSON.stringify(dataUrl) + ")";
    document.getElementById("cfg-logo-preview").dataset.value = dataUrl;
  });
  function renderDeliveryZones(zones) {
    var wrap = document.getElementById("delivery-zones-list");
    wrap.innerHTML = zones.length ? zones.map(function (z, idx) {
      return '<div class="reorder-row" data-idx="' + idx + '"><span class="lbl">' + escapeHtml(z.name) + ' — ' + fmtMoney(z.fee) + '</span><button type="button" class="btn btn-danger btn-small zone-del">Remover</button></div>';
    }).join("") : '<div class="empty-hint">Nenhum bairro cadastrado ainda.</div>';
    wrap.querySelectorAll(".zone-del").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var idx = parseInt(btn.closest(".reorder-row").dataset.idx, 10);
        var newZones = zones.slice(); newZones.splice(idx, 1);
        try { await api("/api/config", { method: "PUT", body: { deliveryZones: newZones } }); loadConfigForm(); loadPublicMenuAndConfig(); } catch (e) { showToast(e.message); }
      });
    });
  }
  document.getElementById("btn-add-zone").addEventListener("click", async function () {
    var name = document.getElementById("new-zone-name").value.trim();
    var fee = parseFloat(document.getElementById("new-zone-fee").value);
    if (!name || isNaN(fee) || fee < 0) { showToast("Preencha bairro e taxa válidos."); return; }
    var zones = (staffConfigCache.deliveryZones || []).concat([{ name: name, fee: fee }]);
    try {
      await api("/api/config", { method: "PUT", body: { deliveryZones: zones } });
      document.getElementById("new-zone-name").value = ""; document.getElementById("new-zone-fee").value = "";
      loadConfigForm(); loadPublicMenuAndConfig();
    } catch (e) { showToast(e.message); }
  });
  document.getElementById("btn-save-config").addEventListener("click", async function () {
    try {
      var body = {
        whatsapp: document.getElementById("cfg-whatsapp").value,
        pixName: document.getElementById("cfg-pix-name").value.trim(),
        pixKey: document.getElementById("cfg-pix-key").value.trim(),
        onlinePaymentEnabled: document.getElementById("cfg-online-toggle").checked,
        accentColor: document.getElementById("cfg-accent").value
      };
      var coverVal = document.getElementById("cfg-cover-preview").dataset.value;
      if (coverVal) body.coverImage = coverVal;
      var logoVal = document.getElementById("cfg-logo-preview").dataset.value;
      if (logoVal) body.logoImage = logoVal;
      var r = await api("/api/config", { method: "PUT", body: body });
      staffConfigCache = r.config;
      applyAccentColor(r.config.accentColor);
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
