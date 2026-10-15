(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const DB_NAME = "malesep-local-v1";
  const STORE = "items";
  const KY_MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  const CATEGORY = {
    sheep: { label: "Кой-эчки", title: "Кой-эчкиси бар адамдар", keys: ["sheep", "lambs", "goats", "kids"] },
    cow: { label: "Уй", title: "Уйу бар адамдар", keys: ["cows"] },
    horse: { label: "Жылкы", title: "Жылкысы бар адамдар", keys: ["horses"] }
  };
  const COUNT_LABELS = { sheep: "Кой", lambs: "Козу", goats: "Эчки", kids: "Улак", horses: "Жылкы" };
  const VOICE_ANIMALS = {
    кой: "sheep", койлор: "sheep", козу: "lambs", козулар: "lambs",
    эчки: "goats", эчкилер: "goats", улак: "kids", улактар: "kids",
    жылкы: "horses", жылкылар: "horses", уй: "cows", уйлар: "cows"
  };
  const VOICE_NUMBERS = {
    бир: 1, эки: 2, үч: 3, төрт: 4, беш: 5, алты: 6, жети: 7, сегиз: 8, тогуз: 9, он: 10,
    "он бир": 11, "он эки": 12, "он үч": 13, "он төрт": 14, "он беш": 15,
    "он алты": 16, "он жети": 17, "он сегиз": 18, "он тогуз": 19, жыйырма: 20
  };
  const RATE_LABELS = { sheep: "Кой", lambs: "Козу", goats: "Эчки", kids: "Улак", cows: "Уй", horses: "Жылкы" };
  const DEFAULT_RATES = { sheep: 100, lambs: 100, goats: 100, kids: 100, cows: 600, horses: 0 };
  const STOCK_KEYS = Object.keys(RATE_LABELS);
  const state = { token: "", refreshToken: "", userId: "", pinUserId: "", email: "", username: "", data: emptyData(), category: "sheep", expanded: "", search: "", isRegister: false, syncing: false, syncAgain: false, pendingAccount: null, voicePending: null, voiceRecognition: null };
  state.recoveryToken = "";
  let dbPromise;
  let toastTimer;
  let installPrompt;

  function emptyData() {
    return { people: [], events: [], movements: [], rateHistory: [], settings: { dailyRates: { ...DEFAULT_RATES } }, settingsUpdatedAt: "", costTrackingVersion: 0, costTrackingStarted: "", updatedAt: "" };
  }

  function openDb() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("Бул браузер жергиликтүү маалымат сактоону колдобойт."));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Жергиликтүү сактагыч ачылган жок."));
      });
    }
    return dbPromise;
  }

  async function localGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = () => reject(request.error);
    });
  }

  async function localSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put({ key, value });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function now() {
    return new Date().toISOString();
  }

  function localDate() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDate(dateValue) {
    if (!dateValue) return "—";
    const date = new Date(`${dateValue}T00:00:00`);
    return Number.isNaN(date.valueOf()) ? escapeHtml(dateValue) : `${date.getDate()}-${KY_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  }

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), 2800);
  }

  function setConnection(kind, text) {
    const connection = $(".connection");
    connection.classList.remove("online", "offline");
    if (kind) connection.classList.add(kind);
    $("#connectionText").textContent = text;
  }

  function showAuth(message = "", success = false) {
    const recoveringPassword = Boolean(state.recoveryToken);
    $("#authScreen").hidden = false;
    $("#pinScreen").hidden = true;
    $("#appScreen").hidden = true;
    $("#lockButton").hidden = true;
    $("#logoutButton").hidden = true;
    $("#authTitle").textContent = recoveringPassword ? "Жаңы сырсөз" : state.isRegister ? "Жаңы аккаунт" : "Кош келиңиз";
    $("#authSubtitle").textContent = recoveringPassword
      ? "Аккаунтуңуз үчүн жаңы сырсөз жазыңыз."
      : state.isRegister
        ? "Жеке кабинетиңизди түзүп, мал эсебиңизди баштаңыз."
        : "Кабинетиңизге кирүү үчүн маалыматыңызды жазыңыз.";
    $("#authSubmit").innerHTML = recoveringPassword
      ? 'Сырсөздү жаңыртуу <span>→</span>'
      : state.isRegister ? 'Аккаунт түзүү <span>→</span>' : 'Кирүү <span>→</span>';
    $("#switchPrompt").textContent = state.isRegister ? "Аккаунтуңуз барбы?" : "Аккаунтуңуз жокпу?";
    $("#switchAuth").textContent = state.isRegister ? "Кирүү" : "Катталуу";
    $("#switchPrompt").hidden = recoveringPassword;
    $("#switchAuth").hidden = recoveringPassword;
    $("#resetPasswordButton").hidden = recoveringPassword;
    $("#usernameInput").closest("label").hidden = recoveringPassword;
    $("#usernameInput").required = !recoveringPassword;
    $("#passwordInput").autocomplete = recoveringPassword || state.isRegister ? "new-password" : "current-password";
    $("#authMessage").textContent = message;
    $("#authMessage").classList.toggle("success", success);
  }

  function showPinScreen(mode, message = "") {
    $("#authScreen").hidden = true;
    $("#pinScreen").hidden = false;
    $("#appScreen").hidden = true;
    $("#lockButton").hidden = true;
    $("#logoutButton").hidden = true;
    const setup = mode === "setup";
    $("#pinTitle").textContent = setup ? "Купуя PIN-код түзүңүз" : "PIN-кодду киргизиңиз";
    $("#pinDescription").textContent = setup
      ? "Мал маалыматын ачуу үчүн 4 сандан турган код коюңуз. Бул код ушул түзмөктө гана сакталат."
      : "Мал маалыматын ачуу үчүн 4 орундуу PIN-кодуңузду киргизиңиз.";
    $("#pinConfirmLabel").hidden = !setup;
    $("#pinConfirmInput").required = setup;
    $("#pinSubmit").innerHTML = setup ? 'PIN-код түзүү <span>→</span>' : 'Ачуу <span>→</span>';
    $("#forgotPinButton").hidden = setup;
    $("#pinMessage").textContent = message;
    $("#pinMessage").classList.remove("success");
    $("#pinInput").value = "";
    $("#pinConfirmInput").value = "";
    $("#pinInput").focus();
  }

  function showApp() {
    $("#authScreen").hidden = true;
    $("#pinScreen").hidden = true;
    $("#appScreen").hidden = false;
    $("#lockButton").hidden = false;
    $("#logoutButton").hidden = false;
    $("#greetingName").textContent = state.username;
    $("#todayDate").textContent = `${new Date().getDate()}-${KY_MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`;
    render();
  }

  function pinStorageKey(userId) {
    return `pin:${userId}`;
  }

  function pinResetKey(userId) {
    return `pin-reset:${userId}`;
  }

  function bytesToHex(bytes) {
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function hashPin(pin, salt, iterations = 310000) {
    if (!crypto.subtle) throw new Error("PIN-код үчүн коопсуз шифрлөө жеткиликсиз. Колдонмону HTTPS аркылуу ачыңыз.");
    if (!/^[\da-f]{32}$/iu.test(salt) || !Number.isInteger(iterations) || iterations < 10000 || iterations > 1000000) {
      throw new Error("PIN-коддун сакталган маалыматы туура эмес. Аккаунтка сырсөз менен кайра кирип, PIN-кодду жаңыртыңыз.");
    }
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      hash: "SHA-256",
      salt: Uint8Array.from(salt.match(/.{2}/g), (byte) => parseInt(byte, 16)),
      iterations
    }, key, 256);
    return bytesToHex(bits);
  }

  function sameHash(first, second) {
    if (first.length !== second.length) return false;
    let difference = 0;
    for (let index = 0; index < first.length; index += 1) {
      difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
    }
    return difference === 0;
  }

  async function requestAccountAccess(session, cachedData) {
    state.pendingAccount = { session, cachedData: cachedData || emptyData() };
    const pin = await localGet(pinStorageKey(session.userId));
    showPinScreen(pin ? "unlock" : "setup");
  }

  async function continueAccountAccess(session, cachedData) {
    state.token = session.token;
    state.refreshToken = session.refreshToken || "";
    state.userId = session.userId;
    state.pinUserId = session.userId;
    state.email = session.email;
    state.username = session.username || session.email.split("@")[0];
    await requestAccountAccess(session, cachedData);
  }

  async function unlockAccount() {
    if (!state.pendingAccount) throw new Error("Аккаунттун маалыматы табылган жок. Кайра кириңиз.");
    const { session, cachedData } = state.pendingAccount;
    state.pendingAccount = null;
    await enterAccount(session, cachedData);
  }

  function supabaseConfig() {
    const config = window.MALESEP_CONFIG || {};
    const url = String(config.url || "").trim().replace(/\/+$/, "");
    const anonKey = String(config.anonKey || "").trim();
    if (!/^https:\/\/[^/]+$/i.test(url) || !anonKey || /YOUR_|PASTE_/i.test(anonKey)) {
      throw new Error("Supabase туташтырылган эмес. web/config.js файлына долбоордун URL жана anon key маанилерин киргизиңиз.");
    }
    return {
      url,
      anonKey,
      storageBucket: String(config.storageBucket || "animal-media"),
      redirectUrl: String(config.redirectUrl || `${location.origin}${location.pathname}`)
    };
  }

  async function parseCloudResponse(response) {
    if (response.status === 204) return null;
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.blob();
  }

  function cloudErrorMessage(result, status) {
    if (result && typeof result === "object") {
      const message = result.msg || result.message || result.error_description || result.error;
      if (message) return String(message);
    }
    return `Серверден ката чыкты (${status}).`;
  }

  function checkedMediaKey(value) {
    const parts = String(value).split("/");
    if (parts.length !== 2 || parts[0] !== state.userId || !/^[\w.-]{1,200}$/u.test(parts[1])) {
      throw new Error("Медиа файлдын аккаунтка тиешелүү жолу туура эмес.");
    }
    return parts;
  }

  async function refreshCloudSession() {
    const { url, anonKey } = supabaseConfig();
    if (!state.refreshToken) throw new Error("Сеанстын мөөнөтү бүттү. Интернетке туташып кайра кириңиз.");
    const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: state.refreshToken })
    });
    const result = await parseCloudResponse(response);
    if (!response.ok || !result?.access_token || !result?.user?.id) {
      await localSet("session", null);
      state.token = "";
      state.refreshToken = "";
      state.userId = "";
      throw new Error("Сеанстын мөөнөтү бүттү. Email жана сырсөз менен кайра кириңиз.");
    }
    state.token = result.access_token;
    state.refreshToken = result.refresh_token || state.refreshToken;
    state.userId = result.user.id;
    await localSet("session", {
      token: state.token,
      refreshToken: state.refreshToken,
      userId: state.userId,
      email: state.email,
      username: state.username
    });
  }

  async function cloudRequest(path, options = {}, retried = false) {
    const { url, anonKey } = supabaseConfig();
    const headers = new Headers(options.headers || {});
    headers.set("apikey", anonKey);
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    if (options.body && !(options.body instanceof Blob)) headers.set("Content-Type", "application/json");
    const response = await fetch(`${url}${path}`, { ...options, headers });
    if (response.status === 401 && !retried && state.refreshToken) {
      await refreshCloudSession();
      return cloudRequest(path, options, true);
    }
    const result = await parseCloudResponse(response);
    if (!response.ok) throw new Error(cloudErrorMessage(result, response.status));
    return result;
  }

  async function api(path, options = {}) {
    const { storageBucket } = supabaseConfig();
    if (path === "/api/data" && (!options.method || options.method === "GET")) {
      if (!state.userId) throw new Error("Аккаунт маалыматы табылган жок. Кайра кириңиз.");
      const rows = await cloudRequest(`/rest/v1/herd_data?select=data&user_id=eq.${encodeURIComponent(state.userId)}`);
      return rows[0]?.data || emptyData();
    }
    if (path === "/api/data" && options.method === "PUT") {
      const incoming = JSON.parse(options.body);
      return cloudRequest("/rest/v1/rpc/merge_herd_data", {
        method: "POST",
        body: JSON.stringify({ p_incoming: incoming })
      });
    }
    if (path === "/api/media" && options.method === "POST") {
      if (!state.userId || !(options.body instanceof Blob)) throw new Error("Сүрөттү серверге жүктөө мүмкүн болгон жок.");
      const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" })[options.body.type] || "bin";
      const objectKey = `${state.userId}/${uid()}.${extension}`;
      const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
      await cloudRequest(`/storage/v1/object/${encodeURIComponent(storageBucket)}/${encodedKey}`, {
        method: "POST",
        headers: { "Content-Type": options.body.type || "application/octet-stream", "x-upsert": "true" },
        body: options.body
      });
      return { id: objectKey };
    }
    if (path.startsWith("/api/media/")) {
      const objectKey = decodeURIComponent(path.slice("/api/media/".length));
      const encodedKey = checkedMediaKey(objectKey).map(encodeURIComponent).join("/");
      return cloudRequest(`/storage/v1/object/authenticated/${encodeURIComponent(storageBucket)}/${encodedKey}`);
    }
    throw new Error("Туура эмес сервер сурамы.");
  }

  async function authRequest(path, payload) {
    const { url, anonKey } = supabaseConfig();
    const response = await fetch(`${url}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await parseCloudResponse(response);
    if (!response.ok) throw new Error(cloudErrorMessage(result, response.status));
    return result;
  }

  async function updateRecoveredPassword(password) {
    const { url, anonKey } = supabaseConfig();
    const response = await fetch(`${url}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${state.recoveryToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password })
    });
    const result = await parseCloudResponse(response);
    if (!response.ok) throw new Error(cloudErrorMessage(result, response.status));
    state.recoveryToken = "";
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    state.isRegister = false;
    $("#passwordInput").value = "";
    showAuth("Сырсөз жаңыртылды. Email жана жаңы сырсөз менен кириңиз.", true);
  }

  function mergeItems(localItems, remoteItems) {
    const items = new Map((remoteItems || []).map((item) => [item.id, item]));
    for (const item of localItems || []) {
      const old = items.get(item.id);
      if (!old || String(item.updatedAt || "") >= String(old.updatedAt || "")) items.set(item.id, item);
    }
    return [...items.values()];
  }

  function mergeStates(local, remote) {
    const settingsSource = String(local.settingsUpdatedAt || "") >= String(remote.settingsUpdatedAt || "") ? local : remote;
    return {
      people: mergeItems(local.people, remote.people),
      events: mergeItems(local.events, remote.events),
      movements: mergeItems(local.movements || [], remote.movements || []),
      rateHistory: mergeItems(local.rateHistory || [], remote.rateHistory || []),
      settings: settingsSource.settings || {},
      settingsUpdatedAt: [local.settingsUpdatedAt, remote.settingsUpdatedAt].sort().at(-1) || "",
      costTrackingVersion: Math.max(Number(local.costTrackingVersion) || 0, Number(remote.costTrackingVersion) || 0),
      costTrackingStarted: [local.costTrackingStarted, remote.costTrackingStarted].filter(Boolean).sort()[0] || "",
      updatedAt: [local.updatedAt, remote.updatedAt].filter(Boolean).sort().at(-1) || ""
    };
  }

  function animalBalance(person, key) {
    return key === "cows" ? liveCows(person).length : Math.max(0, Number(person[key]) || 0);
  }

  function appendMovement(personId, animalKey, quantity, date = localDate(), entityId = "") {
    if (!quantity) return;
    state.data.movements.push({ id: uid(), personId, animalKey, delta: quantity, date, entityId, createdAt: now(), updatedAt: now() });
  }

  function ensureCostTracking(data = state.data) {
    data.people = Array.isArray(data.people) ? data.people : [];
    data.events = Array.isArray(data.events) ? data.events : [];
    data.movements = Array.isArray(data.movements) ? data.movements : [];
    data.rateHistory = Array.isArray(data.rateHistory) ? data.rateHistory : [];
    const today = localDate();
    if ((Number(data.costTrackingVersion) || 0) < 1) {
      const startDate = data.costTrackingStarted || today;
      for (const person of data.people) {
        for (const key of STOCK_KEYS) {
          const value = key === "cows"
            ? liveCows(person).length
            : Math.max(0, Number(person[key]) || 0);
          if (value && !data.movements.some((movement) => movement.personId === person.id && movement.animalKey === key)) {
            const cows = key === "cows" ? liveCows(person) : [];
            if (cows.length) {
              cows.forEach((cow) => data.movements.push({ id: uid(), personId: person.id, animalKey: key, delta: 1, date: startDate, entityId: cow.id, createdAt: now(), updatedAt: now() }));
            } else {
              data.movements.push({ id: uid(), personId: person.id, animalKey: key, delta: value, date: startDate, entityId: "", createdAt: now(), updatedAt: now() });
            }
          }
        }
      }
      data.costTrackingStarted = startDate;
      data.costTrackingVersion = 1;
    }
    data.settings = data.settings && typeof data.settings === "object" ? data.settings : {};
    const rates = data.settings.dailyRates && typeof data.settings.dailyRates === "object"
      ? data.settings.dailyRates
      : {};
    data.settings.dailyRates = Object.fromEntries(STOCK_KEYS.map((key) => [key, validRate(rates[key], DEFAULT_RATES[key])]));
    if (!data.settingsUpdatedAt) data.settingsUpdatedAt = now();
    if (!data.rateHistory.length) {
      data.rateHistory.push({
        id: `rates-initial:${state.userId || state.email || "local"}`,
        date: data.costTrackingStarted || today,
        rates: { ...data.settings.dailyRates },
        updatedAt: data.settingsUpdatedAt
      });
    }
    return data;
  }

  function validRate(value, fallback = 0) {
    const rate = Number(value);
    return Number.isFinite(rate) && rate >= 0 ? Math.min(rate, 1_000_000) : fallback;
  }

  function dayOffset(day, amount) {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function money(amount) {
    return `${new Intl.NumberFormat("ky-KG", { maximumFractionDigits: 0 }).format(Math.round(amount))} сом`;
  }

  function ratesForDate(date) {
    const applicable = (state.data.rateHistory || [])
      .filter((entry) => entry.date <= date)
      .sort((first, second) => first.date.localeCompare(second.date) || String(first.updatedAt || "").localeCompare(String(second.updatedAt || "")));
    const latest = applicable.at(-1)?.rates || state.data.settings?.dailyRates || DEFAULT_RATES;
    return Object.fromEntries(STOCK_KEYS.map((key) => [key, validRate(latest[key], DEFAULT_RATES[key])]));
  }

  function aggregateMovements({ start = "", end = "", personId = "" } = {}) {
    const totals = Object.fromEntries(STOCK_KEYS.map((key) => [key, 0]));
    for (const movement of state.data.movements || []) {
      if (personId && movement.personId !== personId) continue;
      if (start && movement.date < start) continue;
      if (end && movement.date > end) continue;
      if (Object.hasOwn(totals, movement.animalKey)) totals[movement.animalKey] += Number(movement.delta) || 0;
    }
    return Object.fromEntries(STOCK_KEYS.map((key) => [key, Math.max(0, totals[key])]));
  }

  function dailyCostBreakdown(date, personId = "") {
    const stock = aggregateMovements({ end: date, personId });
    const rates = ratesForDate(date);
    return Object.fromEntries(STOCK_KEYS.map((key) => [key, stock[key] * rates[key]]));
  }

  function accumulatedCost(startDate, endDate, personId = "") {
    if (!startDate || startDate > endDate) return 0;
    const dayCounts = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
    if (!Number.isFinite(dayCounts) || dayCounts < 0) return 0;
    let total = 0;
    let stock = Object.fromEntries(STOCK_KEYS.map((key) => [key, 0]));
    const movements = (state.data.movements || [])
      .filter((movement) => (!personId || movement.personId === personId) && movement.date >= startDate && movement.date <= endDate)
      .sort((first, second) => first.date.localeCompare(second.date));
    let movementIndex = 0;
    for (let offset = 0; offset <= dayCounts; offset += 1) {
      const date = dayOffset(startDate, offset);
      const changes = Object.fromEntries(STOCK_KEYS.map((key) => [key, 0]));
      while (movementIndex < movements.length && movements[movementIndex].date <= date) {
        const movement = movements[movementIndex];
        if (Object.hasOwn(stock, movement.animalKey)) changes[movement.animalKey] += Number(movement.delta) || 0;
        movementIndex += 1;
      }
      STOCK_KEYS.forEach((key) => { stock[key] = Math.max(0, stock[key] + changes[key]); });
      const rates = ratesForDate(date);
      total += STOCK_KEYS.reduce((sum, key) => sum + stock[key] * rates[key], 0);
    }
    return total;
  }

  function mediaItems(value, result = []) {
    if (Array.isArray(value)) {
      value.forEach((item) => mediaItems(item, result));
    } else if (value && typeof value === "object") {
      if (typeof value.type === "string" && (value.type.startsWith("image/") || value.type.startsWith("video/"))) result.push(value);
      else Object.values(value).forEach((item) => mediaItems(item, result));
    }
    return result;
  }

  function mapMedia(value, callback) {
    if (Array.isArray(value)) return value.map((item) => mapMedia(item, callback));
    if (!value || typeof value !== "object") return value;
    if (typeof value.type === "string" && (value.type.startsWith("image/") || value.type.startsWith("video/"))) return callback({ ...value });
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapMedia(item, callback)]));
  }

  function preserveLocalMedia(remote, local) {
    const localById = new Map(mediaItems(local).filter((item) => item.id && item.data).map((item) => [item.id, item.data]));
    return mapMedia(remote, (item) => {
      if (item.data) return item;
      if (item.id && localById.has(item.id)) item.data = localById.get(item.id);
      return item;
    });
  }

  function serverSafeData(data) {
    return mapMedia(data, (item) => {
      delete item.data;
      return item;
    });
  }

  function decodeDataUrl(dataUrl) {
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(0, comma);
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const type = (meta.match(/^data:([^;]+)/) || [])[1] || "application/octet-stream";
    return new Blob([bytes], { type });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Жүктөлгөн сүрөттү окуу мүмкүн болгон жок."));
      reader.readAsDataURL(blob);
    });
  }

  async function uploadLocalMedia(data) {
    for (const item of mediaItems(data)) {
      if (item.data && (typeof item.id !== "string" || !item.id.startsWith(`${state.userId}/`))) {
        const blob = decodeDataUrl(item.data);
        const result = await api("/api/media", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        item.id = result.id;
      }
    }
  }

  async function hydrateMedia(data) {
    for (const item of mediaItems(data)) {
      if (!item.data && item.id) {
        const blob = await api(`/api/media/${encodeURIComponent(item.id)}`);
        item.data = await blobToDataUrl(blob);
      }
    }
    return data;
  }

  async function synchronize() {
    if (!state.token || !state.userId || !navigator.onLine) {
      $("#syncStatus").textContent = "Интернетсиз · бул түзмөктө сакталды";
      setConnection("offline", "Офлайн режим");
      return;
    }
    if (state.syncing) {
      state.syncAgain = true;
      return;
    }
    state.syncing = true;
    $("#syncStatus").textContent = "Сервер менен шайкештешүүдө…";
    try {
      do {
        state.syncAgain = false;
        const remote = await api("/api/data");
        state.data = mergeStates(state.data, remote);
        ensureCostTracking();
        await uploadLocalMedia(state.data);
        const localSnapshot = state.data;
        const saved = await api("/api/data", { method: "PUT", body: JSON.stringify(serverSafeData(localSnapshot)) });
        state.data = mergeStates(state.data, preserveLocalMedia(saved, localSnapshot));
        await hydrateMedia(state.data);
        state.data.updatedAt = now();
        await localSet(`data:${state.email}`, state.data);
        await localSet("session", {
          token: state.token,
          refreshToken: state.refreshToken,
          userId: state.userId,
          email: state.email,
          username: state.username
        });
      } while (state.syncAgain);
      $("#syncStatus").textContent = "Серверге шайкештешти";
      setConnection("online", "Серверге туташты");
      render();
    } catch (error) {
      $("#syncStatus").textContent = "Синхрондошуу болбоду · жергиликтүү сакталды";
      setConnection("offline", "Синхрондошуу күтүлүүдө");
      toast(error.message);
    } finally {
      state.syncing = false;
    }
  }

  async function saveState() {
    ensureCostTracking();
    state.data.updatedAt = now();
    await localSet(`data:${state.email}`, state.data);
    render();
    if (navigator.onLine) synchronize();
    else $("#syncStatus").textContent = "Интернетсиз · бул түзмөктө сакталды";
  }

  async function enterAccount(session, cachedData) {
    state.token = session.token;
    state.refreshToken = session.refreshToken || "";
    state.userId = session.userId;
    state.pinUserId = session.userId;
    state.email = session.email;
    state.username = session.username || session.email.split("@")[0];
    state.data = cachedData || emptyData();
    if (!navigator.onLine) ensureCostTracking();
    showApp();
    if (!navigator.onLine) {
      setConnection("offline", "Офлайн режим");
      $("#syncStatus").textContent = "Интернетсиз · өзгөрүүлөр түзмөктө сакталып, кийин шайкештешет";
      return;
    }
    await synchronize();
  }

  function personById(id) {
    return state.data.people.find((person) => person.id === id && !person.deleted);
  }

  function cowById(person, cowId) {
    return (person.cows || []).find((cow) => cow.id === cowId);
  }

  function liveCows(person) {
    return (person.cows || []).filter((cow) => cow.status !== "inactive" && !cow.deleted);
  }

  function livePeople() {
    return state.data.people.filter((person) => !person.deleted);
  }

  function sumFor(person, category) {
    if (category === "cow") return liveCows(person).length;
    return CATEGORY[category].keys.reduce((sum, key) => sum + (Number(person[key]) || 0), 0);
  }

  function totalFor(category) {
    return livePeople().reduce((sum, person) => sum + sumFor(person, category), 0);
  }

  function render() {
    if ($("#appScreen").hidden) return;
    const people = livePeople();
    const dailyCost = dailyCostBreakdown(localDate());
    $("#dailyCost").textContent = money(Object.values(dailyCost).reduce((sum, amount) => sum + amount, 0));
    const trackingStart = state.data.costTrackingStarted;
    $("#totalCost").textContent = money(trackingStart ? accumulatedCost(trackingStart, localDate()) : 0);
    $("#costPeriod").textContent = trackingStart ? `${formatDate(trackingStart)} бери` : "Каттоо башталууда";
    $("#totalPeople").textContent = people.length;
    $("#totalSheep").textContent = totalFor("sheep");
    $("#totalCows").textContent = totalFor("cow");
    $("#totalHorses").textContent = totalFor("horse");
    $("#tabSheepCount").textContent = totalFor("sheep");
    $("#tabCowCount").textContent = totalFor("cow");
    $("#tabHorseCount").textContent = totalFor("horse");
    $$(".category-tab").forEach((button) => button.classList.toggle("active", button.dataset.category === state.category));
    $("#peopleHeading").textContent = CATEGORY[state.category].title;
    $("#peopleHint").textContent = state.category === "cow" ? "Уйдун анкетасын ачып сүрөттөрүн көрүңүз" : "Ар бир адамдын малын өзүнчө көрүңүз";
    const search = state.search.toLocaleLowerCase("ky");
    const shown = people.filter((person) => person.name.toLocaleLowerCase("ky").includes(search));
    $("#peopleList").innerHTML = shown.map(renderPerson).join("");
    $("#emptyState").hidden = shown.length > 0;
    $("#activityEmpty").hidden = state.data.events.some((event) => !event.deleted);
    renderActivity();
  }

  function renderPerson(person) {
    const active = sumFor(person, state.category);
    const expanded = state.expanded === person.id;
    const initial = escapeHtml(person.name.trim().charAt(0).toLocaleUpperCase("ky") || "М");
    const subtitle = state.category === "cow"
      ? `${liveCows(person).length} уй · ${person.cows?.filter((cow) => cow.status === "inactive").length || 0} чарбадан чыккан`
      : state.category === "sheep"
        ? `${Number(person.sheep) || 0} кой · ${Number(person.lambs) || 0} козу · ${Number(person.goats) || 0} эчки · ${Number(person.kids) || 0} улак`
        : `${Number(person.horses) || 0} жылкы`;
    return `<article class="person-card">
      <div class="person-main" data-action="toggle" data-id="${escapeHtml(person.id)}">
        <span class="person-avatar">${initial}</span>
        <span class="person-details"><strong>${escapeHtml(person.name)}</strong><small>${subtitle}</small></span>
        <span class="person-count">${active}<small>баш</small></span>
        <span class="person-actions">
          <button class="small-action" title="Өзгөртүү" aria-label="Өзгөртүү" data-action="edit-person" data-id="${escapeHtml(person.id)}">✎</button>
          <button class="small-action" title="Маалымат" aria-label="Маалымат" data-action="details-person" data-id="${escapeHtml(person.id)}">↗</button>
        </span>
      </div>
      ${expanded ? renderExpanded(person) : ""}
    </article>`;
  }

  function renderExpanded(person) {
    const animalSection = state.category === "cow"
      ? renderCowList(person)
      : state.category === "sheep"
        ? ["sheep", "lambs", "goats", "kids"].map((key) => `<div class="count-tile"><span>${COUNT_LABELS[key]}</span><strong>${Number(person[key]) || 0}</strong></div>`).join("")
        : `<div class="count-tile"><span>Жылкы</span><strong>${Number(person.horses) || 0}</strong></div>`;
    const eventAction = `<button class="outline-button" data-action="add-event" data-id="${escapeHtml(person.id)}">＋ Өлгөн / алып кеткен малды каттоо</button>`;
    const addCow = state.category === "cow" ? `<button class="outline-button" data-action="add-cow" data-id="${escapeHtml(person.id)}">＋ Уй кошуу</button>` : "";
    const personDailyBreakdown = dailyCostBreakdown(localDate(), person.id);
    const personDailyTotal = Object.values(personDailyBreakdown).reduce((sum, amount) => sum + amount, 0);
    const personTotal = state.data.costTrackingStarted
      ? accumulatedCost(state.data.costTrackingStarted, localDate(), person.id)
      : 0;
    const personStocks = aggregateMovements({ end: localDate(), personId: person.id });
    const personCostRows = STOCK_KEYS.filter((key) => personStocks[key] > 0)
      .map((key) => {
        const heads = personStocks[key];
        const dailyRate = state.data.settings?.dailyRates?.[key] ?? DEFAULT_RATES[key];
        return `<span>${RATE_LABELS[key]}: <strong>${heads} × ${money(dailyRate)}/күн = ${money(personDailyBreakdown[key])}</strong></span>`;
      }).join("");
    return `<div class="person-expanded">
      ${state.category === "cow" ? `<div class="eyebrow">УЙЛАРДЫН АНКЕТАСЫ</div>` : `<div class="count-grid">${animalSection}</div>`}
      ${state.category === "cow" ? animalSection : ""}
      <div class="money-breakdown"><strong>Күнүмдүк багуу чыгымы: ${money(personDailyTotal)}</strong><br>${personCostRows || "Малдын күндүк баасы эсептелген жок."}<br><strong>Топтолгон: ${money(personTotal)}</strong> · <button class="cost-settings-link" type="button" data-open-settings>бааларды өзгөртүү</button></div>
      <div class="expanded-footer">${addCow}${eventAction}<button class="danger-button record-link" data-action="delete-person" data-id="${escapeHtml(person.id)}">Адамды өчүрүү</button></div>
    </div>`;
  }

  function renderCowList(person) {
    const cows = liveCows(person);
    if (!cows.length) return `<p class="muted">Катталган уй жок. «Уй кошуу» баскычын басыңыз.</p>`;
    return `<div class="cow-mini-list">${cows.map((cow) => {
      const photo = cow.photos?.find((item) => item.data && item.type?.startsWith("image/"));
      return `<div class="cow-mini">
        ${photo ? `<img src="${photo.data}" alt="">` : `<span class="cow-placeholder"></span>`}
        <span>${escapeHtml(cow.tag || "Биркасыз уй")} · ${escapeHtml(cow.color || "Өңү жазылган эмес")}</span>
        <button class="outline-button" data-action="edit-cow" data-id="${escapeHtml(person.id)}" data-cow="${escapeHtml(cow.id)}">Анкета ↗</button>
      </div>`;
    }).join("")}</div>`;
  }

  function renderActivity() {
    const events = state.data.events.filter((event) => !event.deleted).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
    $("#activityList").innerHTML = events.map((event) => {
      const type = event.kind === "death" ? "death" : "";
      const description = event.kind === "death" ? "өлдү" : "чарбадан чыкты";
      const qty = event.category === "cow" ? "1 уй" : `${event.quantity} ${event.animalLabel || "мал"}`;
      const photoCount = event.attachments?.length || 0;
      const owner = personById(event.personId);
      return `<div class="activity-item"><span class="activity-icon ${type}">${event.kind === "death" ? "†" : "↗"}</span><span class="activity-copy"><strong>${escapeHtml(owner?.name || "Өчүрүлгөн адам")}</strong> — ${qty} ${description}${photoCount ? ` · ${photoCount} медиа` : ""}${event.note ? `<br>${escapeHtml(event.note)}` : ""}<small>${formatDate(event.date)}</small></span></div>`;
    }).join("");
  }

  function normalizeVoiceText(text) {
    return String(text || "").toLocaleLowerCase("ky-KG").replace(/[.,!?;:]+/gu, " ").replace(/\s+/gu, " ").trim();
  }

  function parseVoiceNumber(tokens, animalIndex) {
    const previous = tokens[animalIndex - 1];
    if (/^\d{1,5}$/u.test(previous || "")) return Number(previous);
    const pair = `${tokens[animalIndex - 2] || ""} ${previous || ""}`.trim();
    if (Object.hasOwn(VOICE_NUMBERS, pair)) return VOICE_NUMBERS[pair];
    return VOICE_NUMBERS[previous] || 0;
  }

  function parseVoiceCommand(transcript) {
    const words = normalizeVoiceText(transcript).split(" ");
    const lastTwo = words.slice(-2).join(" ");
    const verb = ["алды", "сатты"].includes(words.at(-1)) || lastTwo === "алып кетти";
    if (!verb) throw new Error("Сүйлөмдүн аягында «алды», «алып кетти» же «сатты» деп айтыңыз.");

    const animals = words.map((word, index) => ({ index, key: VOICE_ANIMALS[word] })).filter((item) => item.key);
    if (!animals.length) throw new Error("Малдын түрүн түшүнө алган жокмун. Мисалы, «кой» же «козу» деп айтыңыз.");
    const firstAnimal = animals[0];
    const firstQuantity = parseVoiceNumber(words, firstAnimal.index);
    if (!firstQuantity || firstQuantity > 100000) throw new Error("Малдын санын ар бир түрдүн алдында айтыңыз.");
    const previousWords = `${words[firstAnimal.index - 2] || ""} ${words[firstAnimal.index - 1] || ""}`.trim();
    const countWords = /^\d{1,5}$/u.test(words[firstAnimal.index - 1] || "")
      ? 1
      : Object.hasOwn(VOICE_NUMBERS, previousWords) ? 2 : 1;
    const nameWords = words.slice(0, firstAnimal.index - countWords);
    const name = nameWords.join(" ").trim();
    if (!name) throw new Error("Алгач мал ээсинин атын айтыңыз.");

    const matchedPeople = livePeople().filter((person) => normalizeVoiceText(person.name) === name);
    if (matchedPeople.length !== 1) {
      throw new Error(matchedPeople.length ? "Мындай ат менен бир нече адам бар. Так атын айтыңыз." : `«${name}» деген адам табылган жок. Атты катталгандай айтыңыз.`);
    }
    const person = matchedPeople[0];
    const changes = animals.map(({ index, key }) => {
      const quantity = parseVoiceNumber(words, index);
      if (!quantity || quantity > 100000) throw new Error(`${COUNT_LABELS[key] || "Мал"} санын так айтыңыз.`);
      if (key === "cows") throw new Error("Уй жеке анкета менен эсептелет. Үн аркылуу уйду тандап чыгаруу азырынча колдоого алынбайт.");
      return { animalKey: key, quantity };
    });
    const grouped = new Map();
    for (const change of changes) grouped.set(change.animalKey, (grouped.get(change.animalKey) || 0) + change.quantity);
    for (const [animalKey, quantity] of grouped) {
      const available = (state.data.movements || [])
        .filter((movement) => movement.personId === person.id && movement.animalKey === animalKey && movement.date <= localDate())
        .reduce((sum, movement) => sum + (Number(movement.delta) || 0), 0);
      if (quantity > (Number(person[animalKey]) || 0) || quantity > available) {
        throw new Error(`${person.name} үчүн ${COUNT_LABELS[animalKey].toLocaleLowerCase("ky")} ${available} баш гана бар. Санын текшериңиз.`);
      }
    }
    return { personId: person.id, changes: [...grouped].map(([animalKey, quantity]) => ({ animalKey, quantity })) };
  }

  function speakVoiceMessage(message) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "ky-KG";
    window.speechSynthesis.speak(utterance);
  }

  function setVoiceListening(listening) {
    $("#voiceButton").classList.toggle("listening", listening);
    $("#voiceButtonText").textContent = listening ? "Угуп жатам…" : "Буйрук айтуу";
    $("#voiceButton").setAttribute("aria-label", listening ? "Угуп жатат" : "Үн буйругун айтуу");
  }

  function handleVoiceTranscript(transcript, confidence = 1) {
    const spoken = String(transcript || "").trim();
    if (!spoken) {
      $("#voiceStatus").textContent = "Үн так угулган жок. Дагы бир жолу айтыңыз.";
      return;
    }
    if (confidence < 0.45) {
      $("#voiceStatus").textContent = `«${spoken}» так угулган жок. Жакыныраак айтып көрүңүз.`;
      return;
    }
    $("#voiceStatus").textContent = `Угулган сөз: «${spoken}».`;
    if (state.voicePending) {
      const answer = normalizeVoiceText(spoken);
      if (["ооба", "туура", "макул", "аткар"].includes(answer)) {
        confirmVoiceCommand().catch((error) => {
          $("#voiceStatus").textContent = error.message;
          console.error("Үн буйругун сактоо ишке ашкан жок:", error);
        });
      } else if (["жок", "жокко чыгар", "токтот"].includes(answer)) {
        cancelVoiceCommand();
      } else {
        $("#voiceStatus").textContent = "Өзгөртүү үчүн «ооба», токтотуу үчүн «жок» деп айтыңыз.";
        speakVoiceMessage("Ооба деп ырастайсызбы же жок деп токтотосузбу?");
      }
      return;
    }
    try {
      ensureCostTracking();
      const parsed = parseVoiceCommand(spoken);
      const person = personById(parsed.personId);
      state.voicePending = { ...parsed, transcript: spoken };
      const summary = parsed.changes.map((change) => `${change.quantity} ${COUNT_LABELS[change.animalKey].toLocaleLowerCase("ky")}`).join(", ");
      const message = `${person.name} үчүн ${summary} мал чарбадан чыкты. «Ооба» деп ырастайсызбы?`;
      $("#voiceTranscript").textContent = message;
      $("#voiceConfirmation").hidden = false;
      $("#voiceStatus").textContent = "Өзгөртүүнү сактоо үчүн «Ооба» деп айтыңыз же ырастоо баскычын басыңыз.";
      speakVoiceMessage(message);
    } catch (error) {
      $("#voiceStatus").textContent = error.message;
      speakVoiceMessage(error.message);
    }
  }

  function onNativeSpeechResult(transcript) {
    setVoiceListening(false);
    handleVoiceTranscript(transcript);
  }

  function onNativeSpeechError(message) {
    setVoiceListening(false);
    $("#voiceStatus").textContent = message || "Үн таануу иштеген жок. Микрофон уруксатын текшериңиз.";
  }

  window.onNativeSpeechResult = onNativeSpeechResult;
  window.onNativeSpeechError = onNativeSpeechError;

  function startVoiceInput() {
    if (state.voiceRecognition) {
      state.voiceRecognition.stop();
      return;
    }
    $("#voiceStatus").textContent = state.voicePending
      ? "Өзгөртүү үчүн «ооба», токтотуу үчүн «жок» деп айтыңыз."
      : "Микрофонду басып, буйрукту толук айтыңыз.";
    setVoiceListening(true);
    if (window.MalesepVoice?.startSpeechRecognition) {
      try {
        window.MalesepVoice.startSpeechRecognition();
      } catch (error) {
        setVoiceListening(false);
        $("#voiceStatus").textContent = "Телефондун үн таануу кызматын ачуу мүмкүн болгон жок.";
        console.error("Android үн таануу башталган жок:", error);
      }
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceListening(false);
      $("#voiceStatus").textContent = "Бул браузер үн таанууну колдобойт. Chrome же Android колдонмосун колдонуп көрүңүз.";
      return;
    }
    const recognition = new SpeechRecognition();
    state.voiceRecognition = recognition;
    recognition.lang = "ky-KG";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const result = event.results?.[0]?.[0];
      handleVoiceTranscript(result?.transcript || "", result?.confidence ?? 1);
    };
    recognition.onerror = (event) => {
      const errors = {
        "not-allowed": "Микрофонго уруксат берилген жок. Браузердин жөндөөлөрүнөн уруксат бериңиз.",
        "no-speech": "Үн угулган жок. Микрофонду басып кайра айтыңыз.",
        "language-not-supported": "Түзмөктө кыргызча үн таануу жеткиликсиз."
      };
      $("#voiceStatus").textContent = errors[event.error] || "Үн таанууда ката чыкты. Кайра аракет кылыңыз.";
    };
    recognition.onend = () => {
      state.voiceRecognition = null;
      setVoiceListening(false);
    };
    try {
      recognition.start();
    } catch (error) {
      state.voiceRecognition = null;
      setVoiceListening(false);
      $("#voiceStatus").textContent = "Микрофон ишке кирген жок. Бир аздан кийин кайра аракет кылыңыз.";
      console.error("Үн таануу башталган жок:", error);
    }
  }

  async function confirmVoiceCommand() {
    const pending = state.voicePending;
    if (!pending) return;
    const person = personById(pending.personId);
    if (!person) {
      cancelVoiceCommand();
      $("#voiceStatus").textContent = "Бул адам табылган жок. Өзгөртүү сакталган жок.";
      return;
    }
    ensureCostTracking();
    for (const change of pending.changes) {
      const available = (state.data.movements || [])
        .filter((movement) => movement.personId === person.id && movement.animalKey === change.animalKey && movement.date <= localDate())
        .reduce((sum, movement) => sum + (Number(movement.delta) || 0), 0);
      if (change.quantity > (Number(person[change.animalKey]) || 0) || change.quantity > available) {
        cancelVoiceCommand();
        $("#voiceStatus").textContent = "Малдын саны өзгөрүптүр. Эсеп жаңыртылган жок; кайра текшериңиз.";
        return;
      }
    }
    for (const change of pending.changes) {
      person[change.animalKey] -= change.quantity;
      appendMovement(person.id, change.animalKey, -change.quantity);
      state.data.events.push({
        id: uid(), personId: person.id, category: change.animalKey === "horses" ? "horse" : "sheep",
        animalKey: change.animalKey, animalLabel: COUNT_LABELS[change.animalKey], quantity: change.quantity,
        cowId: "", kind: "removed", date: localDate(), note: `Үн буйругу: ${pending.transcript}`,
        attachments: [], createdAt: now(), updatedAt: now()
      });
    }
    person.updatedAt = now();
    state.voicePending = null;
    $("#voiceConfirmation").hidden = true;
    await saveState();
    $("#voiceStatus").textContent = `${person.name} үчүн малдын саны жаңыртылып, тарыхка сакталды.`;
    speakVoiceMessage("Малдын саны жаңыртылып сакталды.");
  }

  function cancelVoiceCommand() {
    state.voicePending = null;
    $("#voiceConfirmation").hidden = true;
    $("#voiceStatus").textContent = "Өзгөртүү жокко чыгарылды. Эч нерсе сакталган жок.";
    speakVoiceMessage("Өзгөртүү жокко чыгарылды.");
  }

  function attachModal(title, subtitle, content, onReady) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <header class="modal-header"><div><div class="eyebrow">МАЛЭСЕП · ЖЕКЕ КАБИНЕТ</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button class="modal-close" aria-label="Жабуу">×</button></header>
      <div class="modal-body">${content}</div></section></div>`;
    $(".modal-close", root).addEventListener("click", closeModal);
    $(".modal-backdrop", root).addEventListener("click", (event) => { if (event.target.classList.contains("modal-backdrop")) closeModal(); });
    document.addEventListener("keydown", escapeModal, { once: true });
    if (onReady) onReady();
  }

  function escapeModal(event) {
    if (event.key === "Escape") closeModal();
    else document.addEventListener("keydown", escapeModal, { once: true });
  }

  function closeModal() {
    $("#modalRoot").innerHTML = "";
  }

  function countField(key, label, value) {
    return `<label class="field">${label}<input name="${key}" type="number" min="0" max="100000" step="1" value="${Number(value) || 0}" required></label>`;
  }

  async function authenticateCloud(email, password) {
    const result = state.isRegister
      ? await authRequest("signup", {
        email,
        password,
        data: { display_name: email.split("@")[0] }
      })
      : await authRequest("token?grant_type=password", { email, password });

    if (!result.access_token || !result.user?.id) {
      if (state.isRegister && result.user?.id) {
        state.isRegister = false;
        $("#passwordInput").value = "";
        showAuth("Каттоо кабыл алынды. Email дарегиңизди текшерип, андан кийин кириңиз.", true);
        return;
      }
      throw new Error("Аккаунтка кирүү маалыматы серверден алынган жок.");
    }

    const session = {
      token: result.access_token,
      refreshToken: result.refresh_token || "",
      userId: result.user.id,
      email: String(result.user.email || email).toLowerCase(),
      username: result.user.user_metadata?.display_name || email.split("@")[0]
    };
    const cached = await localGet(`data:${session.email}`) || emptyData();
    if (await localGet(pinResetKey(session.userId))) {
      await localSet(pinStorageKey(session.userId), null);
      await localSet(pinResetKey(session.userId), null);
    }
    await localSet("session", session);
    $("#passwordInput").value = "";
    await continueAccountAccess(session, cached);
  }

  function openSettings() {
    ensureCostTracking();
    attachModal("Багуу тарифтерин өзгөртүү",
      "Баалар сом/баш/күн менен эсептелет. Өзгөртүү бүгүнтөн тартып колдонулат.",
      `<form id="settingsForm"><div class="form-grid">
        <div class="section-label">КОЙ-ЭЧКИ</div>
        <label class="field">Кой · сом/баш/күн<input name="sheep" type="number" min="0" max="1000000" step="1" value="${state.data.settings.dailyRates.sheep}" required></label>
        <label class="field">Козу · сом/баш/күн<input name="lambs" type="number" min="0" max="1000000" step="1" value="${state.data.settings.dailyRates.lambs}" required></label>
        <label class="field">Эчки · сом/баш/күн<input name="goats" type="number" min="0" max="1000000" step="1" value="${state.data.settings.dailyRates.goats}" required></label>
        <label class="field">Улак · сом/баш/күн<input name="kids" type="number" min="0" max="1000000" step="1" value="${state.data.settings.dailyRates.kids}" required></label>
        <div class="section-label">БАШКА МАЛ</div>
        <label class="field">Уй · сом/баш/күн<input name="cows" type="number" min="0" max="1000000" step="1" value="${state.data.settings.dailyRates.cows}" required></label>
        <label class="field">Жылкы · сом/баш/күн<input name="horses" type="number" min="0" max="1000000" step="1" value="${state.data.settings.dailyRates.horses}" required></label>
      </div><p class="media-note">Мал кошулган күн эсепке кирет. Өлгөн же алып кеткен малдын баасы окуя болгон күндөн тартып эсептелбейт. Баа өзгөртүүсү мурунку күндөрдүн тарифин сактайт.</p>
      <div class="modal-actions"><span></span><div class="modal-actions-right"><button type="button" class="outline-button" data-close>Жабуу</button><button class="primary-button" type="submit">Бааларды сактоо</button></div></div></form>`);
    $("[data-close]").addEventListener("click", closeModal);
    $("#settingsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const rates = Object.fromEntries(STOCK_KEYS.map((key) => [key, validRate(values.get(key), DEFAULT_RATES[key])]));
      const changedAt = now();
      state.data.settings = { ...state.data.settings, dailyRates: rates };
      state.data.settingsUpdatedAt = changedAt;
      state.data.rateHistory.push({ id: uid(), date: localDate(), rates: { ...rates }, updatedAt: changedAt });
      closeModal();
      await saveState();
      toast("Багуу тарифтери сакталды.");
    });
  }

  function openPersonForm(person = null) {
    const editing = Boolean(person);
    attachModal(editing ? "Адамдын эсебин өзгөртүү" : "Жаңы адам кошуу",
      "Малдын санын киргизиңиз. Кийин өзгөртө аласыз.",
      `<form id="personForm"><div class="form-grid">
        <label class="field full">Адамдын аты-жөнү<input name="name" required maxlength="80" value="${escapeHtml(person?.name || "")}" placeholder="Мисалы: Бакытбек уулу Нурлан"></label>
        <div class="section-label">КОЙ ЖАНА ЭЧКИ</div>
        ${countField("sheep", "Кой", person?.sheep)}${countField("lambs", "Козу", person?.lambs)}
        ${countField("goats", "Эчки", person?.goats)}${countField("kids", "Улак", person?.kids)}
        <div class="section-label">БАШКА МАЛ</div>
        ${countField("horses", "Жылкы", person?.horses)}
      </div><div id="personError" class="modal-error"></div>
      <div class="modal-actions">${editing ? `<button type="button" class="danger-button" id="removePerson">Адамды өчүрүү</button>` : "<span></span>"}<div class="modal-actions-right"><button type="button" class="outline-button" data-close>Жабуу</button><button class="primary-button" type="submit">Сактоо</button></div></div></form>`);
    const form = $("#personForm");
    $("[data-close]").addEventListener("click", closeModal);
    $("#removePerson")?.addEventListener("click", () => deletePerson(person.id));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      ensureCostTracking();
      const values = new FormData(form);
      const name = String(values.get("name") || "").trim();
      if (!name) return;
      const updated = { ...(person || { id: uid(), cows: [], createdAt: now() }), name, updatedAt: now() };
      STOCK_KEYS.filter((key) => key !== "cows").forEach((key) => {
        const previous = editing ? animalBalance(person, key) : 0;
        updated[key] = Math.max(0, parseInt(values.get(key), 10) || 0);
        appendMovement(updated.id, key, updated[key] - previous);
      });
      if (editing) state.data.people = state.data.people.map((item) => item.id === person.id ? updated : item);
      else state.data.people.push(updated);
      closeModal();
      await saveState();
      toast(editing ? "Адамдын эсеби жаңыртылды." : "Адам чарбага кошулду.");
    });
  }

  async function deletePerson(id) {
    const person = personById(id);
    if (!person || !confirm(`${person.name} аттуу адамды жана анын малын өчүрөсүзбү? Окуялар тарыхы калат.`)) return;
    ensureCostTracking();
    STOCK_KEYS.forEach((key) => appendMovement(person.id, key, -animalBalance(person, key)));
    person.deleted = true;
    person.updatedAt = now();
    closeModal();
    await saveState();
    toast("Адамдын эсеби өчүрүлдү.");
  }

  function fileToData(file) {
    return new Promise((resolve, reject) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Сүрөттү окуу мүмкүн болгон жок."));
        reader.onload = () => {
          const image = new Image();
          image.onerror = () => resolve({ name: file.name, type: file.type, data: reader.result });
          image.onload = () => {
            const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
            if (scale === 1 && file.size < 2 * 1024 * 1024) {
              resolve({ name: file.name, type: file.type, data: reader.result });
              return;
            }
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(image.width * scale);
            canvas.height = Math.round(image.height * scale);
            canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
            const data = canvas.toDataURL("image/jpeg", 0.82);
            resolve({ name: file.name.replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg", data });
          };
          image.src = reader.result;
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Видеону окуу мүмкүн болгон жок."));
        reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
        reader.readAsDataURL(file);
      }
    });
  }

  function mediaTile(item, index, remove) {
    const preview = item.type?.startsWith("video/")
      ? `<video src="${item.data || ""}" muted playsinline></video>`
      : `<img src="${item.data || ""}" alt="${escapeHtml(item.name || "Файл")}">`;
    return `<span class="preview-tile">${preview}<button type="button" aria-label="Файлды алып салуу" data-remove-media="${index}">×</button></span>`;
  }

  async function handleMediaSelection(input, target, change) {
    const files = [...input.files];
    input.value = "";
    for (const file of files) {
      const max = file.type.startsWith("video/") ? 25 * 1024 * 1024 : 12 * 1024 * 1024;
      if (file.size > max) {
        toast(file.type.startsWith("video/") ? "Видео 25 МБдан кичине болсун." : "Сүрөт 12 МБдан кичине болсун.");
        continue;
      }
      target.push(await fileToData(file));
    }
    change();
  }

  function mediaInputsHtml(key, label, includeVideo = false) {
    const accept = includeVideo ? "image/*,video/*" : "image/*";
    const capture = includeVideo ? "" : ' capture="environment"';
    return `<div class="field full"><span>${label}</span><div class="media-controls">
      <label class="media-pick">▣ Сүрөткө тартуу<input type="file" accept="${accept}"${capture} multiple data-media="${key}" data-source="camera"></label>
      <label class="media-pick">▱ Галереядан тандоо<input type="file" accept="${accept}" multiple data-media="${key}"></label>
      ${includeVideo ? `<label class="media-pick">▷ Видео кошуу<input type="file" accept="video/*" multiple data-media="${key}"></label>` : ""}
    </div><div class="media-note">Бир нече сүрөт же видео кошсоңуз болот. Сүрөт 12 МБга, видео 25 МБга чейин.</div><div class="preview-strip" data-preview="${key}"></div></div>`;
  }

  function bindMediaPicker(key, items) {
    $$(`input[data-media="${key}"]`).forEach((input) => input.addEventListener("change", async () => {
      try {
        await handleMediaSelection(input, items, () => paintMediaPreview(key, items));
      } catch (error) {
        toast(error.message);
      }
    }));
    paintMediaPreview(key, items);
  }

  function paintMediaPreview(key, items) {
    const preview = $(`[data-preview="${key}"]`);
    if (!preview) return;
    preview.innerHTML = items.map((item, index) => mediaTile(item, index)).join("");
    $$("[data-remove-media]", preview).forEach((button) => button.addEventListener("click", () => {
      items.splice(Number(button.dataset.removeMedia), 1);
      paintMediaPreview(key, items);
    }));
  }

  function openCowForm(person, cow = null) {
    const photos = [...(cow?.photos || [])];
    const tagPhotos = [...(cow?.tagPhotos || [])];
    const markPhotos = [...(cow?.markPhotos || [])];
    const brandPhotos = [...(cow?.brandPhotos || [])];
    attachModal(cow ? "Уйдун анкетасын өзгөртүү" : "Жаңы уй кошуу",
      `${person.name} · уйдун маалыматын жана сүрөттөрүн киргизиңиз.`,
      `<form id="cowForm"><div class="form-grid">
        <label class="field">Кулак биркасынын номери<input name="tag" maxlength="40" value="${escapeHtml(cow?.tag || "")}" placeholder="Мисалы: 024"></label>
        <label class="field">Уйдун өңү-түсү<input name="color" maxlength="50" value="${escapeHtml(cow?.color || "")}" placeholder="Кара ала, кызыл..."></label>
        <label class="field full">Кошумча белги<input name="note" maxlength="250" value="${escapeHtml(cow?.note || "")}" placeholder="Жашы, тукуму же башка маалымат"></label>
        <div class="section-label">СҮРӨТТӨРҮ ЖАНА БЕЛГИЛЕРИ</div>
        ${mediaInputsHtml("cow-photos", "Уйдун сүрөтү")}
        ${mediaInputsHtml("cow-tags", "Кулактагы бирканын сүрөтү")}
        ${mediaInputsHtml("cow-marks", "Кулак эндин сүрөтү")}
        ${mediaInputsHtml("cow-brand", "Таманга басылган тамганын сүрөтү")}
      </div><div id="cowError" class="modal-error"></div>
      <div class="modal-actions">${cow ? `<button type="button" class="danger-button" id="retireCow">Уйду чарбадан чыгаруу</button>` : "<span></span>"}<div class="modal-actions-right"><button type="button" class="outline-button" data-close>Жабуу</button><button class="primary-button" type="submit">Сактоо</button></div></div></form>`);
    const arrays = { "cow-photos": photos, "cow-tags": tagPhotos, "cow-marks": markPhotos, "cow-brand": brandPhotos };
    Object.entries(arrays).forEach(([key, items]) => bindMediaPicker(key, items));
    $("[data-close]").addEventListener("click", closeModal);
    $("#retireCow")?.addEventListener("click", () => openEventForm(person, "cow", cow));
    $("#cowForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      ensureCostTracking();
      const values = new FormData(event.currentTarget);
      const next = {
        ...(cow || { id: uid(), status: "active", createdAt: now() }),
        tag: String(values.get("tag") || "").trim(),
        color: String(values.get("color") || "").trim(),
        note: String(values.get("note") || "").trim(),
        photos, tagPhotos, markPhotos, brandPhotos,
        status: "active",
        updatedAt: now()
      };
      person.cows = person.cows || [];
      if (cow) person.cows = person.cows.map((item) => item.id === cow.id ? next : item);
      else {
        person.cows.push(next);
        appendMovement(person.id, "cows", 1, localDate(), next.id);
      }
      person.updatedAt = now();
      closeModal();
      await saveState();
      toast(cow ? "Уйдун анкетасы жаңыртылды." : "Уй чарбага кошулду.");
    });
  }

  function openEventForm(person, defaultCategory, cow = null) {
    const category = cow ? "cow" : (defaultCategory || state.category);
    const attachments = [];
    const options = category === "sheep"
      ? [["sheep", "Кой"], ["lambs", "Козу"], ["goats", "Эчки"], ["kids", "Улак"]]
      : category === "horse" ? [["horses", "Жылкы"]] : [];
    const cowOptions = liveCows(person);
    if (category === "cow" && !cow && !cowOptions.length) {
      toast("Адегенде уйдун анкетасын кошуңуз.");
      return;
    }
    attachModal("Мал чарбадан чыкты",
      "Өлгөн же алып кеткен малдын саны, күнү жана далили катталат.",
      `<form id="eventForm"><div class="form-grid">
        <label class="field">Окуянын түрү<select name="kind"><option value="death">Өлүп калды</option><option value="removed">Алып кетти / сатылды</option></select></label>
        <label class="field">Окуя болгон күн<input type="date" name="date" min="${escapeHtml(state.data.costTrackingStarted || localDate())}" required value="${localDate()}"></label>
        ${cow ? `<div class="field full"><span>Уй</span><input value="${escapeHtml([cow.tag, cow.color].filter(Boolean).join(" · ") || "Биркасыз уй")}" disabled><input type="hidden" name="cowId" value="${escapeHtml(cow.id)}"></div>` : category === "cow" ? `<label class="field full">Уй<select name="cowId" required>${cowOptions.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml([item.tag || "Биркасыз", item.color].filter(Boolean).join(" · "))}</option>`).join("")}</select></label>` : `
          <label class="field">Малдын түрү<select name="animalKey">${options.map(([key, label]) => `<option value="${key}">${label} · ${Number(person[key]) || 0} баш бар</option>`).join("")}</select></label>
          <label class="field">Саны<input name="quantity" type="number" min="1" step="1" value="1" required></label>`}
        <label class="field full">Кыскача маалымат<textarea name="note" maxlength="300" placeholder="Кошумча түшүндүрмө (милдеттүү эмес)"></textarea></label>
        ${mediaInputsHtml("event-media", "Сүрөт / видео тиркөө", true)}
      </div><div id="eventError" class="modal-error"></div>
      <div class="modal-actions"><span></span><div class="modal-actions-right"><button type="button" class="outline-button" data-close>Жабуу</button><button class="primary-button" type="submit">Окуяны сактоо</button></div></div></form>`);
    bindMediaPicker("event-media", attachments);
    $("[data-close]").addEventListener("click", closeModal);
    $("#eventForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      ensureCostTracking();
      const form = event.currentTarget;
      const values = new FormData(form);
      const kind = String(values.get("kind"));
      const date = String(values.get("date"));
      let animalKey = "";
      let quantity = 1;
      let cowId = "";
      let animalLabel = "уй";
      if (category === "cow") {
        cowId = String(values.get("cowId") || "");
        const target = cowById(person, cowId);
        if (!target || target.status === "inactive") {
          $("#eventError").textContent = "Бул уй чарбада жок.";
          return;
        }
      } else {
        animalKey = String(values.get("animalKey"));
        quantity = Math.max(1, parseInt(String(values.get("quantity")), 10) || 1);
        animalLabel = COUNT_LABELS[animalKey];
        const availableByDate = (state.data.movements || [])
          .filter((movement) => movement.personId === person.id && movement.animalKey === animalKey && movement.date <= date)
          .reduce((sum, movement) => sum + (Number(movement.delta) || 0), 0);
        if (!options.some(([key]) => key === animalKey) || quantity > (Number(person[animalKey]) || 0) || quantity > availableByDate) {
          $("#eventError").textContent = "Саны учурдагы малдын санынан көп болбошу керек.";
          return;
        }
      }
      if (!date) {
        $("#eventError").textContent = "Окуя болгон күндү тандаңыз.";
        return;
      }
      if (date < (state.data.costTrackingStarted || localDate())) {
        $("#eventError").textContent = "Окуянын күнү чыгымды эсептөө башталган күндөн эрте боло албайт.";
        return;
      }
      if (category === "cow") {
        const target = cowById(person, cowId);
        const availableByDate = (state.data.movements || [])
          .filter((movement) => movement.personId === person.id && movement.animalKey === "cows" && movement.entityId === target.id && movement.date <= date)
          .reduce((sum, movement) => sum + (Number(movement.delta) || 0), 0);
        if (availableByDate < 1) {
          $("#eventError").textContent = "Тандалган күндө бул уй чарбада болгонун текшериңиз.";
          return;
        }
        target.status = "inactive";
        target.updatedAt = now();
        appendMovement(person.id, "cows", -1, date, target.id);
      } else {
        person[animalKey] -= quantity;
        appendMovement(person.id, animalKey, -quantity, date);
      }
      person.updatedAt = now();
      state.data.events.push({
        id: uid(), personId: person.id, category, animalKey, animalLabel, quantity, cowId,
        kind, date, note: String(values.get("note") || "").trim(), attachments,
        createdAt: now(), updatedAt: now()
      });
      closeModal();
      await saveState();
      toast("Окуя жана датасы сакталды. Жалпы малдын саны жаңырды.");
    });
  }

  function mediaGallery(items) {
    if (!items?.length) return "";
    return `<div class="cow-photo-row">${items.map((item) => item.type?.startsWith("video/")
      ? `<video src="${item.data || ""}" controls></video>`
      : `<img src="${item.data || ""}" alt="${escapeHtml(item.name || "Малдын сүрөтү")}">`).join("")}</div>`;
  }

  function openDetails(person) {
    const ownerEvents = state.data.events.filter((event) => event.personId === person.id && !event.deleted).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const cows = (person.cows || []).filter((cow) => !cow.deleted);
    const personDailyCost = Object.values(dailyCostBreakdown(localDate(), person.id)).reduce((sum, amount) => sum + amount, 0);
    const personLifetimeCost = state.data.costTrackingStarted
      ? accumulatedCost(state.data.costTrackingStarted, localDate(), person.id)
      : 0;
    attachModal(person.name, "Малдын эсеби · уйдун анкеталары · чарбанын тарыхы",
      `<div class="detail-banner"><span class="person-avatar">${escapeHtml(person.name.trim().charAt(0).toLocaleUpperCase("ky"))}</span><div><strong>${escapeHtml(person.name)}</strong><small>Жалпы мал: ${sumFor(person, "sheep") + sumFor(person, "cow") + sumFor(person, "horse")} баш</small></div></div>
      <div class="count-grid">${["sheep", "lambs", "goats", "kids", "horses"].map((key) => `<div class="count-tile"><span>${COUNT_LABELS[key]}</span><strong>${Number(person[key]) || 0}</strong></div>`).join("")}<div class="count-tile"><span>Уй</span><strong>${liveCows(person).length}</strong></div></div>
      <div class="money-breakdown"><strong>Багуу чыгымы: ${money(personDailyCost)} / күн</strong><br>Каттоо башталгандан бери: <strong>${money(personLifetimeCost)}</strong></div>
      ${cows.length ? `<h3 class="detail-section-title">УЙЛАРДЫН АНКЕТАСЫ</h3>${cows.map((cow) => `<div class="cow-detail"><div class="cow-detail-top"><span class="cow-placeholder"></span><span><strong>${escapeHtml(cow.tag || "Биркасыз уй")} · ${escapeHtml(cow.color || "Өңү көрсөтүлгөн эмес")}</strong><small>${cow.status === "inactive" ? "Чарбадан чыккан" : "Чарбада"}${cow.note ? ` · ${escapeHtml(cow.note)}` : ""}</small></span></div>${mediaGallery([...(cow.photos || []), ...(cow.tagPhotos || []), ...(cow.markPhotos || []), ...(cow.brandPhotos || [])])}</div>`).join("")}` : ""}
      <h3 class="detail-section-title">ӨЛҮМ / АЛЫП КЕТҮҮ ТАРЫХЫ</h3>
      ${ownerEvents.length ? ownerEvents.map((record) => `<div class="event-record-card"><strong>${record.kind === "death" ? "Өлүп калды" : "Алып кетти / сатылды"}</strong> · ${record.category === "cow" ? "1 уй" : `${record.quantity} ${escapeHtml(record.animalLabel)}`} · ${formatDate(record.date)}${record.note ? `<br>${escapeHtml(record.note)}` : ""}${mediaGallery(record.attachments)}</div>`).join("") : `<p class="muted">Катталган окуя жок.</p>`}
      <div class="modal-actions"><span></span><button type="button" class="primary-button" data-close>Даяр</button></div>`);
    $("[data-close]").addEventListener("click", closeModal);
  }

  function bindControls() {
    $("#pinForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("#pinSubmit");
      const pin = $("#pinInput").value;
      const setup = !$("#pinConfirmLabel").hidden;
      button.disabled = true;
      try {
        if (!/^\d{4}$/u.test(pin)) throw new Error("PIN-код так 4 сандан турушу керек.");
        if (!state.pendingAccount) throw new Error("Аккаунттун маалыматы табылган жок. Кайра кириңиз.");
        if (setup) {
          if (pin !== $("#pinConfirmInput").value) throw new Error("Эки PIN-код дал келген жок. Кайра текшериңиз.");
          const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
          const hash = await hashPin(pin, salt);
          await localSet(pinStorageKey(state.pendingAccount.session.userId), { salt, hash, iterations: 310000, failures: 0, blockedUntil: 0 });
        } else {
          const record = await localGet(pinStorageKey(state.pendingAccount.session.userId));
          if (!record) {
            showPinScreen("setup", "PIN-код табылган жок. Жаңы код түзүңүз.");
            return;
          }
          if (Number(record.blockedUntil) > Date.now()) {
            const seconds = Math.ceil((record.blockedUntil - Date.now()) / 1000);
            throw new Error(`Коопсуздук үчүн убактылуу бөгөт коюлду. ${seconds} секунддан кийин кайра аракет кылыңыз.`);
          }
          const candidate = await hashPin(pin, record.salt, record.iterations);
          if (!sameHash(candidate, record.hash)) {
            record.failures = (Number(record.failures) || 0) + 1;
            record.blockedUntil = record.failures >= 5 ? Date.now() + 30000 : 0;
            if (record.failures >= 5) record.failures = 0;
            await localSet(pinStorageKey(state.pendingAccount.session.userId), record);
            throw new Error(record.blockedUntil ? "PIN-код туура эмес. 5 жолу жаңылыш киргизилди; 30 секунддан кийин аракет кылыңыз." : "PIN-код туура эмес. Кайра аракет кылыңыз.");
          }
          record.failures = 0;
          record.blockedUntil = 0;
          await localSet(pinStorageKey(state.pendingAccount.session.userId), record);
        }
        await unlockAccount();
      } catch (error) {
        $("#pinMessage").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    $("#forgotPinButton").addEventListener("click", async () => {
      if (!state.pendingAccount) return;
      if (!confirm("PIN-кодду кайра коюу үчүн аккаунттун email сырсөзү менен кирүү керек. Улантасызбы?")) return;
      const userId = state.pendingAccount.session.userId;
      const email = state.pendingAccount.session.email;
      try {
        await localSet(pinResetKey(userId), true);
        await localSet("session", null);
        state.pendingAccount = null;
        state.token = "";
        state.refreshToken = "";
        state.userId = "";
        state.pinUserId = "";
        state.email = "";
        state.username = "";
        state.data = emptyData();
        $("#usernameInput").value = email;
        showAuth("PIN-кодду кайра коюу үчүн email жана сырсөз менен кириңиз.");
      } catch (error) {
        $("#pinMessage").textContent = error.message;
      }
    });
    $("#lockButton").addEventListener("click", async () => {
      state.voicePending = null;
      $("#voiceConfirmation").hidden = true;
      try {
        const session = {
          token: state.token, refreshToken: state.refreshToken, userId: state.pinUserId || state.userId,
          email: state.email, username: state.username
        };
        await requestAccountAccess(session, state.data);
      } catch (error) {
        toast(error.message);
      }
    });
    $("#voiceButton").addEventListener("click", startVoiceInput);
    $("#confirmVoiceButton").addEventListener("click", () => {
      confirmVoiceCommand().catch((error) => {
        $("#voiceStatus").textContent = error.message;
        console.error("Үн буйругун сактоо ишке ашкан жок:", error);
      });
    });
    $("#cancelVoiceButton").addEventListener("click", cancelVoiceCommand);
    $$(".category-tab").forEach((button) => button.addEventListener("click", () => {
      state.category = button.dataset.category;
      state.expanded = "";
      render();
    }));
    $("#addPersonButton").addEventListener("click", () => openPersonForm());
    $("#settingsButton").addEventListener("click", openSettings);
    $$(".cost-settings-link").forEach((button) => button.addEventListener("click", openSettings));
    $("#emptyAddButton").addEventListener("click", () => openPersonForm());
    $("#peopleSearch").addEventListener("input", (event) => {
      state.search = event.target.value;
      render();
      $("#peopleSearch").focus();
      $("#peopleSearch").setSelectionRange(state.search.length, state.search.length);
    });
    $("#peopleList").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) {
        if (event.target.closest("[data-open-settings]")) openSettings();
        return;
      }
      const { action, id, cow: cowId } = button.dataset;
      const person = personById(id);
      if (!person) return;
      if (action === "toggle") {
        state.expanded = state.expanded === id ? "" : id;
        render();
      } else if (action === "edit-person") openPersonForm(person);
      else if (action === "details-person") openDetails(person);
      else if (action === "delete-person") deletePerson(id);
      else if (action === "add-cow") openCowForm(person);
      else if (action === "edit-cow") {
        const cow = cowById(person, cowId);
        if (cow) openCowForm(person, cow);
      } else if (action === "add-event") openEventForm(person);
    });
    $("#switchAuth").addEventListener("click", () => {
      state.isRegister = !state.isRegister;
      showAuth();
    });
    $("#resetPasswordButton").addEventListener("click", async () => {
      const button = $("#resetPasswordButton");
      const email = $("#usernameInput").value.trim().toLowerCase();
      if (!email) {
        showAuth("Сырсөздү калыбына келтирүү үчүн email дарегиңизди жазыңыз.");
        $("#usernameInput").focus();
        return;
      }
      if (!navigator.onLine) {
        showAuth("Калыбына келтирүү шилтемесин жөнөтүү үчүн интернетке туташыңыз.");
        return;
      }
      button.disabled = true;
      try {
        const { redirectUrl } = supabaseConfig();
        await authRequest(`recover?redirect_to=${encodeURIComponent(redirectUrl)}`, { email });
        showAuth("Сырсөздү жаңыртуу шилтемеси email дарегиңизге жөнөтүлдү.", true);
      } catch (error) {
        showAuth(error.message);
      } finally {
        button.disabled = false;
      }
    });
    $("#authForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("#authSubmit");
      button.disabled = true;
      $("#authMessage").textContent = "";
      try {
        const password = $("#passwordInput").value;
        if (password.length < 8 || password.length > 128) throw new Error("Сырсөз кеминде 8 белгиден болушу керек.");
        if (state.recoveryToken) {
          await updateRecoveredPassword(password);
          return;
        }
        if (!navigator.onLine) throw new Error("Жаңы аккаунтка кирүү же катталуу үчүн интернет керек.");
        const email = $("#usernameInput").value.trim().toLowerCase();
        await authenticateCloud(email, password);
      } catch (error) {
        showAuth(error.message);
      } finally {
        button.disabled = false;
      }
    });
    $("#logoutButton").addEventListener("click", async () => {
      if (!confirm("Кабинеттен чыгасызбы? Интернетсиз да сакталган маалымат бул түзмөктө калат.")) return;
      await localSet("session", null);
      state.token = "";
      state.refreshToken = "";
      state.userId = "";
      state.pinUserId = "";
      state.email = "";
      state.username = "";
      state.data = emptyData();
      state.pendingAccount = null;
      state.isRegister = false;
      showAuth("Кабинеттен чыктыңыз.", true);
      setConnection(navigator.onLine ? "" : "offline", navigator.onLine ? "Күтүүдө" : "Офлайн режим");
    });
    window.addEventListener("online", () => {
      setConnection("", "Сервер менен байланышууда");
      if (state.token) synchronize();
    });
    window.addEventListener("offline", () => {
      setConnection("offline", "Офлайн режим");
      if (state.token) $("#syncStatus").textContent = "Интернетсиз · бул түзмөктө сакталды";
    });
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      installPrompt = event;
      $("#installButton").hidden = false;
    });
    $("#installButton").addEventListener("click", async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      $("#installButton").hidden = true;
    });
  }

  async function start() {
    bindControls();
    setConnection(navigator.onLine ? "" : "offline", navigator.onLine ? "Байланыш бар" : "Офлайн режим");
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch((error) => console.error("PWA worker катасы:", error));
    }
    const recovery = new URLSearchParams(location.hash.slice(1));
    if (recovery.get("type") === "recovery" && recovery.get("access_token")) {
      state.recoveryToken = recovery.get("access_token");
      showAuth("Жаңы сырсөзүңүздү киргизиңиз.");
      return;
    }
    if (recovery.get("type") === "signup" && recovery.get("access_token")) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      showAuth("Email дарегиңиз ырасталды. Эми аккаунтуңузга кириңиз.", true);
      return;
    }
    try {
      const session = await localGet("session");
      if (session?.token && session?.userId && session?.email && session?.username) {
        const cachedData = await localGet(`data:${session.email}`);
        await continueAccountAccess(session, cachedData);
      } else {
        showAuth(navigator.onLine
          ? ""
          : "Биринчи жолу кирүү үчүн интернет керек. Мурда бул түзмөктөн кирген аккаунт офлайн ачылат.");
      }
    } catch (error) {
      showAuth(error.message);
      setConnection("offline", "Жергиликтүү сактагыч жеткиликсиз");
    }
  }

  start();
})();
