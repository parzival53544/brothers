// Brothers - utilitários de telefone e nome
"use strict";

const DEFAULT_DDD = "92";

// Normaliza qualquer formato digitado para 55 + DDD + número (13 dígitos quando celular).
// Aceita: 9999-9999, 99999-9999, (92) 9999-9999, 92 99999-9999, +55 92 99999-9999, etc.
// Se vier sem DDD, assume 92. Se vier celular sem o 9 na frente, adiciona.
function normalizePhoneBR(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  d = d.replace(/^0+/, "");
  if (d.length > 13) return d; // ids internos do WhatsApp (@lid) ou números internacionais: não mexe
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2); // remove o código do país
  if (d.length === 8) {
    // sem DDD e sem o 9: 9999-9999
    return "55" + DEFAULT_DDD + (/^[6-9]/.test(d) ? "9" : "") + d;
  }
  if (d.length === 9) return "55" + DEFAULT_DDD + d; // sem DDD: 99999-9999
  if (d.length === 10) {
    // DDD + 8 dígitos: adiciona o 9 se for celular
    const ddd = d.slice(0, 2), rest = d.slice(2);
    return "55" + ddd + (/^[6-9]/.test(rest) ? "9" : "") + rest;
  }
  if (d.length === 11) return "55" + d;
  return d; // tamanho estranho: devolve como veio pra validação tratar
}

function isValidBRPhone(normalized) {
  return /^55\d{2}9?\d{8}$/.test(String(normalized || "")) && String(normalized).length >= 12 && String(normalized).length <= 13;
}

function formatPhoneBR(normalized) {
  const d = String(normalized || "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return "+55 (" + d.slice(2, 4) + ") " + d.slice(4, 9) + "-" + d.slice(9);
  if (d.length === 12 && d.startsWith("55")) return "+55 (" + d.slice(2, 4) + ") " + d.slice(4, 8) + "-" + d.slice(8);
  return d;
}

// "joão da silva" -> "João da Silva"
function titleCaseName(s) {
  let out = String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
  out = out.replace(/(^|[\s\-'])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
  out = out.replace(/\s(Da|De|Do|Das|Dos|E)(?=\s)/g, (m, w) => " " + w.toLowerCase());
  return out;
}

function firstName(s) {
  const t = titleCaseName(s);
  return t ? t.split(" ")[0] : "";
}

module.exports = { normalizePhoneBR, isValidBRPhone, formatPhoneBR, titleCaseName, firstName, DEFAULT_DDD };
