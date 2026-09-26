(function () {
  "use strict";
  var API = "";
  var token = null;
  var me = null;
  try { token = localStorage.getItem("brothers_token"); } catch (e) {}

  var publicMenuCache = [];
  var publicConfigCache = null;
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
  // dataURLs de imagem não têm aspas simples, então é seguro embutir em style="...url('...')"
  // sem passar por JSON.stringify (que usaria aspas DUPLAS e quebraria o atributo HTML).
  function bgImgStyle(dataUrl) { return dataUrl ? "background-image:url('" + dataUrl + "')" : ""; }

  // ===================== cor de destaque =====================
  function hexToRgb(hex) { var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 59, g: 18, b: 18 }; }
  function rgbToHex(r, g, b) { return "#" + [r, g, b].map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"); }).join(""); }
  function darken(hex, amt) { var c = hexToRgb(hex); return rgbToHex(c.r * (1 - amt), c.g * (1 - amt), c.b * (1 - amt)); }
  function luminance(hex) { var c = hexToRgb(hex); var a = [c.r, c.g, c.b].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
  function applyAccentColor(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || "")) hex = "#B9862F";
    document.documentElement.style.setProperty("--wine", hex);
    document.documentElement.style.setProperty("--wine-dark", darken(hex, 0.3));
    document.documentElement.style.setProperty("--accent-text", luminance(hex) > 0.45 ? "#221600" : "#FFFFFF");
  }

  // ===================== imagem: recorte 1:1 + redimensionamento =====================
  function fileToResizedDataUrl(file, square, maxDim) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var sw = img.width, sh = img.height, sx = 0, sy = 0;
          if (square) { var side = Math.min(sw, sh); sx = (sw - side) / 2; sy = (sh - side) / 2; sw = side; sh = side; }
          var outW = Math.min(maxDim, sw);
          var scale = outW / sw;
          var outH = square ? outW : Math.round(sh * scale);
          var canvas = document.createElement("canvas");
          canvas.width = outW; canvas.height = outH;
          canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () { resolve(reader.result); };
      reader.readAsDataURL(file);
    });
  }

  // ===================== seletor de imagem (biblioteca / upload) + corte 1:1 =====================
  var pickerCallback = null;
  function openImagePicker(onSelected) {
    pickerCallback = onSelected;
    document.getElementById("picker-modal").classList.add("show");
    loadImageLibraryGrid();
  }
  async function loadImageLibraryGrid() {
    var grid = document.getElementById("picker-library-grid");
    grid.innerHTML = '<div class="empty-hint">Carregando…</div>';
    try {
      var r = await api("/api/image-library");
      grid.innerHTML = r.images.length ? r.images.map(function (im) {
        return '<div class="pick-thumb" data-id="' + im.id + '" style="' + bgImgStyle(im.image) + '" title="' + escapeHtml(im.name) + '"></div>';
      }).join("") : '<div class="empty-hint">Nenhuma imagem enviada ainda.</div>';
      grid.querySelectorAll(".pick-thumb").forEach(function (th, idx) {
        th.addEventListener("click", function () {
          document.getElementById("picker-modal").classList.remove("show");
          if (pickerCallback) pickerCallback(r.images[idx].image);
        });
      });
    } catch (e) { grid.innerHTML = '<div class="empty-hint">Não foi possível carregar a biblioteca.</div>'; }
  }
  document.getElementById("picker-close").addEventListener("click", function () { document.getElementById("picker-modal").classList.remove("show"); });
  document.getElementById("picker-upload-input").addEventListener("change", async function () {
    if (!this.files[0]) return;
    var rawDataUrl = await fileToDataUrl(this.files[0]);
    this.value = "";
    document.getElementById("picker-modal").classList.remove("show");
    openCropModal(rawDataUrl);
  });

  var cropImg = null, cropNaturalW = 0, cropNaturalH = 0, cropBaseScale = 1, cropZoom = 1, cropTX = 0, cropTY = 0;
  var CROP_VIEWPORT = 280, CROP_OUTPUT = 480;
  function openCropModal(rawDataUrl) {
    var imgEl = document.getElementById("crop-img");
    imgEl.src = rawDataUrl;
    imgEl.onload = function () {
      cropNaturalW = imgEl.naturalWidth; cropNaturalH = imgEl.naturalHeight;
      cropBaseScale = CROP_VIEWPORT / Math.min(cropNaturalW, cropNaturalH);
      cropZoom = 1;
      document.getElementById("crop-zoom").value = 1;
      centerCropTransform();
      applyCropTransform();
      document.getElementById("crop-modal").classList.add("show");
    };
  }
  function centerCropTransform() {
    var eff = cropBaseScale * cropZoom;
    var dw = cropNaturalW * eff, dh = cropNaturalH * eff;
    cropTX = (CROP_VIEWPORT - dw) / 2; cropTY = (CROP_VIEWPORT - dh) / 2;
  }
  function clampCropTranslate() {
    var eff = cropBaseScale * cropZoom;
    var dw = cropNaturalW * eff, dh = cropNaturalH * eff;
    cropTX = Math.min(0, Math.max(CROP_VIEWPORT - dw, cropTX));
    cropTY = Math.min(0, Math.max(CROP_VIEWPORT - dh, cropTY));
  }
  function applyCropTransform() {
    var eff = cropBaseScale * cropZoom;
    var imgEl = document.getElementById("crop-img");
    imgEl.style.width = (cropNaturalW * eff) + "px";
    imgEl.style.height = (cropNaturalH * eff) + "px";
    imgEl.style.transform = "translate(" + cropTX + "px," + cropTY + "px)";
  }
  var cropDragging = false, cropStartX = 0, cropStartY = 0, cropStartTX = 0, cropStartTY = 0;
  var cropViewportEl = document.getElementById("crop-viewport");
  cropViewportEl.addEventListener("pointerdown", function (e) {
    cropDragging = true; cropStartX = e.clientX; cropStartY = e.clientY; cropStartTX = cropTX; cropStartTY = cropTY;
    try { cropViewportEl.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cropViewportEl.addEventListener("pointermove", function (e) {
    if (!cropDragging) return;
    cropTX = cropStartTX + (e.clientX - cropStartX);
    cropTY = cropStartTY + (e.clientY - cropStartY);
    clampCropTranslate(); applyCropTransform();
  });
  cropViewportEl.addEventListener("pointerup", function () { cropDragging = false; });
  cropViewportEl.addEventListener("pointercancel", function () { cropDragging = false; });
  document.getElementById("crop-zoom").addEventListener("input", function () {
    cropZoom = parseFloat(this.value) || 1;
    clampCropTranslate(); applyCropTransform();
  });
  document.getElementById("crop-cancel").addEventListener("click", function () { document.getElementById("crop-modal").classList.remove("show"); });
  async function finishCrop(dataUrl) {
    document.getElementById("crop-modal").classList.remove("show");
    document.getElementById("picker-modal").classList.remove("show");
    try { await api("/api/image-library", { method: "POST", body: { image: dataUrl, name: "imagem" } }); } catch (e) {}
    if (pickerCallback) pickerCallback(dataUrl);
  }
  document.getElementById("crop-confirm").addEventListener("click", function () {
    var imgEl = document.getElementById("crop-img");
    var eff = cropBaseScale * cropZoom;
    var sx = (0 - cropTX) / eff, sy = (0 - cropTY) / eff, sSide = CROP_VIEWPORT / eff;
    var canvas = document.createElement("canvas"); canvas.width = CROP_OUTPUT; canvas.height = CROP_OUTPUT;
    canvas.getContext("2d").drawImage(imgEl, sx, sy, sSide, sSide, 0, 0, CROP_OUTPUT, CROP_OUTPUT);
    finishCrop(canvas.toDataURL("image/jpeg", 0.85));
  });
  document.getElementById("crop-auto").addEventListener("click", function () {
    var imgEl = document.getElementById("crop-img");
    var side = Math.min(cropNaturalW, cropNaturalH);
    var sx = (cropNaturalW - side) / 2, sy = (cropNaturalH - side) / 2;
    var canvas = document.createElement("canvas"); canvas.width = CROP_OUTPUT; canvas.height = CROP_OUTPUT;
    canvas.getContext("2d").drawImage(imgEl, sx, sy, side, side, 0, 0, CROP_OUTPUT, CROP_OUTPUT);
    finishCrop(canvas.toDataURL("image/jpeg", 0.85));
  });

  // ===================== som de notificação =====================
  function beep() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.4);
      setTimeout(function () {
        var o2 = ctx.createOscillator(), g2 = ctx.createGain();
        o2.type = "sine"; o2.frequency.value = 1180;
        g2.gain.setValueAtTime(0.0001, ctx.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
        g2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
        o2.connect(g2); g2.connect(ctx.destination);
        o2.start(); o2.stop(ctx.currentTime + 0.35);
      }, 160);
    } catch (e) {}
  }
  function playNotificationSound() {
    if (staffConfigCache && staffConfigCache.notificationSound) {
      var audio = new Audio(staffConfigCache.notificationSound);
      audio.play().catch(function () { beep(); });
    } else beep();
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
    if (token) {
      try { var r = await api("/api/auth/me"); me = r.user; await enterStaff(); return; }
      catch (e) { token = null; try { localStorage.removeItem("brothers_token"); } catch (e2) {} }
    }
    var qs = new URLSearchParams(location.search);
    var wantsStaff = qs.get("staff");
    if (wantsStaff && publicConfigCache && wantsStaff === publicConfigCache.staffSlug) { showScreen("login"); }
    else showScreen("public");
  }

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
    applyAccentColor(publicConfigCache ? publicConfigCache.accentColor : "#B9862F");
    history.replaceState(null, "", location.pathname);
    showScreen("public");
  }

  async function enterStaff() {
    showScreen("staff");
    document.getElementById("who-label").textContent = me.name + " (" + (me.role === "admin" ? "admin" : "garçom") + ")";
    buildStaffTabs();
    staffConfigCache = (await api("/api/config")).config;
    applyAccentColor(staffConfigCache.accentColor);
    await Promise.all([loadStaffMenu(), renderPedidosBoard()]);
    if (me.role === "admin") { await loadConfigForm(); await renderUsersTable(); }
    resetStaffOrder();
    switchStaffView("pedidos");
    connectEvents();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      var active = document.querySelector("#staff-screen .view.active");
      if (active && active.id === "view-pedidos") renderPedidosBoard();
    }, 15000);
  }

  function connectEvents() {
    if (evtSource) evtSource.close();
    evtSource = new EventSource(API + "/api/events?token=" + encodeURIComponent(token));
    evtSource.addEventListener("orders_changed", function (e) {
      var active = document.querySelector("#staff-screen .view.active");
      if (active && active.id === "view-pedidos") renderPedidosBoard();
      try {
        var data = JSON.parse(e.data);
        if (data.reason === "novo_pedido") playNotificationSound();
      } catch (err) {}
    });
    evtSource.addEventListener("menu_changed", function () {
      loadStaffMenu();
      var active = document.querySelector("#staff-screen .view.active");
      if (active && active.id === "view-cardapio") renderMenuByCategory();
    });
    evtSource.addEventListener("whatsapp_status", function (e) {
      if (me.role !== "admin") return;
      try { renderWaStatus(JSON.parse(e.data)); } catch (err) {}
    });
    evtSource.addEventListener("whatsapp_message", function () {
      var active = document.querySelector("#staff-screen .view.active");
      if (active && active.id === "view-whatsapp") refreshWaMessages();
    });
    evtSource.onerror = function () {};
  }

  var ALL_TABS = [
    { id: "pedidos", label: "Pedidos", roles: ["admin", "garcom"] },
    { id: "novo", label: "Novo Pedido", roles: ["admin", "garcom"] },
    { id: "cardapio", label: "Cardápio", roles: ["admin", "garcom"] },
    { id: "historico", label: "Histórico", roles: ["admin", "garcom"] },
    { id: "relatorios", label: "Relatórios", roles: ["admin"] },
    { id: "whatsapp", label: "WhatsApp", roles: ["admin"] },
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
    if (id === "whatsapp") loadWhatsAppView();
    if (id === "config") { loadConfigForm(); renderUsersTable(); }
  }

  // isStaff=true (admin/garçom): mostra quantidade em estoque. Cliente nunca vê números de estoque,
  // só se o item está disponível ou não.
  function stockLabel(item, isStaff) {
    if (!isStaff) return item.unavailable ? "Indisponível" : "";
    if (!item.stock || !item.stock.enabled) return "";
    if (item.stock.quantity <= 0) return "Esgotado";
    if (item.stock.quantity <= 3) return "Só " + item.stock.quantity + " disponível(is)";
    return item.stock.quantity + " disponíveis";
  }
  function menuPickerHtml(menu, disabledCats, isStaff) {
    disabledCats = disabledCats || [];
    if (menu.length === 0) return '<div class="empty-hint">Nenhum item cadastrado ainda.</div>';
    var cats = {};
    menu.forEach(function (it) { var c = it.category || "Outros"; if (!cats[c]) cats[c] = []; cats[c].push(it); });
    var html = "";
    Object.keys(cats).forEach(function (cat) {
      var catOff = disabledCats.indexOf(cat) !== -1;
      html += '<div class="cat-block"><h3>' + escapeHtml(cat) + (catOff ? " (desativada)" : "") + '</h3><div class="menu-grid">';
      cats[cat].forEach(function (it) {
        var soldOut = isStaff ? (it.stock && it.stock.enabled && it.stock.quantity <= 0) : it.unavailable;
        var out = soldOut || it.active === false || catOff;
        var lbl = it.active === false ? "Indisponível" : catOff ? "" : stockLabel(it, isStaff);
        html += '<button type="button" class="menu-item-btn' + (out ? ' out' : '') + '" data-id="' + it.id + '" ' + (out ? 'disabled' : '') + '>' +
          '<span class="thumb" style="' + bgImgStyle(it.image) + '"></span>' +
          '<span class="txt"><span class="nm">' + escapeHtml(it.name) + '</span><span class="pr">' + fmtMoney(it.price) + '</span>' +
          (lbl ? '<span class="stockflag' + (isStaff && it.stock && it.stock.quantity <= 3 ? ' low' : '') + '">' + lbl + '</span>' : '') + '</span></button>';
      });
      html += '</div></div>';
    });
    return html;
  }

  // ===================== modal de detalhe do item (abrir e adicionar ao carrinho) =====================
  var detailCurrentItem = null;
  var detailQty = 1;
  var detailAddCallback = null;
  function openItemDetail(item, addCallback) {
    detailCurrentItem = item; detailQty = 1; detailAddCallback = addCallback;
    document.getElementById("detail-img").style.cssText = bgImgStyle(item.image);
    document.getElementById("detail-name").textContent = item.name;
    document.getElementById("detail-desc").textContent = item.description || "";
    document.getElementById("detail-desc").style.display = item.description ? "block" : "none";
    document.getElementById("detail-price").textContent = fmtMoney(item.price);
    document.getElementById("detail-qty").textContent = "1";
    var groups = item.addonGroups || [];
    document.getElementById("detail-groups").innerHTML = groups.map(function (g, gi) {
      return '<div class="addon-pick-group" data-gid="' + g.id + '" data-type="' + g.type + '"><div class="grp-name">' + escapeHtml(g.name) + (g.type === "single" ? " (escolha 1)" : " (opcional)") + '</div>' +
        g.options.map(function (o, oi) {
          var inputType = g.type === "single" ? "radio" : "checkbox";
          var checked = g.type === "single" && oi === 0 ? "checked" : "";
          return '<div class="addon-pick-row"><input type="' + inputType + '" name="grp-' + g.id + '" data-price="' + o.price + '" id="opt-' + o.id + '" value="' + o.id + '" ' + checked + '>' +
            '<label for="opt-' + o.id + '">' + escapeHtml(o.name) + (o.price > 0 ? ' (+' + fmtMoney(o.price) + ')' : '') + '</label></div>';
        }).join("") + '</div>';
    }).join("");
    document.querySelectorAll("#detail-groups input").forEach(function (inp) { inp.addEventListener("change", updateDetailTotal); });
    updateDetailTotal();
    document.getElementById("detail-modal").classList.add("show");
  }
  function updateDetailTotal() {
    var addonsTotal = 0;
    document.querySelectorAll("#detail-groups input:checked").forEach(function (inp) { addonsTotal += parseFloat(inp.dataset.price) || 0; });
    var total = (detailCurrentItem.price + addonsTotal) * detailQty;
    document.getElementById("detail-add").textContent = "Adicionar — " + fmtMoney(total);
  }
  document.getElementById("detail-qplus").addEventListener("click", function () { detailQty++; document.getElementById("detail-qty").textContent = detailQty; updateDetailTotal(); });
  document.getElementById("detail-qminus").addEventListener("click", function () { if (detailQty > 1) detailQty--; document.getElementById("detail-qty").textContent = detailQty; updateDetailTotal(); });
  document.getElementById("detail-close").addEventListener("click", function () { document.getElementById("detail-modal").classList.remove("show"); });
  document.getElementById("detail-add").addEventListener("click", function () {
    var chosen = [];
    document.querySelectorAll("#detail-groups input:checked").forEach(function (inp) {
      var opt = null;
      (detailCurrentItem.addonGroups || []).forEach(function (g) { g.options.forEach(function (o) { if (o.id === inp.value) opt = o; }); });
      if (opt) chosen.push(opt);
    });
    if (detailAddCallback) detailAddCallback(detailCurrentItem, detailQty, chosen);
    document.getElementById("detail-modal").classList.remove("show");
  });

  // ===================== CARRINHO PÚBLICO =====================
  var pubCart = { lines: [] };
  var pubCheckout = { type: "local", pay: "dinheiro" };

  async function loadPublicMenuAndConfig() {
    try {
      var c = await api("/api/public/config"); publicConfigCache = c.config;
      var m = await api("/api/public/menu"); publicMenuCache = m.menu;
    } catch (e) { showToast("Não foi possível carregar o cardápio."); return; }
    applyAccentColor(publicConfigCache.accentColor);
    document.getElementById("pub-cover").style.cssText = bgImgStyle(publicConfigCache.coverImage);
    document.getElementById("pub-avatar").style.cssText = bgImgStyle(publicConfigCache.logoImage);
    var banner = document.getElementById("closed-banner");
    if (!publicConfigCache.status.open) {
      banner.style.display = "block";
      banner.textContent = publicConfigCache.status.reason === "fechado_emergencia" ? "Estamos temporariamente fechados. Volte em breve!" : "Estamos fechados no momento. Confira nosso horário de funcionamento.";
    } else banner.style.display = "none";
    document.getElementById("pub-menu-picker").innerHTML = menuPickerHtml(publicMenuCache, [], false);
    document.querySelectorAll("#pub-menu-picker .menu-item-btn").forEach(function (btn) {
      if (!btn.disabled) btn.addEventListener("click", function () {
        if (!publicConfigCache.status.open) { showToast("O restaurante está fechado no momento."); return; }
        var item = publicMenuCache.find(function (m) { return m.id === btn.dataset.id; });
        openItemDetail(item, addToPublicCart);
      });
    });
    document.getElementById("pub-pay-online-btn").style.display = publicConfigCache.onlinePaymentEnabled ? "inline-block" : "none";
    var sel = document.getElementById("pub-addr-neighborhood");
    sel.innerHTML = '<option value="">Selecione...</option>' + publicConfigCache.deliveryZones.map(function (z) { return '<option value="' + escapeHtml(z.name) + '" data-fee="' + z.fee + '">' + escapeHtml(z.name) + ' — ' + fmtMoney(z.fee) + '</option>'; }).join("");
  }
  function addToPublicCart(item, qty, addons) {
    var addonsTotal = addons.reduce(function (s, a) { return s + a.price; }, 0);
    pubCart.lines.push({ lineId: uidLocal(), menuId: item.id, name: item.name, price: item.price + addonsTotal, qty: qty, addonIds: addons.map(function (a) { return a.id; }), addonsLabel: addons.map(function (a) { return a.name; }).join(", ") });
    renderCartBar();
    showToast(item.name + " adicionado ao pedido.");
  }
  function renderCartBar() {
    var bar = document.getElementById("cart-bar");
    var count = pubCart.lines.reduce(function (s, l) { return s + l.qty; }, 0);
    if (count === 0) { bar.style.display = "none"; return; }
    bar.style.display = "flex";
    document.getElementById("cart-bar-count").textContent = count;
    var total = pubCart.lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    document.getElementById("cart-bar-total").textContent = fmtMoney(total);
  }
  document.getElementById("cart-bar").addEventListener("click", openCheckout);
  function openCheckout() {
    if (pubCart.lines.length === 0) return;
    renderCheckoutLines();
    document.getElementById("checkout-modal").classList.add("show");
  }
  document.getElementById("checkout-close").addEventListener("click", function () { document.getElementById("checkout-modal").classList.remove("show"); });
  function renderCheckoutLines() {
    var wrap = document.getElementById("checkout-lines");
    wrap.innerHTML = pubCart.lines.map(function (l, idx) {
      return '<div class="order-line" data-idx="' + idx + '"><div class="row1"><span class="nm">' + escapeHtml(l.name) + (l.addonsLabel ? '<span class="addons-note"><br>+ ' + escapeHtml(l.addonsLabel) + '</span>' : '') + '</span>' +
        '<span class="qty-ctrl"><button type="button" class="qminus">−</button><span>' + l.qty + '</span><button type="button" class="qplus">+</button></span>' +
        '<span class="lp">' + fmtMoney(l.price * l.qty) + '</span><span class="rm">remover</span></div></div>';
    }).join("");
    wrap.querySelectorAll(".order-line").forEach(function (row) {
      var idx = parseInt(row.dataset.idx, 10);
      row.querySelector(".qplus").addEventListener("click", function () { pubCart.lines[idx].qty++; renderCheckoutLines(); renderCartBar(); });
      row.querySelector(".qminus").addEventListener("click", function () { pubCart.lines[idx].qty--; if (pubCart.lines[idx].qty <= 0) pubCart.lines.splice(idx, 1); renderCheckoutLines(); renderCartBar(); if (pubCart.lines.length === 0) document.getElementById("checkout-modal").classList.remove("show"); });
      row.querySelector(".rm").addEventListener("click", function () { pubCart.lines.splice(idx, 1); renderCheckoutLines(); renderCartBar(); if (pubCart.lines.length === 0) document.getElementById("checkout-modal").classList.remove("show"); });
    });
    updateCheckoutTotal();
  }
  function computeDeliveryFee() {
    var sel = document.getElementById("pub-addr-neighborhood");
    var opt = sel.selectedOptions[0];
    return opt && opt.value ? parseFloat(opt.dataset.fee || "0") : 0;
  }
  function updateCheckoutTotal() {
    var itemsTotal = pubCart.lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    var fee = pubCheckout.type === "delivery" ? computeDeliveryFee() : 0;
    document.getElementById("checkout-total").textContent = fmtMoney(itemsTotal + fee);
    document.getElementById("pub-pix-total").textContent = fmtMoney(itemsTotal + fee);
    var feeBox = document.getElementById("pub-delivery-fee-box");
    if (pubCheckout.type === "delivery" && fee > 0) { feeBox.style.display = "block"; feeBox.textContent = "Taxa de entrega: " + fmtMoney(fee); }
    else feeBox.style.display = "none";
  }
  document.querySelectorAll("#pub-type-toggle button").forEach(function (b) {
    b.addEventListener("click", function () {
      pubCheckout.type = b.dataset.type;
      document.querySelectorAll("#pub-type-toggle button").forEach(function (x) { x.classList.remove("sel"); });
      b.classList.add("sel");
      document.getElementById("pub-delivery-box").style.display = pubCheckout.type === "delivery" ? "block" : "none";
      updateCheckoutTotal();
    });
  });
  document.getElementById("pub-addr-neighborhood").addEventListener("change", updateCheckoutTotal);
  document.querySelectorAll("#pub-pay-toggle button").forEach(function (b) {
    b.addEventListener("click", function () {
      pubCheckout.pay = b.dataset.pay;
      document.querySelectorAll("#pub-pay-toggle button").forEach(function (x) { x.classList.remove("sel"); });
      b.classList.add("sel");
      var showPix = pubCheckout.pay === "pix_online";
      document.getElementById("pub-pix-box").style.display = showPix ? "block" : "none";
      if (showPix) document.getElementById("pub-pix-key").textContent = publicConfigCache.pixKey ? publicConfigCache.pixKey + (publicConfigCache.pixName ? " — " + publicConfigCache.pixName : "") : "Chave Pix ainda não configurada.";
    });
  });
  document.getElementById("btn-copy-pix").addEventListener("click", function () {
    var key = publicConfigCache.pixKey || "";
    if (!key) { showToast("Chave Pix não configurada."); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(key).then(function () { showToast("Chave Pix copiada."); });
    else showToast(key);
  });
  function resetPublicCheckout() {
    pubCart = { lines: [] };
    pubCheckout = { type: "local", pay: "dinheiro" };
    document.getElementById("pub-cust-name").value = ""; document.getElementById("pub-cust-phone").value = "";
    document.getElementById("pub-addr-street").value = ""; document.getElementById("pub-addr-number").value = "";
    document.getElementById("pub-addr-neighborhood").value = "";
    document.querySelectorAll("#pub-type-toggle button").forEach(function (b) { b.classList.toggle("sel", b.dataset.type === "local"); });
    document.querySelectorAll("#pub-pay-toggle button").forEach(function (b) { b.classList.toggle("sel", b.dataset.pay === "dinheiro"); });
    document.getElementById("pub-delivery-box").style.display = "none";
    document.getElementById("pub-pix-box").style.display = "none";
    renderCartBar();
  }
  document.getElementById("btn-pub-submit").addEventListener("click", async function () {
    if (pubCart.lines.length === 0) { showToast("Adicione ao menos um item."); return; }
    var name = document.getElementById("pub-cust-name").value.trim();
    var phone = document.getElementById("pub-cust-phone").value.trim();
    if (!name || !phone) { showToast("Preencha seu nome e WhatsApp."); return; }
    var deliveryPayload = null;
    if (pubCheckout.type === "delivery") {
      var street = document.getElementById("pub-addr-street").value.trim();
      var number = document.getElementById("pub-addr-number").value.trim();
      var neighborhood = document.getElementById("pub-addr-neighborhood").value;
      if (!street || !number || !neighborhood) { showToast("Preencha o endereço completo de entrega."); return; }
      deliveryPayload = { street: street, number: number, neighborhood: neighborhood };
    }
    try {
      var r = await api("/api/public/orders", {
        method: "POST",
        body: { customerName: name, customerPhone: phone, type: pubCheckout.type, payment: { method: pubCheckout.pay }, delivery: deliveryPayload, lines: pubCart.lines.map(function (l) { return { menuId: l.menuId, qty: l.qty, addonIds: l.addonIds || [] }; }) }
      });
      var order = r.order;
      var msg = buildWhatsAppOrderText(order);
      var restNumber = digitsOnly(publicConfigCache.whatsapp);
      document.getElementById("checkout-modal").classList.remove("show");
      var box = document.getElementById("pub-confirm-box");
      showToast("Pedido nº " + String(order.number).padStart(3, "0") + " enviado!");
      if (restNumber) window.open("https://wa.me/55" + restNumber + "?text=" + encodeURIComponent(msg), "_blank");
      resetPublicCheckout();
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
    wireSolicCards();
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
    var showDispatch = o.status === "pronto" && o.type === "delivery" && !o.dispatched;
    return '<div class="order-card" data-id="' + o.id + '" data-status="' + o.status + '" data-phone="' + digitsOnly(o.customerPhone) + '"><div class="oc-top"><div><div class="num">#' + String(o.number).padStart(3, "0") + '</div>' +
      '<div class="meta">' + fmtDateTime(o.createdAt) + (o.customerName ? " · " + escapeHtml(o.customerName) : "") + '</div></div><span class="tag">' + typeLabel(o.type) + (o.dispatched ? ' · saiu p/ entrega' : '') + '</span></div>' +
      '<div class="items">' + escapeHtml(lineItemsText(o)) + '</div>' + addressLine(o) + '<div class="foot"><span class="amt">' + fmtMoney(o.total) + '</span></div>' +
      '<div class="actions"><button class="btn btn-primary btn-small adv">' + advLabel + '</button>' +
      (showDispatch ? '<button class="btn btn-ghost btn-small dispatch">🛵 Saiu para entrega</button>' : '') +
      '<button class="btn btn-ghost btn-small edt">Editar</button><button class="btn btn-ghost btn-small prt">Imprimir</button>' +
      (hasPhone ? '<button class="btn btn-ghost btn-small notify">Avisar cliente</button>' : '') +
      '<button class="btn btn-danger btn-small del">Cancelar</button></div></div>';
  }
  function wireOrderCards(allOrders) {
    document.querySelectorAll("#col-producao .order-card, #col-pronto .order-card").forEach(function (card) {
      var id = card.dataset.id;
      var advBtn = card.querySelector(".adv"); if (advBtn) advBtn.addEventListener("click", function () { advanceStatus(id, card.dataset.status); });
      var dispBtn = card.querySelector(".dispatch"); if (dispBtn) dispBtn.addEventListener("click", async function () {
        try { await api("/api/orders/" + id + "/dispatch", { method: "PATCH" }); showToast("Cliente avisado que o pedido saiu para entrega."); renderPedidosBoard(); } catch (e) { showToast(e.message); }
      });
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

  // ===================== WHATSAPP (Baileys) =====================
  async function loadWhatsAppView() {
    await refreshWaStatus();
    await refreshWaMessages();
    document.getElementById("wa-bot-toggle").checked = !!(staffConfigCache && staffConfigCache.whatsappBotEnabled);
  }
  function renderWaStatus(data) {
    var box = document.getElementById("wa-status-box");
    var labels = { conectado: "🟢 Conectado", aguardando_qr: "🟡 Aguardando leitura do QR Code", desconectado: "🔴 Desconectado" };
    box.innerHTML = '<span class="wa-status-pill ' + data.status + '">' + (labels[data.status] || data.status) + '</span>';
    document.getElementById("wa-qr-box").style.display = data.status === "aguardando_qr" && data.qr ? "block" : "none";
    if (data.qr) document.getElementById("wa-qr-img").src = data.qr;
  }
  async function refreshWaStatus() {
    try { var r = await api("/api/whatsapp/status"); renderWaStatus(r); } catch (e) {}
  }
  async function refreshWaMessages() {
    try {
      var r = await api("/api/whatsapp/messages");
      renderWaMessages(r.messages);
    } catch (e) {}
  }
  function renderWaMessages(messages) {
    var wrap = document.getElementById("wa-messages");
    if (!messages.length) { wrap.innerHTML = '<div class="empty-hint">Nenhuma mensagem ainda.</div>'; return; }
    wrap.innerHTML = messages.map(function (m) {
      return '<div class="wa-msg ' + m.direction + '">' + escapeHtml(m.text) + '<div class="meta">' + (m.direction === "in" ? m.phone : "você") + ' · ' + fmtDateTime(m.at) + '</div></div>';
    }).join("");
    wrap.scrollTop = wrap.scrollHeight;
  }
  document.getElementById("btn-wa-logout").addEventListener("click", async function () {
    if (!confirm("Desconectar o WhatsApp? Você vai precisar escanear o QR Code de novo.")) return;
    try { await api("/api/whatsapp/logout", { method: "POST" }); showToast("Desconectado."); refreshWaStatus(); } catch (e) { showToast(e.message); }
  });
  document.getElementById("wa-bot-toggle").addEventListener("change", async function () {
    try { await api("/api/config", { method: "PUT", body: { whatsappBotEnabled: this.checked } }); staffConfigCache.whatsappBotEnabled = this.checked; showToast(this.checked ? "Bot ativado." : "Bot desativado."); } catch (e) { showToast(e.message); }
  });
  document.getElementById("btn-wa-send").addEventListener("click", async function () {
    var phone = document.getElementById("wa-send-phone").value.trim();
    var text = document.getElementById("wa-send-text").value.trim();
    if (!phone || !text) { showToast("Preencha número e mensagem."); return; }
    try {
      await api("/api/whatsapp/send", { method: "POST", body: { phone: phone, text: text } });
      document.getElementById("wa-send-text").value = "";
      refreshWaMessages();
    } catch (e) { showToast(e.message); }
  });

  // ===================== NOVO PEDIDO (balcão) =====================
  var currentOrder = { type: "local", lines: [] };
  var editingOrderId = null;
  async function loadStaffMenu() {
    try { var r = await api("/api/menu"); staffMenuCache = r.menu; } catch (e) { staffMenuCache = []; }
    document.getElementById("menu-picker").innerHTML = menuPickerHtml(staffMenuCache, staffConfigCache ? staffConfigCache.disabledCategories : [], true);
    document.querySelectorAll("#menu-picker .menu-item-btn").forEach(function (btn) {
      if (!btn.disabled) btn.addEventListener("click", function () {
        var item = staffMenuCache.find(function (m) { return m.id === btn.dataset.id; });
        openItemDetail(item, addToStaffOrder);
      });
    });
  }
  document.querySelectorAll("#staff-type-toggle button").forEach(function (b) {
    b.addEventListener("click", function () { currentOrder.type = b.dataset.type; document.querySelectorAll("#staff-type-toggle button").forEach(function (x) { x.classList.remove("sel"); }); b.classList.add("sel"); });
  });
  function addToStaffOrder(item, qty, addons) {
    var addonsTotal = addons.reduce(function (s, a) { return s + a.price; }, 0);
    currentOrder.lines.push({ menuId: item.id, name: item.name, price: item.price + addonsTotal, qty: qty, addonIds: addons.map(function (a) { return a.id; }), addonsLabel: addons.map(function (a) { return a.name; }).join(", ") });
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
    var sub = "Pedido #" + String(order.number).padStart(3, "0") + " — " + typeLabel(order.type) + "<br>" + fmtDateTime(order.createdAt) +
      (order.customerName ? "<br>Cliente: " + escapeHtml(order.customerName) : "") + (order.customerPhone ? "<br>Tel: " + escapeHtml(order.customerPhone) : "");
    document.getElementById("pr-sub").innerHTML = sub;

    var linesHtml = order.lines.map(function (l) {
      var block = '<div class="pline"><span>' + l.qty + 'x ' + escapeHtml(l.name) + '</span><span>' + fmtMoney(l.basePrice != null ? l.basePrice * l.qty : l.price * l.qty) + '</span></div>';
      if (l.addons && l.addons.length) {
        block += l.addons.map(function (a) { return '<div class="pline addon-line"><span>&nbsp;&nbsp;+ ' + escapeHtml(a.name) + '</span><span>' + fmtMoney(a.price * l.qty) + '</span></div>'; }).join("");
      }
      return block;
    }).join("");
    document.getElementById("pr-lines").innerHTML = linesHtml;

    var itemsTotal = order.lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    var extraHtml = "";
    if (order.delivery) extraHtml += '<div class="pline"><span>Taxa de entrega</span><span>' + fmtMoney(order.delivery.fee) + '</span></div>';
    document.getElementById("pr-extra").innerHTML = extraHtml;
    document.getElementById("pr-total").textContent = fmtMoney(order.total);

    var addrBox = document.getElementById("pr-address");
    if (order.delivery) {
      addrBox.style.display = "block";
      addrBox.innerHTML = 'ENTREGAR EM:<br>' + escapeHtml(order.delivery.street) + ', ' + escapeHtml(order.delivery.number) + '<br>Bairro: ' + escapeHtml(order.delivery.neighborhood) +
        '<br><br>Cliente: ' + escapeHtml(order.customerName || "—") + '<br>Tel: ' + escapeHtml(order.customerPhone || "—");
    } else {
      addrBox.style.display = "none"; addrBox.innerHTML = "";
    }
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

  // ===================== CARDÁPIO: categorias, itens, grupos, import/export =====================
  async function renderMenuByCategory() {
    var r; try { r = await api("/api/menu"); } catch (e) { return; }
    staffMenuCache = r.menu;
    var cats = [], byCat = {};
    r.menu.forEach(function (it) { var c = it.category || "Outros"; if (!byCat[c]) { byCat[c] = []; cats.push(c); } byCat[c].push(it); });
    var disabled = staffConfigCache ? (staffConfigCache.disabledCategories || []) : [];

    document.getElementById("cat-order-list").innerHTML = cats.length ? cats.map(function (c, idx) {
      var off = disabled.indexOf(c) !== -1;
      return '<div class="reorder-row" data-cat="' + escapeHtml(c) + '"><span class="drag-handle">⠿</span><span class="lbl">' + escapeHtml(c) + '</span>' +
        '<label class="switch" title="Ativar/desativar categoria"><input type="checkbox" class="cat-toggle" ' + (off ? '' : 'checked') + '><span class="slider"></span></label>' +
        '<span class="arrows"><button type="button" class="cat-up" ' + (idx === 0 ? 'disabled' : '') + '>↑</button><button type="button" class="cat-down" ' + (idx === cats.length - 1 ? 'disabled' : '') + '>↓</button></span></div>';
    }).join("") : '<div class="empty-hint">Adicione itens ao cardápio para organizar as categorias.</div>';
    document.querySelectorAll("#cat-order-list .cat-up").forEach(function (btn, idx) { btn.addEventListener("click", function () { moveCategory(cats, idx, -1); }); });
    document.querySelectorAll("#cat-order-list .cat-down").forEach(function (btn, idx) { btn.addEventListener("click", function () { moveCategory(cats, idx, 1); }); });
    document.querySelectorAll("#cat-order-list .cat-toggle").forEach(function (chk, idx) {
      chk.addEventListener("change", async function () {
        var cat = cats[idx];
        var newDisabled = chk.checked ? disabled.filter(function (c) { return c !== cat; }) : disabled.concat([cat]);
        try { await api("/api/config", { method: "PUT", body: { disabledCategories: newDisabled } }); staffConfigCache.disabledCategories = newDisabled; renderMenuByCategory(); loadPublicMenuAndConfig(); } catch (e) { showToast(e.message); }
      });
    });
    enableDragReorder(document.getElementById("cat-order-list"), ".reorder-row", function (el) { return el.dataset.cat; }, applyCategoryOrder);

    document.getElementById("menu-by-category").innerHTML = cats.map(function (cat) {
      var items = byCat[cat];
      return '<div class="menu-cat-section"><h4>' + escapeHtml(cat) + '</h4><div class="item-list" data-cat="' + escapeHtml(cat) + '">' + items.map(function (it, idx) {
        return '<div class="item-row' + (it.active === false ? ' inactive' : '') + '" data-id="' + it.id + '" data-cat="' + escapeHtml(cat) + '">' +
          '<span class="drag-handle">⠿</span><span class="thumb" style="' + bgImgStyle(it.image) + '"></span>' +
          '<span class="info"><span class="nm">' + escapeHtml(it.name) + '</span><br><span class="meta">' + fmtMoney(it.price) + (it.stock && it.stock.enabled ? ' · estoque: ' + it.stock.quantity : '') + (it.addonGroups && it.addonGroups.length ? ' · ' + it.addonGroups.length + ' grupo(s)' : '') + '</span></span>' +
          '<label class="switch" title="Ativar/desativar item"><input type="checkbox" class="item-toggle" ' + (it.active === false ? '' : 'checked') + '><span class="slider"></span></label>' +
          '<span class="arrows"><button type="button" class="it-up" ' + (idx === 0 ? 'disabled' : '') + '>↑</button><button type="button" class="it-down" ' + (idx === items.length - 1 ? 'disabled' : '') + '>↓</button></span>' +
          '<button class="btn btn-ghost btn-small it-edit">Editar</button><button class="btn btn-danger btn-small it-del">Excluir</button></div>';
      }).join("") + '</div></div>';
    }).join("");
    document.querySelectorAll(".item-row").forEach(function (row) {
      var id = row.dataset.id, cat = row.dataset.cat;
      var items = byCat[cat];
      var idx = items.findIndex(function (i) { return i.id === id; });
      var up = row.querySelector(".it-up"); if (up) up.addEventListener("click", function () { moveItem(items, idx, -1); });
      var down = row.querySelector(".it-down"); if (down) down.addEventListener("click", function () { moveItem(items, idx, 1); });
      row.querySelector(".item-toggle").addEventListener("change", async function () {
        try { await api("/api/menu/" + id, { method: "PUT", body: { active: this.checked } }); renderMenuByCategory(); loadStaffMenu(); loadPublicMenuAndConfig(); } catch (e) { showToast(e.message); }
      });
      row.querySelector(".it-edit").addEventListener("click", function () { openItemModal(r.menu.find(function (m) { return m.id === id; })); });
      row.querySelector(".it-del").addEventListener("click", async function () {
        if (!confirm("Excluir este item?")) return;
        try { await api("/api/menu/" + id, { method: "DELETE" }); renderMenuByCategory(); loadStaffMenu(); loadPublicMenuAndConfig(); } catch (e) { showToast(e.message); }
      });
    });
    document.querySelectorAll(".item-list").forEach(function (list) {
      enableDragReorder(list, ".item-row", function (el) { return el.dataset.id; }, applyItemOrder);
    });
    var cats2 = Array.from(new Set(r.menu.map(function (m) { return m.category; })));
    document.getElementById("cat-list").innerHTML = cats2.map(function (c) { return '<option value="' + escapeHtml(c) + '">'; }).join("");
  }
  // arrasta e solta genérico (mouse + touch via HTML5 drag events)
  function enableDragReorder(container, itemSelector, getKey, onDrop) {
    var draggedEl = null;
    container.querySelectorAll(itemSelector).forEach(function (el) {
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", function () { draggedEl = el; setTimeout(function () { el.classList.add("dragging"); }, 0); });
      el.addEventListener("dragend", function () { el.classList.remove("dragging"); draggedEl = null; });
      el.addEventListener("dragover", function (e) { e.preventDefault(); });
      el.addEventListener("drop", function (e) {
        e.preventDefault();
        if (!draggedEl || draggedEl === el) return;
        var items = Array.from(container.querySelectorAll(itemSelector));
        var fromIdx = items.indexOf(draggedEl), toIdx = items.indexOf(el);
        if (fromIdx < toIdx) el.after(draggedEl); else el.before(draggedEl);
        var newOrder = Array.from(container.querySelectorAll(itemSelector)).map(getKey);
        onDrop(newOrder);
      });
    });
  }
  async function applyCategoryOrder(newOrder) {
    try { await api("/api/config", { method: "PUT", body: { categoryOrder: newOrder } }); renderMenuByCategory(); loadPublicMenuAndConfig(); } catch (e) { showToast(e.message); }
  }
  async function applyItemOrder(ids) {
    try { await api("/api/menu/reorder", { method: "PUT", body: { ids: ids } }); renderMenuByCategory(); loadPublicMenuAndConfig(); } catch (e) { showToast(e.message); }
  }
  async function moveCategory(cats, idx, dir) {
    var newIdx = idx + dir; if (newIdx < 0 || newIdx >= cats.length) return;
    var arr = cats.slice(); var tmp = arr[idx]; arr[idx] = arr[newIdx]; arr[newIdx] = tmp;
    applyCategoryOrder(arr);
  }
  async function moveItem(items, idx, dir) {
    var newIdx = idx + dir; if (newIdx < 0 || newIdx >= items.length) return;
    var arr = items.map(function (i) { return i.id; }); var tmp = arr[idx]; arr[idx] = arr[newIdx]; arr[newIdx] = tmp;
    applyItemOrder(arr);
  }

  // ---- grupos de complementos (Configurações do Cardápio) ----
  function renderAddonGroupsList() {
    var groups = (staffConfigCache && staffConfigCache.addonGroups) || [];
    var wrap = document.getElementById("addon-groups-list");
    wrap.innerHTML = groups.length ? groups.map(function (g) {
      return '<div class="group-card" data-id="' + g.id + '"><div><strong>' + escapeHtml(g.name) + '</strong><div class="meta">' + (g.type === "single" ? "Escolha única" : "Múltipla escolha") + ' · ' + g.options.length + ' opções</div></div>' +
        '<div><button class="btn btn-ghost btn-small g-edit">Editar</button> <button class="btn btn-danger btn-small g-del">Excluir</button></div></div>';
    }).join("") : '<div class="empty-hint">Nenhum grupo cadastrado ainda.</div>';
    wrap.querySelectorAll(".group-card").forEach(function (card) {
      var id = card.dataset.id;
      card.querySelector(".g-edit").addEventListener("click", function () { openGroupModal(groups.find(function (g) { return g.id === id; })); });
      card.querySelector(".g-del").addEventListener("click", async function () {
        if (!confirm("Excluir este grupo? Itens que o usam perderão essa opção de complemento.")) return;
        var newGroups = groups.filter(function (g) { return g.id !== id; });
        try { await api("/api/config", { method: "PUT", body: { addonGroups: newGroups } }); staffConfigCache.addonGroups = newGroups; renderAddonGroupsList(); loadStaffMenu(); loadPublicMenuAndConfig(); } catch (e) { showToast(e.message); }
      });
    });
  }
  var groupModalEditingId = null, groupModalType = "multi", groupModalOptions = [];
  document.getElementById("btn-new-group").addEventListener("click", function () { openGroupModal(null); });
  function openGroupModal(group) {
    groupModalEditingId = group ? group.id : null;
    groupModalType = group ? group.type : "multi";
    groupModalOptions = group ? group.options.map(function (o) { return Object.assign({}, o); }) : [];
    document.getElementById("group-modal-title").textContent = group ? "Editar grupo" : "Novo grupo";
    document.getElementById("gm-name").value = group ? group.name : "";
    document.getElementById("gm-type-multi").classList.toggle("sel", groupModalType === "multi");
    document.getElementById("gm-type-single").classList.toggle("sel", groupModalType === "single");
    renderGroupOptionsEditor();
    document.getElementById("group-modal").classList.add("show");
  }
  document.getElementById("gm-type-multi").addEventListener("click", function () { groupModalType = "multi"; this.classList.add("sel"); document.getElementById("gm-type-single").classList.remove("sel"); });
  document.getElementById("gm-type-single").addEventListener("click", function () { groupModalType = "single"; this.classList.add("sel"); document.getElementById("gm-type-multi").classList.remove("sel"); });
  function renderGroupOptionsEditor() {
    document.getElementById("gm-options-list").innerHTML = groupModalOptions.map(function (o, idx) {
      return '<div class="addon-mini-row" data-idx="' + idx + '"><input type="text" class="op-name" placeholder="Ex: Catupiry" value="' + escapeHtml(o.name) + '">' +
        '<input type="number" step="0.01" min="0" class="op-price" placeholder="Preço" value="' + o.price + '"><button type="button" class="op-remove">remover</button></div>';
    }).join("");
    document.querySelectorAll("#gm-options-list .addon-mini-row").forEach(function (row) {
      var idx = parseInt(row.dataset.idx, 10);
      row.querySelector(".op-name").addEventListener("input", function () { groupModalOptions[idx].name = this.value; });
      row.querySelector(".op-price").addEventListener("input", function () { groupModalOptions[idx].price = parseFloat(this.value) || 0; });
      row.querySelector(".op-remove").addEventListener("click", function () { groupModalOptions.splice(idx, 1); renderGroupOptionsEditor(); });
    });
  }
  document.getElementById("gm-add-option").addEventListener("click", function () { groupModalOptions.push({ id: uidLocal(), name: "", price: 0 }); renderGroupOptionsEditor(); });
  document.getElementById("gm-cancel").addEventListener("click", function () { document.getElementById("group-modal").classList.remove("show"); });
  document.getElementById("gm-save").addEventListener("click", async function () {
    var name = document.getElementById("gm-name").value.trim();
    var options = groupModalOptions.filter(function (o) { return o.name.trim(); });
    if (!name || options.length === 0) { showToast("Dê um nome ao grupo e adicione ao menos 1 opção."); return; }
    var groups = ((staffConfigCache && staffConfigCache.addonGroups) || []).slice();
    var payload = { id: groupModalEditingId || uidLocal(), name: name, type: groupModalType, options: options };
    if (groupModalEditingId) groups = groups.map(function (g) { return g.id === groupModalEditingId ? payload : g; });
    else groups.push(payload);
    try {
      var r = await api("/api/config", { method: "PUT", body: { addonGroups: groups } });
      staffConfigCache.addonGroups = r.config.addonGroups;
      document.getElementById("group-modal").classList.remove("show");
      renderAddonGroupsList(); loadStaffMenu(); loadPublicMenuAndConfig();
      showToast("Grupo salvo.");
    } catch (e) { showToast(e.message); }
  });

  // ---- modal de item (novo/editar) ----
  var itemModalEditingId = null, itemModalImage = "", itemModalGroupIds = [];
  document.getElementById("btn-open-new-item").addEventListener("click", function () { openItemModal(null); });
  function openItemModal(item) {
    itemModalEditingId = item ? item.id : null;
    itemModalImage = item ? (item.image || "") : "";
    itemModalGroupIds = item ? (item.addonGroupIds || []).slice() : [];
    document.getElementById("item-modal-title").textContent = item ? "Editar item" : "Novo item";
    document.getElementById("im-name").value = item ? item.name : "";
    document.getElementById("im-category").value = item ? item.category : "";
    document.getElementById("im-description").value = item ? (item.description || "") : "";
    document.getElementById("im-price").value = item ? item.price : "";
    document.getElementById("im-image-preview").style.cssText = bgImgStyle(itemModalImage);
    document.getElementById("im-active").checked = !item || item.active !== false;
    document.getElementById("im-stock-enabled").checked = !!(item && item.stock && item.stock.enabled);
    document.getElementById("im-stock-qty").value = item && item.stock ? item.stock.quantity : 0;
    document.getElementById("im-stock-qty-box").style.display = item && item.stock && item.stock.enabled ? "block" : "none";
    renderItemGroupsChecklist();
    document.getElementById("item-modal").classList.add("show");
  }
  function renderItemGroupsChecklist() {
    var groups = (staffConfigCache && staffConfigCache.addonGroups) || [];
    var wrap = document.getElementById("im-groups-list");
    wrap.innerHTML = groups.length ? groups.map(function (g) {
      return '<div class="group-check-row"><input type="checkbox" id="imgrp-' + g.id + '" data-id="' + g.id + '" ' + (itemModalGroupIds.indexOf(g.id) !== -1 ? 'checked' : '') + '>' +
        '<label for="imgrp-' + g.id + '">' + escapeHtml(g.name) + ' (' + (g.type === "single" ? "escolha única" : "múltipla") + ')</label></div>';
    }).join("") : '<div class="empty-hint">Nenhum grupo cadastrado. Crie em "Grupos de complementos" acima.</div>';
    wrap.querySelectorAll("input[type=checkbox]").forEach(function (chk) {
      chk.addEventListener("change", function () {
        var gid = this.dataset.id;
        if (this.checked) { if (itemModalGroupIds.indexOf(gid) === -1) itemModalGroupIds.push(gid); }
        else itemModalGroupIds = itemModalGroupIds.filter(function (id) { return id !== gid; });
      });
    });
  }
  document.getElementById("im-stock-enabled").addEventListener("change", function () { document.getElementById("im-stock-qty-box").style.display = this.checked ? "block" : "none"; });
  document.getElementById("btn-pick-item-image").addEventListener("click", function () {
    openImagePicker(function (dataUrl) {
      itemModalImage = dataUrl;
      document.getElementById("im-image-preview").style.cssText = bgImgStyle(itemModalImage);
    });
  });
  document.getElementById("im-cancel").addEventListener("click", function () { document.getElementById("item-modal").classList.remove("show"); });
  document.getElementById("im-save").addEventListener("click", async function () {
    var name = document.getElementById("im-name").value.trim();
    var category = document.getElementById("im-category").value.trim() || "Outros";
    var price = parseFloat(document.getElementById("im-price").value);
    if (!name || isNaN(price) || price < 0) { showToast("Preencha nome e preço válidos."); return; }
    var payload = {
      name: name, category: category, price: price,
      description: document.getElementById("im-description").value.trim(),
      image: itemModalImage, active: document.getElementById("im-active").checked,
      addonGroupIds: itemModalGroupIds,
      stock: { enabled: document.getElementById("im-stock-enabled").checked, quantity: parseInt(document.getElementById("im-stock-qty").value, 10) || 0 }
    };
    try {
      if (itemModalEditingId) await api("/api/menu/" + itemModalEditingId, { method: "PUT", body: payload });
      else await api("/api/menu", { method: "POST", body: payload });
      document.getElementById("item-modal").classList.remove("show");
      renderMenuByCategory(); loadStaffMenu(); loadPublicMenuAndConfig();
      showToast("Item salvo.");
    } catch (e) { showToast(e.message); }
  });

  // ---- exportar / importar CSV ----
  document.getElementById("btn-export-csv").addEventListener("click", function () {
    var url = API + "/api/menu/export";
    fetch(url, { headers: { Authorization: "Bearer " + token } }).then(function (res) { return res.blob(); }).then(function (blob) {
      var link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "cardapio-brothers.csv";
      link.click();
    }).catch(function () { showToast("Erro ao exportar."); });
  });
  document.getElementById("btn-import-csv").addEventListener("change", async function () {
    if (!this.files[0]) return;
    var text = await this.files[0].text();
    try {
      var r = await api("/api/menu/import", { method: "POST", body: { csv: text } });
      showToast(r.created + " criado(s), " + r.updated + " atualizado(s)." + (r.unknownGroups.length ? " Grupos não encontrados: " + r.unknownGroups.join(", ") : ""));
      renderMenuByCategory(); loadStaffMenu(); loadPublicMenuAndConfig();
    } catch (e) { showToast(e.message); }
    this.value = "";
  });

  document.getElementById("btn-export-groups-csv").addEventListener("click", function () {
    fetch(API + "/api/addon-groups/export", { headers: { Authorization: "Bearer " + token } }).then(function (res) { return res.blob(); }).then(function (blob) {
      var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "complementos-brothers.csv"; link.click();
    }).catch(function () { showToast("Erro ao exportar."); });
  });
  document.getElementById("btn-import-groups-csv").addEventListener("change", async function () {
    if (!this.files[0]) return;
    var text = await this.files[0].text();
    try {
      var r = await api("/api/addon-groups/import", { method: "POST", body: { csv: text } });
      showToast(r.created + " grupo(s) criado(s), " + r.updated + " atualizado(s).");
      staffConfigCache = (await api("/api/config")).config;
      renderAddonGroupsList(); renderMenuByCategory(); loadPublicMenuAndConfig();
    } catch (e) { showToast(e.message); }
    this.value = "";
  });

  document.getElementById("btn-download-backup").addEventListener("click", function () {
    fetch(API + "/api/menu/backup", { headers: { Authorization: "Bearer " + token } }).then(function (res) { return res.blob(); }).then(function (blob) {
      var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "backup-brothers.json"; link.click();
    }).catch(function () { showToast("Erro ao gerar backup."); });
  });
  document.getElementById("btn-restore-backup").addEventListener("change", async function () {
    if (!this.files[0]) return;
    if (!confirm("Restaurar esse backup vai substituir todo o cardápio, complementos e imagens atuais. Continuar?")) { this.value = ""; return; }
    try {
      var text = await this.files[0].text();
      var parsed = JSON.parse(text);
      var r = await api("/api/menu/backup/restore", { method: "POST", body: parsed });
      showToast("Backup restaurado — " + r.itemCount + " itens.");
      staffConfigCache = (await api("/api/config")).config;
      renderMenuByCategory(); loadStaffMenu(); loadConfigForm(); loadPublicMenuAndConfig();
    } catch (e) { showToast("Erro ao restaurar: " + e.message); }
    this.value = "";
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
  var WEEKDAY_LABELS = { sun: "Domingo", mon: "Segunda", tue: "Terça", wed: "Quarta", thu: "Quinta", fri: "Sexta", sat: "Sábado" };
  var WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  var pendingSoundDataUrl = null;

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
    document.getElementById("cfg-cover-preview").style.cssText = bgImgStyle(r.config.coverImage);
    document.getElementById("cfg-logo-preview").style.cssText = bgImgStyle(r.config.logoImage);
    document.getElementById("cfg-timezone").value = r.config.timezone || "America/Manaus";
    renderDeliveryZones(r.config.deliveryZones || []);
    renderAddonGroupsList();
    renderHoursForm(r.config.businessHours);
    updateEmergencyBox(r.config.emergencyClosed);
    var soundStatus = document.getElementById("cfg-sound-status");
    if (r.config.notificationSound) { soundStatus.style.display = "block"; soundStatus.textContent = "Som personalizado configurado."; }
    else soundStatus.style.display = "none";
    pendingSoundDataUrl = null;
    var origin = location.origin + location.pathname.replace(/index\.html$/, "");
    document.getElementById("cfg-staff-link").value = origin + "?staff=" + r.config.staffSlug;
  }
  function renderHoursForm(hours) {
    document.getElementById("hours-list").innerHTML = WEEKDAY_ORDER.map(function (d) {
      var h = hours[d] || { closed: false, open: "00:00", close: "23:59" };
      return '<div class="reorder-row" data-day="' + d + '"><span class="lbl">' + WEEKDAY_LABELS[d] + '</span>' +
        '<input type="time" class="h-open" value="' + h.open + '" style="max-width:100px;" ' + (h.closed ? 'disabled' : '') + '>' +
        '<span style="align-self:center;">até</span>' +
        '<input type="time" class="h-close" value="' + h.close + '" style="max-width:100px;" ' + (h.closed ? 'disabled' : '') + '>' +
        '<label class="switch" title="Fechado neste dia"><input type="checkbox" class="h-closed" ' + (h.closed ? 'checked' : '') + '><span class="slider"></span></label></div>';
    }).join("");
    document.querySelectorAll("#hours-list .h-closed").forEach(function (chk) {
      chk.addEventListener("change", function () {
        var row = this.closest(".reorder-row");
        row.querySelector(".h-open").disabled = this.checked;
        row.querySelector(".h-close").disabled = this.checked;
      });
    });
  }
  document.getElementById("btn-save-hours").addEventListener("click", async function () {
    var businessHours = {};
    document.querySelectorAll("#hours-list .reorder-row").forEach(function (row) {
      var day = row.dataset.day;
      businessHours[day] = { closed: row.querySelector(".h-closed").checked, open: row.querySelector(".h-open").value || "00:00", close: row.querySelector(".h-close").value || "23:59" };
    });
    try {
      await api("/api/config", { method: "PUT", body: { businessHours: businessHours, timezone: document.getElementById("cfg-timezone").value } });
      showToast("Horários salvos.");
      loadPublicMenuAndConfig();
    } catch (e) { showToast(e.message); }
  });
  function updateEmergencyBox(closed) {
    var box = document.getElementById("emergency-box");
    box.classList.toggle("active", !closed);
    document.getElementById("emergency-status").textContent = closed ? "Loja fechada manualmente (emergência)" : "Loja funcionando normalmente";
    var btn = document.getElementById("btn-emergency-toggle");
    btn.textContent = closed ? "Reabrir loja" : "Fechar agora";
    btn.className = closed ? "btn btn-primary btn-small" : "btn btn-danger btn-small";
  }
  document.getElementById("btn-emergency-toggle").addEventListener("click", async function () {
    var closed = staffConfigCache.emergencyClosed;
    if (!closed && !confirm("Fechar a loja agora? Os clientes não conseguirão fazer pedidos até você reabrir.")) return;
    try {
      var r = await api("/api/config", { method: "PUT", body: { emergencyClosed: !closed } });
      staffConfigCache.emergencyClosed = r.config.emergencyClosed;
      updateEmergencyBox(r.config.emergencyClosed);
      loadPublicMenuAndConfig();
      showToast(r.config.emergencyClosed ? "Loja fechada." : "Loja reaberta.");
    } catch (e) { showToast(e.message); }
  });
  document.getElementById("cfg-accent").addEventListener("input", function () {
    if (/^#[0-9a-fA-F]{6}$/.test(this.value)) { document.getElementById("cfg-accent-preview").style.background = this.value; document.getElementById("cfg-accent-picker").value = this.value; applyAccentColor(this.value); }
  });
  document.getElementById("cfg-accent-picker").addEventListener("input", function () {
    document.getElementById("cfg-accent").value = this.value; document.getElementById("cfg-accent-preview").style.background = this.value; applyAccentColor(this.value);
  });
  document.getElementById("cfg-cover-input").addEventListener("change", async function () {
    if (!this.files[0]) return;
    var dataUrl = await fileToResizedDataUrl(this.files[0], false, 1000);
    document.getElementById("cfg-cover-preview").style.cssText = bgImgStyle(dataUrl);
    document.getElementById("cfg-cover-preview").dataset.value = dataUrl;
  });
  document.getElementById("btn-pick-logo").addEventListener("click", function () {
    openImagePicker(function (dataUrl) {
      document.getElementById("cfg-logo-preview").style.cssText = bgImgStyle(dataUrl);
      document.getElementById("cfg-logo-preview").dataset.value = dataUrl;
    });
  });
  document.getElementById("cfg-sound-input").addEventListener("change", async function () {
    if (!this.files[0]) return;
    pendingSoundDataUrl = await fileToDataUrl(this.files[0]);
    var soundStatus = document.getElementById("cfg-sound-status");
    soundStatus.style.display = "block"; soundStatus.textContent = "Novo som selecionado — clique em Salvar para confirmar.";
  });
  document.getElementById("btn-test-sound").addEventListener("click", function () {
    if (pendingSoundDataUrl) new Audio(pendingSoundDataUrl).play().catch(beep);
    else if (staffConfigCache && staffConfigCache.notificationSound) new Audio(staffConfigCache.notificationSound).play().catch(beep);
    else beep();
  });
  document.getElementById("btn-copy-staff-link").addEventListener("click", function () {
    var val = document.getElementById("cfg-staff-link").value;
    if (navigator.clipboard) navigator.clipboard.writeText(val).then(function () { showToast("Link copiado."); });
  });
  document.getElementById("btn-regen-slug").addEventListener("click", async function () {
    if (!confirm("Gerar um novo link? O link antigo deixará de funcionar.")) return;
    var newSlug = Math.random().toString(36).slice(2, 12);
    try { await api("/api/config", { method: "PUT", body: { staffSlug: newSlug } }); loadConfigForm(); loadPublicMenuAndConfig(); showToast("Novo link gerado."); } catch (e) { showToast(e.message); }
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
      var coverVal = document.getElementById("cfg-cover-preview").dataset.value; if (coverVal) body.coverImage = coverVal;
      var logoVal = document.getElementById("cfg-logo-preview").dataset.value; if (logoVal) body.logoImage = logoVal;
      if (pendingSoundDataUrl) body.notificationSound = pendingSoundDataUrl;
      var r = await api("/api/config", { method: "PUT", body: body });
      staffConfigCache = r.config;
      applyAccentColor(r.config.accentColor);
      pendingSoundDataUrl = null;
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
