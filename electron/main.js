// Brothers - wrapper Electron
// Abre, em uma janela nativa, o sistema que está publicado na nuvem.
"use strict";
const { app, BrowserWindow, Menu, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG_PATH = path.join(os.homedir(), ".brothers-desktop.json");

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch (e) { return {}; }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch (e) {}
}

let mainWindow;


function createConfigWindow() {
  const win = new BrowserWindow({
    width: 480, height: 260, resizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;">
    <h2 style="margin-top:0;">Brothers Desktop</h2>
    <p>Informe o link do sistema hospedado na nuvem:</p>
    <input id="u" type="text" placeholder="https://seu-sistema.exemplo.com" style="width:100%;padding:8px;font-size:14px;box-sizing:border-box;">
    <button id="b" style="margin-top:14px;padding:10px 16px;">Salvar e abrir</button>
    <script>
      const { ipcRenderer } = require('electron');
      document.getElementById('b').addEventListener('click', () => {
        const v = document.getElementById('u').value.trim();
        if (v) ipcRenderer.send('brothers-set-url', v);
      });
    </script>
  </body></html>`;
  win.loadURL("data:text/html," + encodeURIComponent(html));
  return win;
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860,
    title: "Brothers",
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadURL(url);
}

const { ipcMain } = require("electron");
ipcMain.on("brothers-set-url", (evt, url) => {
  saveConfig({ url: url });
  BrowserWindow.getAllWindows().forEach((w) => w.close());
  createMainWindow(url);
});

app.whenReady().then(() => {
  const cfg = loadConfig();
  if (cfg.url) {
    createMainWindow(cfg.url);
  } else {
    createConfigWindow();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const c = loadConfig();
      if (c.url) createMainWindow(c.url); else createConfigWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
