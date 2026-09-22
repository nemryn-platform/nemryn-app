/* eslint-disable @typescript-eslint/no-unused-vars -- ES5 catch bindings are required syntax in this browser script */
/*!
 * Nemryn request-form embed loader (P1-COMM-D2).
 *
 *   <div data-nemryn-request-form="form_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div>
 *   <script src="https://app.nemryn.com/embed/request-form.js" async></script>
 *
 * What it does: puts the Nemryn form in an ISOLATED iframe (no CSS leaks either way), keeps the iframe exactly as tall as the
 * form, and hands the form the S4C-safe acquisition context of THIS page (utm_* values, pathname, referrer hostname).
 * What it never does: read or send any passenger data, submit anything itself, touch cookies, store anything but the
 * acquisition-only first-touch values in sessionStorage (namespaced nemryn:request-form:<key>:acquisition), or send a full URL,
 * query string, click id, IP or user agent. No third-party code, no dependencies.
 *
 * postMessage: messages are trusted only from the iframe this script created (event.source) AND the Nemryn origin this script
 * was loaded from (event.origin), only for the documented protocol, only with a clamped numeric height. Messages to the iframe
 * are always addressed to the Nemryn origin, never "*".
 *
 * Attribution honesty: the loader can only observe the first page IT ran on in this browser session. If it is present only on
 * the request page, that page is the recorded landing path -- Nemryn does not claim full-site first-touch attribution.
 */
(function (window, document) {
  "use strict";
  if (window.NemrynRequestForm && window.NemrynRequestForm.__loaded) return;

  var SOURCE = "nemryn-request-form";
  var VERSION = 1;
  var KEY_RE = /^form_[0-9a-f]{32}$/;
  var MIN_HEIGHT = 200;
  var MAX_HEIGHT = 6000;
  var PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*$/;
  var HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
  var CONTROL_RE = /[\u0000-\u001f\u007f]/;
  var UTM = [["utm_source", "utmSource", 120], ["utm_medium", "utmMedium", 120], ["utm_campaign", "utmCampaign", 160], ["utm_content", "utmContent", 160], ["utm_term", "utmTerm", 160]];
  var ALLOWED = ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "landingPath", "submissionPath", "referrerHost"];

  var script = document.currentScript;
  if (!script || !script.src) {
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (/\/embed\/request-form\.js(\?|#|$)/.test(all[i].src || "")) { script = all[i]; break; }
    }
  }
  if (!script || !script.src) return;
  var ORIGIN;
  try { ORIGIN = new URL(script.src).origin; } catch (e) { return; }

  var instances = [];

  function safePath(p) {
    if (typeof p !== "string") return null;
    p = p.trim();
    return p.length >= 1 && p.length <= 300 && PATH_RE.test(p) && p.indexOf("//") !== 0 ? p : null;
  }
  function referrerHost(referrer, ownHost) {
    if (typeof referrer !== "string" || referrer === "") return null;
    var host;
    try { host = new URL(referrer).hostname.toLowerCase(); } catch (e) { return null; }
    if (host === "" || host.length > 253 || !HOST_RE.test(host) || /\.\.|-\.|\.-/.test(host)) return null;
    if (ownHost && host === String(ownHost).toLowerCase()) return null;
    return host;
  }
  function fromLocation() {
    var out = {};
    var params = null;
    try { params = new URLSearchParams(window.location.search); } catch (e) { params = null; }
    if (params) {
      for (var i = 0; i < UTM.length; i++) {
        var raw = params.get(UTM[i][0]);
        if (raw === null) continue;
        var v = raw.trim();
        if (v !== "" && Array.from(v).length <= UTM[i][2] && !CONTROL_RE.test(v)) out[UTM[i][1]] = v;
      }
    }
    var path = safePath(window.location.pathname);
    if (path) { out.landingPath = path; out.submissionPath = path; }
    var host = referrerHost(document.referrer, window.location.hostname);
    if (host) out.referrerHost = host;
    return out;
  }
  function sanitizeStored(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var out = {}, any = false;
    for (var i = 0; i < ALLOWED.length; i++) {
      var k = ALLOWED[i], v = raw[k];
      if (typeof v !== "string") continue;
      v = v.trim();
      if (v === "" || v.length > 300 || CONTROL_RE.test(v)) continue;
      if ((k === "landingPath" || k === "submissionPath") && !safePath(v)) continue;
      if (k === "referrerHost") { v = v.toLowerCase(); if (!HOST_RE.test(v)) continue; }
      out[k] = v; any = true;
    }
    return any ? out : null;
  }
  function acquisitionFor(key) {
    var storageKey = "nemryn:request-form:" + key + ":acquisition";
    var current = fromLocation();
    var stored = null;
    try { var raw = window.sessionStorage.getItem(storageKey); stored = raw ? sanitizeStored(JSON.parse(raw)) : null; } catch (e) { stored = null; }
    var merged;
    if (stored) { merged = stored; if (current.submissionPath) merged.submissionPath = current.submissionPath; }
    else merged = current;
    try { window.sessionStorage.setItem(storageKey, JSON.stringify(merged)); } catch (e) { /* storage unavailable: stays in memory only */ }
    return merged;
  }

  function mountOne(container) {
    if (container.getAttribute("data-nemryn-mounted")) return;
    var key = container.getAttribute("data-nemryn-request-form");
    if (!key || !KEY_RE.test(key)) return;
    container.setAttribute("data-nemryn-mounted", "1");
    var iframe = document.createElement("iframe");
    iframe.src = ORIGIN + "/embed/request/" + key;
    iframe.title = "Transportation request form";
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    iframe.style.cssText = "display:block;width:100%;max-width:100%;border:0;height:720px;min-height:" + MIN_HEIGHT + "px;";
    container.appendChild(iframe);
    instances.push({ key: key, container: container, iframe: iframe });
  }

  function mount() {
    var nodes = document.querySelectorAll("[data-nemryn-request-form]");
    for (var i = 0; i < nodes.length; i++) mountOne(nodes[i]);
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== ORIGIN) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.source !== SOURCE || data.v !== VERSION || typeof data.key !== "string") return;
    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i];
      if (inst.key !== data.key || !inst.iframe.contentWindow || inst.iframe.contentWindow !== event.source) continue;
      if (data.type === "ready") {
        inst.iframe.contentWindow.postMessage({ source: SOURCE, v: VERSION, type: "context", key: inst.key, acquisition: acquisitionFor(inst.key) }, ORIGIN);
      } else if (data.type === "resize") {
        if (typeof data.height === "number" && isFinite(data.height)) {
          inst.iframe.style.height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height))) + "px";
        }
      } else if (data.type === "submitted") {
        try {
          var evt = document.createEvent("CustomEvent");
          evt.initCustomEvent("nemryn:request-form:submitted", true, false, { key: inst.key });
          inst.container.dispatchEvent(evt);
        } catch (e) { /* the event is a convenience only */ }
      }
    }
  });

  window.NemrynRequestForm = { __loaded: true, mount: mount };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})(window, document);
