"use strict";

// App shell: access code, switching between the tools, theme, offline.
// The tools themselves are in citation.js and shift-report.js.

const TOOLS = {
  citation: { title: "Violation Notice", form: "#citation", module: Citation },
  "shift-report": { title: "Shift Report", form: "#report", module: ShiftReport },
};
const DEFAULT_TOOL = "shift-report";
const APP_STORE = { theme: "st.theme", tool: "st.tool" };

// ---- Tools -----------------------------------------------------------------
// The open tool is in the URL hash (#citation, #shift-report), so a link or
// bookmark can open either one; otherwise the last one used comes back.

let currentTool = null;
const scrollPos = {}; // each tool keeps its own scroll position

function toolFromHash() {
  const name = location.hash.slice(1);
  return name in TOOLS ? name : null;
}

function showTool(name) {
  if (!(name in TOOLS)) name = DEFAULT_TOOL;
  if (name === currentTool) return;
  if (currentTool) scrollPos[currentTool] = window.scrollY;
  currentTool = name;
  for (const [key, tool] of Object.entries(TOOLS)) {
    $(tool.form).hidden = key !== name;
    $(`#tab-${key}`).setAttribute("aria-selected", key === name);
  }
  $("#app-title").textContent = TOOLS[name].title;
  document.title = `${TOOLS[name].title} · Security Tool`;
  store.set(APP_STORE.tool, name);
  if (toolFromHash() !== name) history.replaceState(null, "", `#${name}`);
  window.scrollTo(0, scrollPos[name] || 0);
}

function setUpTabs() {
  for (const key of Object.keys(TOOLS)) {
    $(`#tab-${key}`).addEventListener("click", () => showTool(key));
  }
  window.addEventListener("hashchange", () => { if (toolFromHash()) showTool(toolFromHash()); });
  showTool(toolFromHash() || store.get(APP_STORE.tool) || DEFAULT_TOOL);
}

// ---- Access code ---------------------------------------------------------

function showLock(message = "") {
  $("#tools").hidden = true;
  $("#lock-btn").hidden = true;
  $("#lock").hidden = false;
  $("#lock-error").textContent = message;
  $("#lock-code").focus();
}

async function onUnlockSubmit(e) {
  e.preventDefault();
  const btn = $("#lock-submit");
  const err = $("#lock-error");
  btn.disabled = true;
  err.textContent = "Checking…";
  try {
    if (await Vault.unlock($("#lock-code").value, $("#lock-remember").checked)) {
      $("#lock-code").value = "";
      err.textContent = "";
      start();
    } else {
      err.textContent = "That code didn't work.";
      $("#lock-code").select();
    }
  } catch (ex) {
    console.error(ex);
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
}

function lockApp() {
  if (!confirm("Lock the app? The access code will need to be entered again on this device.")) return;
  Vault.lock();
  location.reload();
}

// ---- Light / dark theme --------------------------------------------------
// Follows the device setting until the switch is used; the choice is then
// kept on this device (index.html applies it before the page paints).

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light");

function showThemeButton() {
  const dark = currentTheme() === "dark";
  const btn = $("#theme-btn");
  btn.innerHTML = dark ? SUN : MOON;
  btn.title = btn.ariaLabel = dark ? "Switch to light mode" : "Switch to dark mode";
}

function setUpThemeSwitch() {
  $("#theme-btn").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set(APP_STORE.theme, next);
    showThemeButton();
  });
  systemDark.addEventListener("change", showThemeButton);
  showThemeButton();
}

// ---- Offline support -----------------------------------------------------

async function setUpOffline() {
  const el = $("#offline-status");
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    const check = async () => !!(await caches.match(BUNDLE_URL));
    for (let i = 0; i < 30 && !(await check()); i++) await new Promise((r) => setTimeout(r, 1000));
    if (await check()) {
      el.textContent = installedApp()
        ? "✓ Available offline."
        : "✓ Available offline. Add to Home Screen to open it without a connection.";
    }
  } catch (err) {
    console.warn("Offline support unavailable:", err);
  }
}

// ---- Startup ---------------------------------------------------------------

let started = false;

function start() {
  $("#lock").hidden = true;
  $("#tools").hidden = false;
  $("#lock-btn").hidden = false;
  if (started) return;
  started = true;
  for (const tool of Object.values(TOOLS)) tool.module.start();
}

async function init() {
  // Saved by earlier versions of the separate apps.
  store.del("cg.staffSig");
  store.del("sr.employee");
  setUpThemeSwitch();
  setUpTabs();
  for (const tool of Object.values(TOOLS)) tool.module.init();
  // iOS puts focus back in the last field when the app wakes from sleep,
  // popping up the keyboard. Let go of it whenever the app is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && document.activeElement?.closest("form")) document.activeElement.blur();
  });
  $("#lock-form").addEventListener("submit", onUnlockSubmit);
  $("#lock-btn").addEventListener("click", lockApp);
  setUpOffline();
  if (!Vault.isSupported()) {
    showLock("This browser can't unlock the app. Open it over HTTPS.");
    $("#lock-submit").disabled = true;
    return;
  }
  let opened = false;
  try {
    opened = await Vault.unlockRemembered();
  } catch (err) {
    showLock(err.message);
    return;
  }
  opened ? start() : showLock();
}

init();
