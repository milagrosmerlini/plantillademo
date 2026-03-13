// =====================================================
// Plantilla App de Carrito - Supabase
// =====================================================
const APP_CONFIG = window.APP_CONFIG || {};
const DEFAULT_PRODUCTS_FALLBACK = [
  { sku: "cubanito_comun", name: "Cubanito comun", unit: "Unidad", prices: { presencial: 1000, pedidosya: 1300 } },
  { sku: "cubanito_negro", name: "Cubanito choco negro", unit: "Unidad", prices: { presencial: 1300, pedidosya: 1900 } },
  { sku: "cubanito_blanco", name: "Cubanito choco blanco", unit: "Unidad", prices: { presencial: 1300, pedidosya: 1900 } },
  { sku: "garrapinadas", name: "Garrapiñadas", unit: "Bolsa", prices: { presencial: 1200, pedidosya: 1600 } },
];
const DEFAULT_PRODUCTS = Array.isArray(APP_CONFIG.DEFAULT_PRODUCTS) && APP_CONFIG.DEFAULT_PRODUCTS.length
  ? APP_CONFIG.DEFAULT_PRODUCTS
  : DEFAULT_PRODUCTS_FALLBACK;
const ADMIN_CODE_EMAIL = String(APP_CONFIG.ADMIN_EMAIL || "admin@tu-negocio.com");
const STORAGE_PREFIX = String(APP_CONFIG.STORAGE_PREFIX || "cliente_demo")
  .toLowerCase()
  .replace(/[^a-z0-9_]/g, "_");
const storageKey = (suffix) => `${STORAGE_PREFIX}_${suffix}`;

let products = [];
let sales = [];
let expenses = [];
let session = null;
let isAdmin = false;
const FORCE_GUEST_KEY = storageKey("force_guest");
const ACTIVE_TAB_KEY = storageKey("active_tab");
const LS_PRODUCTS_KEY = storageKey("products_cache");
const LS_SALES_KEY = storageKey("sales_cache");
const LS_EXPENSES_KEY = storageKey("expenses_cache");
const LS_CASH_ADJUST_BY_DAY_KEY = storageKey("cash_adjust_by_day");
const LS_CASH_INITIAL_PERSIST_KEY = storageKey("cash_initial_persist");
const LS_CARRYOVER_BY_MONTH_KEY = storageKey("carryover_by_month");
const LS_PEYA_LIQ_LIST_KEY = storageKey("peya_liq_list");
const LS_HAS_PEYA_LIQ_TABLE_KEY = storageKey("has_peya_liq_table");
const LS_CARRYOVER_HISTORY_LIST_KEY = storageKey("carryover_history_list");
const LS_CAJA_MONTH_HISTORY_KEY = storageKey("caja_month_history");
const LS_OFFLINE_QUEUE_KEY = storageKey("offline_queue_v1");
const LS_ADMIN_REMEMBER_KEY = storageKey("admin_remember");
const DB_ONLY_MODE = true; // fuente unica: Supabase (evita diferencias entre dispositivos)
const STRICT_CLOUD_SYNC = true; // si falla Supabase, no persistimos cambios locales que afecten caja
const DISABLE_LOCAL_DATA_CACHE = true; // evita mostrar datos distintos por cache local del navegador
let forceGuestMode = false;
let activeChannel = "presencial";
let activeTab = "cobrar";
let cartByChannel = { presencial: {}, pedidosya: {} };
let cashAdjustByDay = {};
let carryoverByMonth = {};
let peyaLiquidations = [];
let carryoverHistory = [];
let cajaMonthHistory = [];
let cajaMonthHistoryExpanded = false;
let cashInitialHistoryExpanded = false;
let cashInitialEditDay = "";
let salesTodayExpanded = false;
let historyExpanded = false;
let historyDaySalesExpanded = false;
let currentHistoryDayKey = "";
let hasPeyaLiqTable = true;
let hasCarryoverHistoryTable = true;
let syncingOfflineQueue = false;
let expensesExpanded = false;
let savingSaleInFlight = false;
let savingExpenseInFlight = false;
let infoStatsMode = "day";
let liveSyncTimer = null;
let liveSyncInFlight = false;
let liveSyncChannel = null;
let liveSyncVisibilityBound = false;
let salesLoadState = "unknown";
let expensesLoadState = "unknown";
let productsGridSignature = "";
let deferredUiInitDone = false;
const INFO_STATS_MIN_DAY_KEY = "2026-03-05";
const INFO_STATS_EXCLUDED_DAY_KEYS = new Set(["2026-02-01", "2026-02-03", "2026-02-04"]);
const INFO_STATS_START_HOUR = 15;
const INFO_STATS_END_HOUR = 20;
const INFO_STATS_DAY_WINDOW_MINUTES = 120;
const LIVE_SYNC_POLL_MS = 8000;
const CASH_INITIAL_NEXT_DAY_HOUR = 20;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const money = (n) => Number(n || 0).toLocaleString("es-AR");
const parseNum = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    if (decimalSep === ",") normalized = raw.replace(/\./g, "").replace(",", ".");
    else normalized = raw.replace(/,/g, "");
  } else if (lastComma !== -1) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (lastDot !== -1) {
    const dotCount = (raw.match(/\./g) || []).length;
    if (dotCount > 1) normalized = raw.replace(/\./g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};
const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shiftDayKey = (dayKey, deltaDays = 0) => {
  const [y, m, d] = String(dayKey || "").split("-").map(Number);
  const base = new Date(y || 1970, (m || 1) - 1, d || 1);
  base.setDate(base.getDate() + Number(deltaDays || 0));
  return todayKey(base);
};
const cashInitialTargetDayKey = (d = new Date()) => {
  const day = todayKey(d);
  return d.getHours() >= CASH_INITIAL_NEXT_DAY_HOUR ? shiftDayKey(day, 1) : day;
};
const formatDayKey = (k) => {
  const [y, m, d] = k.split("-");
  return `${d}/${m}/${y}`;
};
const nowTime = (d = new Date()) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const clampQty = (q) => Math.max(0, Math.min(999, Number(q || 0)));
const cartHasItems = (c) => Object.values(c).some((q) => Number(q || 0) > 0);
const hasSupabaseClient = () => Boolean(window.supabase && typeof window.supabase.from === "function" && window.supabase.auth);

const totalEl = $("#total");
const summaryTitleEl = $("#summary-title");
const promoLineEl = $("#promo-line");
const transferLabelEl = $("#transfer-label");
const pedidosyaDiscountBoxEl = $("#pedidosya-discount-box");
const pedidosyaDiscountEl = $("#pedidosya-discount");
const pedidosyaDiscountAmountEl = $("#pedidosya-discount-amount");
const pedidosyaFinalTotalEl = $("#pedidosya-final-total");
const saveMsgEl = $("#save-msg");
const cashEl = $("#cash");
const transferEl = $("#transfer");
const saleDateEl = $("#sale-date");
const diffEl = $("#diff");
const cashChangeAreaEl = $("#cash-change-area");
const cashReceivedEl = $("#cash-received");
const cashChangeEl = $("#cash-change");
const mixedArea = $("#mixed-area");
const salesListEl = $("#sales-list");
const btnSalesMoreEl = $("#btn-sales-more");
const salesMoreWrapEl = $("#sales-more-wrap");
const btnSalesLessTopEl = $("#btn-sales-less-top");
const salesLessTopWrapEl = $("#sales-less-top-wrap");
const kpiTotalEl = $("#kpi-total");
const kpiCashEl = $("#kpi-cash");
const kpiTransferEl = $("#kpi-transfer");
const kpiPeyaEl = $("#kpi-peya");
const kpiTotalNoteEl = $("#kpi-total-note");
const cajaDateEl = $("#caja-date");
const countsEl = $("#counts");
const cashInitialEl = $("#cash-initial");
const cashRealEl = $("#cash-real");
const cashNetEndEl = $("#cash-net-end");
const cashDeltaEl = $("#cash-delta");
const btnCashAdjustSaveEl = $("#btn-cash-adjust-save");
const cashAdjustMsgEl = $("#cash-adjust-msg");
const btnCashInitialSaveEl = $("#btn-cash-initial-save");
const btnCashInitialEditEl = $("#btn-cash-initial-edit");
const cashInitialMsgEl = $("#cash-initial-msg");
const cashInitialHistoryEl = $("#cash-initial-history");
const cashInitialHistoryLessTopWrapEl = $("#cash-initial-history-less-top-wrap");
const btnCashInitialHistoryLessTopEl = $("#btn-cash-initial-history-less-top");
const cashInitialHistoryMoreWrapEl = $("#cash-initial-history-more-wrap");
const btnCashInitialHistoryMoreEl = $("#btn-cash-initial-history-more");
const cashInitialReadonlyWrapEl = $("#cash-initial-readonly-wrap");
const cashInitialReadonlyEl = $("#cash-initial-readonly");
const todayTitleEl = $("#today-title");
const todayTotalEl = $("#today-total");
const todayCountEl = $("#today-count");
const todayCashEl = $("#today-cash");
const todayTransferEl = $("#today-transfer");
const todayPeyaEl = $("#today-peya");
const salesMonthInputEl = $("#sales-month-input");
const monthTotalEl = $("#month-total");
const monthCashEl = $("#month-cash");
const monthTransferEl = $("#month-transfer");
const monthPeyaEl = $("#month-peya");
const monthQtyComunEl = $("#month-qty-comun");
const monthQtyNegroEl = $("#month-qty-negro");
const monthQtyBlancoEl = $("#month-qty-blanco");
const salesMonthExtraEl = $("#sales-month-extra");
const btnSalesMonthMoreEl = $("#btn-sales-month-more");
const btnSalesMonthLessEl = $("#btn-sales-month-less");
const salesMonthMoreWrapEl = $("#sales-month-more-wrap");
const salesMonthLessWrapEl = $("#sales-month-less-wrap");
const cajaMonthInputEl = $("#caja-month-input");
const cajaMonthTotalEl = $("#caja-month-total");
const cajaMonthCashEl = $("#caja-month-cash");
const cajaMonthTransferEl = $("#caja-month-transfer");
const cajaMonthPeyaEl = $("#caja-month-peya");
const cajaMonthHistoryEl = $("#caja-month-history");
const cajaMonthHistoryMoreWrapEl = $("#caja-month-history-more-wrap");
const cajaMonthHistoryLessTopWrapEl = $("#caja-month-history-less-top-wrap");
const cajaMonthHistoryLessBottomWrapEl = $("#caja-month-history-less-bottom-wrap");
const btnCajaMonthHistoryMoreEl = $("#btn-caja-month-history-more");
const btnCajaMonthHistoryLessTopEl = $("#btn-caja-month-history-less-top");
const btnCajaMonthHistoryLessBottomEl = $("#btn-caja-month-history-less-bottom");
const carryoverCashEl = $("#carryover-cash");
const carryoverTransferEl = $("#carryover-transfer");
const carryoverPeyaEl = $("#carryover-peya");
const btnCarryoverSaveEl = $("#btn-carryover-save");
const carryoverMsgEl = $("#carryover-msg");
const carryoverHistoryEl = $("#carryover-history");
const peyaLiqRangeEl = $("#peya-liq-range");
const peyaLiqAmountEl = $("#peya-liq-amount");
const btnPeyaLiqSaveEl = $("#btn-peya-liq-save");
const peyaLiqMsgEl = $("#peya-liq-msg");
const peyaLiqHistoryEl = $("#peya-liq-history");
const cajaRealExtraEl = $("#caja-real-extra");
const btnCajaRealMoreEl = $("#btn-caja-real-more");
const btnCajaRealLessEl = $("#btn-caja-real-less");
const cajaResumenCardEl = $("#caja-resumen-card");
const cajaCarroCardEl = $("#caja-carro-card");
const cajaInicialBlockEl = $("#caja-inicial-block");
const cajaCierreBlockEl = $("#caja-cierre-block");
const cajaMonthCardEl = $("#caja-month-card");
const cajaCarryoverCardEl = $("#caja-carryover-card");
const cajaPeyaCardEl = $("#caja-peya-card");
const cajaExportCardEl = $("#caja-export-card");
const carryoverExtraEl = $("#carryover-extra");
const btnCarryoverMoreEl = $("#btn-carryover-more");
const btnCarryoverLessEl = $("#btn-carryover-less");
const peyaLiqExtraEl = $("#peya-liq-extra");
const btnPeyaLiqMoreEl = $("#btn-peya-liq-more");
const btnPeyaLiqLessEl = $("#btn-peya-liq-less");
const infoExtraEl = $("#info-extra");
const btnInfoMoreEl = $("#btn-info-more");
const btnInfoLessEl = $("#btn-info-less");
const infoRangeEl = $("#info-range");
const infoResultsEl = $("#info-results");
const infoStatsModeDayEl = $("#info-stats-mode-day");
const infoStatsModePeriodEl = $("#info-stats-mode-period");
const infoStatsModeMonthEl = $("#info-stats-mode-month");
const infoStatsDayWrapEl = $("#info-stats-day-wrap");
const infoStatsPeriodWrapEl = $("#info-stats-period-wrap");
const infoStatsMonthWrapEl = $("#info-stats-month-wrap");
const infoStatsDayInputEl = $("#info-stats-day-input");
const infoStatsPeriodInputEl = $("#info-stats-period-input");
const infoStatsMonthInputEl = $("#info-stats-month-input");
const infoStatsSummaryEl = $("#info-stats-summary");
const infoStatsHoursEl = $("#info-stats-hours");
const filterPresCashEl = $("#f-pres-cash");
const filterPresTransferEl = $("#f-pres-transfer");
const filterPyCashEl = $("#f-py-cash");
const filterPyTransferEl = $("#f-py-transfer");
const filterPyPeyaEl = $("#f-py-peya");
const filterExpCashEl = $("#f-exp-cash");
const filterExpTransferEl = $("#f-exp-transfer");
const filterExpPeyaEl = $("#f-exp-peya");
const filterCComunEl = $("#f-c-comun");
const filterCNegroEl = $("#f-c-negro");
const filterCBlancoEl = $("#f-c-blanco");
const historyListEl = $("#history-list");
const historyMoreWrapEl = $("#history-more-wrap");
const btnHistoryMoreEl = $("#btn-history-more");
const historyLessTopWrapEl = $("#history-less-top-wrap");
const btnHistoryLessTopEl = $("#btn-history-less-top");
const historyMoreWrapBottomEl = $("#history-more-wrap-bottom");
const btnHistoryMoreBottomEl = $("#btn-history-more-bottom");
const historyDetailEl = $("#history-detail");
const historyTitleEl = $("#history-title");
const histTotalEl = $("#hist-total");
const histCashEl = $("#hist-cash");
const histTransferEl = $("#hist-transfer");
const histPeyaEl = $("#hist-peya");
const histQtyComunEl = $("#hist-qty-comun");
const histQtyNegroEl = $("#hist-qty-negro");
const histQtyBlancoEl = $("#hist-qty-blanco");
const histSalesListEl = $("#hist-sales-list");
const histSalesMoreWrapEl = $("#hist-sales-more-wrap");
const btnHistSalesMoreEl = $("#btn-hist-sales-more");
const btnHistoryBack = $("#btn-history-back");
const productsGridEl = $("#products-grid");

// Gastos UI
const btnExpenseAdd = $("#btn-expense-add");
const expenseFormWrapEl = $("#expense-form-wrap");
const expenseDateEl = $("#expense-date");
const expenseProviderEl = $("#expense-provider");
const expenseQtyEl = $("#expense-qty");
const expenseDescEl = $("#expense-desc");
const expenseUnitPriceEl = $("#expense-unit-price");
const expenseUnitPriceFieldEl = $("#expense-unit-price-field");
const expenseQtyFieldEl = $("#expense-qty-field");
const expenseDirectAmountFieldEl = $("#expense-direct-amount-field");
const expenseDirectAmountEl = $("#expense-direct-amount");
const expenseSettlementRangeFieldEl = $("#expense-settlement-range-field");
const expenseSettlementRangeEl = $("#expense-settlement-range");
const expenseMethodEl = $("#expense-method");
const expenseMixedWrapEl = $("#expense-mixed-wrap");
const expensePayCashEl = $("#expense-pay-cash");
const expensePayTransferEl = $("#expense-pay-transfer");
const expensePayPeyaEl = $("#expense-pay-peya");
const expenseMixedDiffEl = $("#expense-mixed-diff");
const btnExpenseAddItem = $("#btn-expense-add-item");
const expenseSubtotalEl = $("#expense-subtotal");
const expenseTotalEl = $("#expense-total");
const expenseItemsPreviewEl = $("#expense-items-preview");
const expenseItemsListEl = $("#expense-items-list");
const btnExpenseSave = $("#btn-expense-save");
const btnExpenseCancel = $("#btn-expense-cancel");
const expenseMsgEl = $("#expense-msg");
const expenseListEl = $("#expense-list");
const expenseKpiTotalEl = $("#expense-kpi-total");
const expenseKpiCountEl = $("#expense-kpi-count");
const expenseMoreWrapEl = $("#expense-more-wrap");
const btnExpenseMoreEl = $("#btn-expense-more");
const expenseLessTopWrapEl = $("#expense-less-top-wrap");
const btnExpenseLessTopEl = $("#btn-expense-less-top");
const expenseLessBottomWrapEl = $("#expense-less-bottom-wrap");
const btnExpenseLessBottomEl = $("#btn-expense-less-bottom");
const expenseMonthInputEl = $("#expense-month-input");
const expenseMonthCashEl = $("#expense-month-cash");
const expenseMonthTransferEl = $("#expense-month-transfer");
const expenseMonthPeyaEl = $("#expense-month-peya");
const expenseMonthTotalEl = $("#expense-month-total");
const expenseMonthListEl = $("#expense-month-list");

const EXPENSE_PROVIDERS = [
  "MAXI",
  "PEDIDO YA",
  "MATIAS",
  "ERICA",
  "JULIA",
  "LUZ AZUL",
  "PLASTICOS BLANCOS",
  "SEÑORA",
  "CONTADOR",
  "ARCA",
  "MUNICIPALIDAD",
  "LUGONES",
  "GARRAFAS DON BOSCO",
];
const EXPENSE_DESCRIPTIONS = [
  "CUBANITO COMUN",
  "CUBANITO CHOCOLATE NEGRO",
  "CUBANITO CHOCOLATE BLANCO"
];
const PROVIDER_RULES = {
  MAXI: { descriptions: ["CUBANITO COMUN", "CUBANITO CHOCOLATE NEGRO", "CUBANITO CHOCOLATE BLANCO"], mode: "items" },
  "PEDIDO YA": { descriptions: ["SERVICIOS DE PEDIDO YA", "IMPUESTOS", "CARGOS OPERATIVOS", "COBROS FUERA DE PEYA"], mode: "direct", settlement: true },
  MATIAS: { descriptions: ["EXTRACCION"], mode: "direct" },
  ERICA: { descriptions: ["EXTRACCION"], mode: "direct" },
  JULIA: { descriptions: ["DULCE DE LECHE"], mode: "items" },
  "LUZ AZUL": { descriptions: ["DULCE DE LECHE"], mode: "items" },
  "PLASTICOS BLANCOS": { descriptions: ["BOLSAS GARRAPINADAS", "BOLSAS CAMISETAS", "SERVILLETAS", "GUANTES"], mode: "direct" },
  SENORA: { descriptions: ["GARRAPINADAS"], mode: "direct" },
  CONTADOR: { descriptions: ["HONORARIOS"], mode: "direct" },
  ARCA: { descriptions: ["IMPUESTO MONOTRIBUTO"], mode: "direct" },
  MUNICIPALIDAD: { descriptions: ["IMPUESTO SEGURIDAD E HIGIENE"], mode: "direct" },
  LUGONES: { descriptions: ["CONTROL DE PLAGAS"], mode: "direct" },
  "GARRAFAS DON BOSCO": { descriptions: ["CARGA DE GARRAFA"], mode: "direct" },
};
const ADD_NEW_SELECT_VALUE = "__add_new__";
const MAX_EXPENSE_DESC_LEN = 120;
const LS_EXPENSE_PROVIDERS_KEY = storageKey("expense_providers");
const LS_EXPENSE_DESCRIPTIONS_KEY = storageKey("expense_descriptions");
const LOCAL_DATA_CACHE_KEYS = [
  LS_PRODUCTS_KEY,
  LS_SALES_KEY,
  LS_EXPENSES_KEY,
  LS_CARRYOVER_BY_MONTH_KEY,
  LS_PEYA_LIQ_LIST_KEY,
  LS_HAS_PEYA_LIQ_TABLE_KEY,
  LS_CARRYOVER_HISTORY_LIST_KEY,
  LS_CAJA_MONTH_HISTORY_KEY,
  LS_OFFLINE_QUEUE_KEY,
  LS_EXPENSE_PROVIDERS_KEY,
  LS_EXPENSE_DESCRIPTIONS_KEY,
];
let expenseProviders = [];
let expenseDescriptions = [];
let expenseDraftItems = [];
let expenseEditingId = null;

const authCodeEl = $("#auth-code");
const authCodeToggleEl = $("#auth-code-toggle");
const btnLoginCode = $("#btn-login-code");
const btnLogin = $("#btn-login");
const btnLogout = $("#btn-logout");
const authMsgEl = $("#auth-msg");
const authUserEl = $("#auth-user");
const authBadgeEl = $("#auth-status-badge");
const editNoteEl = $("#edit-note");

const catalogLockNoteEl = $("#catalog-lock-note");
const priceEditorListEl = $("#price-editor-list");
const catalogMsgEl = $("#catalog-msg");
const btnSavePrices = $("#btn-save-prices");
const btnAddProduct = $("#btn-add-product");

const tabPresencial = $("#tab-presencial");
const tabPedidosYa = $("#tab-pedidosya");

let pedidosyaDiscountPct = 0;

function getSkus() {
  const rank = { cubanito_comun: 1, cubanito_negro: 2, cubanito_blanco: 3, garrapinadas: 4 };
  return products
    .slice()
    .sort((a, b) => (rank[a.sku] || 999) - (rank[b.sku] || 999))
    .map((p) => p.sku);
}
function getProduct(sku) {
  return products.find((p) => p.sku === sku) || null;
}
function getPrice(channel, sku) {
  return Number(getProduct(sku)?.prices?.[channel] ?? 0);
}
function getLabel(sku) {
  if (sku === "cubanito_negro") return "Cubanito choco negro";
  if (sku === "cubanito_blanco") return "Cubanito choco blanco";
  return getProduct(sku)?.name || sku;
}
function getCart() {
  return cartByChannel[activeChannel];
}
function setCart(c) {
  cartByChannel[activeChannel] = c;
}
function ensureCartKeys() {
  const skus = getSkus();
  for (const ch of ["presencial", "pedidosya"]) {
    const c = cartByChannel[ch] || {};
    for (const sku of skus) if (c[sku] == null) c[sku] = 0;
    cartByChannel[ch] = c;
  }
}
function clearActiveCart() {
  const next = { ...(cartByChannel[activeChannel] || {}) };
  for (const k of Object.keys(next)) next[k] = 0;
  cartByChannel[activeChannel] = next;
}

function slugifySku(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function setCatalogMsg(t) {
  if (catalogMsgEl) catalogMsgEl.textContent = t || "";
}
function setAuthMsg(t) {
  if (authMsgEl) authMsgEl.textContent = t || "";
}
function setExpenseMsg(t) {
  if (expenseMsgEl) expenseMsgEl.textContent = t || "";
}
function setCashAdjustMsg(t) {
  if (cashAdjustMsgEl) cashAdjustMsgEl.textContent = t || "";
}
function setCashInitialMsg(t) {
  if (cashInitialMsgEl) cashInitialMsgEl.textContent = t || "";
}
function setCarryoverMsg(t) {
  if (carryoverMsgEl) carryoverMsgEl.textContent = t || "";
}
function setPeyaLiqMsg(t) {
  if (peyaLiqMsgEl) peyaLiqMsgEl.textContent = t || "";
}

function setExpandableSection(extraEl, moreBtnEl, lessBtnEl, expanded) {
  if (extraEl) extraEl.classList.toggle("hidden", !expanded);
  if (moreBtnEl) moreBtnEl.classList.toggle("hidden", expanded);
  if (lessBtnEl) lessBtnEl.classList.toggle("hidden", !expanded);
}

function clearLocalDataCaches() {
  if (!DISABLE_LOCAL_DATA_CACHE) return;
  try {
    for (const key of LOCAL_DATA_CACHE_KEYS) localStorage.removeItem(key);
  } catch {}
}

function loadListCache(key) {
  if (DB_ONLY_MODE || DISABLE_LOCAL_DATA_CACHE) return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveListCache(key, list) {
  if (DB_ONLY_MODE || DISABLE_LOCAL_DATA_CACHE) return;
  try { localStorage.setItem(key, JSON.stringify(list || [])); } catch {}
}

function loadObjectCache(key) {
  if (DB_ONLY_MODE || DISABLE_LOCAL_DATA_CACHE) return {};
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveObjectCache(key, value) {
  if (DB_ONLY_MODE || DISABLE_LOCAL_DATA_CACHE) return;
  try { localStorage.setItem(key, JSON.stringify(value || {})); } catch {}
}

function loadCashAdjustStore() {
  try {
    const raw = localStorage.getItem(LS_CASH_ADJUST_BY_DAY_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveCashAdjustStore(value) {
  try { localStorage.setItem(LS_CASH_ADJUST_BY_DAY_KEY, JSON.stringify(value || {})); } catch {}
}

function loadCashInitialPersist() {
  try {
    const raw = localStorage.getItem(LS_CASH_INITIAL_PERSIST_KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function saveCashInitialPersist(value) {
  try {
    localStorage.setItem(LS_CASH_INITIAL_PERSIST_KEY, String(Math.max(0, Number(value || 0))));
  } catch {}
}

function loadCajaMonthHistoryStore() {
  if (DISABLE_LOCAL_DATA_CACHE) return [];
  try {
    const raw = localStorage.getItem(LS_CAJA_MONTH_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCajaMonthHistoryStore(list) {
  if (DISABLE_LOCAL_DATA_CACHE) return;
  try { localStorage.setItem(LS_CAJA_MONTH_HISTORY_KEY, JSON.stringify(list || [])); } catch {}
}

function loadOfflineQueue() {
  if (DISABLE_LOCAL_DATA_CACHE) return [];
  try {
    const raw = localStorage.getItem(LS_OFFLINE_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveOfflineQueue(list) {
  if (DISABLE_LOCAL_DATA_CACHE) return;
  try { localStorage.setItem(LS_OFFLINE_QUEUE_KEY, JSON.stringify(list || [])); } catch {}
}

function enqueueOffline(entry) {
  const q = loadOfflineQueue();
  q.push(entry);
  saveOfflineQueue(q);
  return q.length;
}

function isLikelyNetworkError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("failed to fetch")
    || msg.includes("networkerror")
    || msg.includes("load failed")
    || msg.includes("network")
    || msg.includes("offline")
    || msg.includes("sin internet")
    || msg.includes("timeout");
}

function isDuplicateKeyError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("duplicate key")
    || msg.includes("already exists")
    || msg.includes("unique constraint")
    || msg.includes("23505");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry(task, retries = 1, waitMs = 350) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await task();
    } catch (e) {
      lastErr = e;
      if (!isLikelyNetworkError(e) || i >= retries) break;
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

function setBusyButton(btn, busy, busyText) {
  if (!btn) return;
  if (busy) {
    btn.dataset.prevText = btn.textContent || "";
    btn.disabled = true;
    if (busyText) btn.textContent = busyText;
  } else {
    btn.disabled = false;
    if (btn.dataset.prevText) btn.textContent = btn.dataset.prevText;
  }
}

function getSalePaymentLabel(sale) {
  const total = Number(sale?.totals?.total || 0);
  const cash = Number(sale?.totals?.cash || 0);
  const transfer = Number(sale?.totals?.transfer || 0);
  const peya = Number(sale?.totals?.peya || 0);
  const channel = String(sale?.channel || "presencial");

  if (cash > 0 && (transfer > 0 || peya > 0)) {
    return `Mixto ($${money(cash)} + $${money(transfer + peya)})`;
  }
  if (cash > 0) return `Efectivo ($${money(cash)})`;
  if (peya > 0) return `PeYa ($${money(peya)})`;
  if (transfer > 0) return `Transferencia ($${money(transfer)})`;
  if (channel === "pedidosya" && total > 0) return `PeYa ($${money(total)})`;
  if (total > 0) return `Transferencia ($${money(total)})`;
  return "Transferencia ($0)";
}

function getVentasSplit(sale) {
  const total = Number(sale?.totals?.total || 0);
  const cash = Number(sale?.totals?.cash || 0);
  const transfer = Number(sale?.totals?.transfer || 0);
  const peya = Number(sale?.totals?.peya || 0);
  const channel = String(sale?.channel || "presencial");

  if (cash > 0 && (transfer > 0 || peya > 0)) {
    return { cash, transfer, peya };
  }
  if (cash > 0) return { cash, transfer: 0, peya: 0 };
  if (peya > 0) return { cash: 0, transfer: 0, peya };
  if (transfer > 0) return { cash: 0, transfer, peya: 0 };
  if (channel === "pedidosya" && total > 0) return { cash: 0, transfer: 0, peya: total };
  return { cash: 0, transfer: total, peya: 0 };
}

function fillSelectOptions(selectEl, list, includeAddNew = false) {
  if (!selectEl) return;
  const base = list.map((v) => `<option value="${v}">${v}</option>`).join("");
  const add = includeAddNew ? `<option value="${ADD_NEW_SELECT_VALUE}">+ Agregar opción...</option>` : "";
  selectEl.innerHTML = base + add;
}

function loadDynamicList(base, key) {
  if (DISABLE_LOCAL_DATA_CACHE) return [...base];
  try {
    const raw = localStorage.getItem(key);
    const extra = raw ? JSON.parse(raw) : [];
    const merged = [...base, ...(Array.isArray(extra) ? extra : [])]
      .map((x) => String(x || "").trim().toUpperCase())
      .filter(Boolean);
    return Array.from(new Set(merged));
  } catch {
    return [...base];
  }
}

function saveDynamicList(key, list) {
  if (DISABLE_LOCAL_DATA_CACHE) return;
  localStorage.setItem(key, JSON.stringify(Array.from(new Set(list))));
}

function sanitizeProviderList(list) {
  const banned = new Set(["GARRAFAS"]);
  return Array.from(
    new Set(
      list
        .map((v) => (String(v || "").trim().toUpperCase() === "SENOR" ? "SEÑORA" : v))
        .filter((v) => !banned.has(String(v || "").trim().toUpperCase()))
    )
  );
}

function refreshExpenseSelects() {
  fillSelectOptions(expenseProviderEl, expenseProviders, true);
  fillSelectOptions(expenseDescEl, expenseDescriptions, true);
}

function addExpenseSelectOption(kind) {
  const isProvider = kind === "provider";
  const promptText = isProvider ? "Nuevo proveedor:" : "Nueva descripción:";
  const value = String(prompt(promptText) || "").trim().toUpperCase();
  if (!value) return null;

  if (isProvider) {
    const normalizedProvider = value === "SENOR" ? "SEÑORA" : value;
    if (!expenseProviders.includes(normalizedProvider)) expenseProviders.push(normalizedProvider);
    expenseProviders = sanitizeProviderList(expenseProviders);
    saveDynamicList(LS_EXPENSE_PROVIDERS_KEY, expenseProviders);
    refreshExpenseSelects();
    if (expenseProviderEl) expenseProviderEl.value = normalizedProvider;
  } else {
    if (!expenseDescriptions.includes(value)) expenseDescriptions.push(value);
    saveDynamicList(LS_EXPENSE_DESCRIPTIONS_KEY, expenseDescriptions);
    refreshExpenseSelects();
    if (expenseDescEl) expenseDescEl.value = value;
  }
  return value;
}

function getExpenseProviderRule() {
  const key = String(expenseProviderEl?.value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return PROVIDER_RULES[key] || null;
}

function getExpenseInputMode() {
  return getExpenseProviderRule()?.mode || "items";
}

function applyExpenseProviderRules() {
  const rule = getExpenseProviderRule();
  if (rule?.descriptions?.length) {
    fillSelectOptions(expenseDescEl, rule.descriptions, false);
  } else {
    fillSelectOptions(expenseDescEl, expenseDescriptions, true);
  }

  const directMode = getExpenseInputMode() === "direct";
  expenseUnitPriceFieldEl?.classList.toggle("hidden", directMode);
  expenseQtyFieldEl?.classList.toggle("hidden", directMode);
  expenseDirectAmountFieldEl?.classList.toggle("hidden", !directMode);
  const showSettlement = Boolean(rule?.settlement);
  expenseSettlementRangeFieldEl?.classList.toggle("hidden", !showSettlement);
  if (expenseDescEl && expenseDescEl.options.length) expenseDescEl.selectedIndex = 0;
}

function getExpenseCurrentSubtotal() {
  if (getExpenseInputMode() === "direct") {
    return Math.max(0, parseNum(expenseDirectAmountEl?.value));
  }
  const qty = Math.max(0, parseNum(expenseQtyEl?.value));
  const unitPrice = Math.max(0, parseNum(expenseUnitPriceEl?.value));
  return qty * unitPrice;
}

function getExpenseTotal() {
  const itemsTotal = expenseDraftItems.reduce((acc, it) => acc + Number(it.amount || 0), 0);
  return itemsTotal + getExpenseCurrentSubtotal();
}

function setExpenseEditMode(id = null) {
  expenseEditingId = id ? String(id) : null;
  if (btnExpenseSave) btnExpenseSave.textContent = expenseEditingId ? "Guardar cambios" : "Guardar gasto";
  if (btnExpenseCancel) btnExpenseCancel.textContent = expenseEditingId ? "Cancelar edicion" : "Cancelar";
}

function ensureExpenseSelectOption(selectEl, value) {
  if (!selectEl) return;
  const next = String(value || "").trim();
  if (!next) return;
  if ([...selectEl.options].some((o) => String(o.value || "").trim() === next)) return;
  const opt = document.createElement("option");
  opt.value = next;
  opt.textContent = next;
  selectEl.insertBefore(opt, selectEl.options[0] || null);
}

function parseExpenseItemsFromDescription(text) {
  let raw = String(text || "").trim();
  if (!raw) return [];
  raw = raw.replace(/^\[[^\]]+\]\s*/, "");
  const parts = raw.split(/\s*\+\s*/).map((p) => p.trim()).filter(Boolean);
  const items = [];
  for (const part of parts) {
    const itemMatch = part.match(/^(.*?)\s*x\s*([\d.,]+)\s*a\s*\$?\s*([\d.,]+)$/i);
    if (itemMatch) {
      const description = String(itemMatch[1] || "").trim().toUpperCase();
      const qty = Math.max(0, parseNum(itemMatch[2]));
      const unitPrice = Math.max(0, parseNum(itemMatch[3]));
      if (!description || qty <= 0 || unitPrice <= 0) continue;
      items.push({ description, qty, unitPrice, amount: qty * unitPrice, directMode: false });
      continue;
    }
    const directMatch = part.match(/^(.*?)\s*\$?\s*([\d.,]+)$/i);
    if (directMatch) {
      const description = String(directMatch[1] || "").trim().toUpperCase();
      const amount = Math.max(0, parseNum(directMatch[2]));
      if (!description || amount <= 0) continue;
      items.push({ description, qty: 1, unitPrice: amount, amount, directMode: true });
    }
  }
  return items;
}

function loadExpenseDraftItemIntoForm(idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= expenseDraftItems.length) return;
  const item = expenseDraftItems[idx];
  const currentModeDirect = getExpenseInputMode() === "direct";
  ensureExpenseSelectOption(expenseDescEl, item.description);
  if (expenseDescEl) expenseDescEl.value = item.description;
  if (currentModeDirect) {
    if (expenseDirectAmountEl) expenseDirectAmountEl.value = String(item.amount || 0);
    if (expenseQtyEl) expenseQtyEl.value = "";
    if (expenseUnitPriceEl) expenseUnitPriceEl.value = "";
  } else {
    if (expenseQtyEl) expenseQtyEl.value = String(item.qty || 0);
    if (expenseUnitPriceEl) expenseUnitPriceEl.value = String(Number(item.unitPrice || 0));
    if (expenseDirectAmountEl) expenseDirectAmountEl.value = "";
  }
  expenseDraftItems.splice(idx, 1);
  renderExpenseTotals();
  renderExpenseMixedDiff();
  setExpenseMsg("Item cargado en el formulario para editar.");
}

function renderExpenseDraftItems() {
  if (!expenseItemsListEl) return;
  if (!expenseDraftItems.length) {
    expenseItemsListEl.innerHTML = "";
    return;
  }
  expenseItemsListEl.innerHTML = expenseDraftItems
    .map((it, idx) => `
      <div class="expense-item-row">
        <div class="label">Item ${idx + 1}</div>
        <div class="value">${it.description}</div>
        <div class="tiny muted">${it.directMode ? `$${money(it.amount)}` : `${it.qty} x $${money(it.unitPrice)} = $${money(it.amount)}`}</div>
        <div class="actions">
          <button class="btn ghost tinyBtn" type="button" data-edit-expense-draft="${idx}">Editar</button>
          <button class="btn ghost tinyBtn" type="button" data-remove-expense-draft="${idx}">Quitar</button>
        </div>
      </div>
    `)
    .join("");
}

function renderExpenseTotals() {
  const subtotal = getExpenseCurrentSubtotal();
  const total = getExpenseTotal();
  if (expenseSubtotalEl) expenseSubtotalEl.textContent = `$${money(subtotal)}`;
  if (expenseTotalEl) expenseTotalEl.textContent = `$${money(total)}`;
  if (expenseItemsPreviewEl) {
    if (!expenseDraftItems.length) expenseItemsPreviewEl.textContent = "Sin items agregados.";
    else expenseItemsPreviewEl.textContent = `Items agregados: ${expenseDraftItems.length}`;
  }
  renderExpenseDraftItems();
}

function resetExpenseForm() {
  setExpenseEditMode(null);
  if (expenseDateEl) expenseDateEl.value = todayKey();
  if (expenseProviderEl && expenseProviderEl.options.length) expenseProviderEl.selectedIndex = 0;
  if (expenseUnitPriceEl) expenseUnitPriceEl.value = "";
  if (expenseQtyEl) expenseQtyEl.value = "";
  if (expenseDirectAmountEl) expenseDirectAmountEl.value = "";
  if (expenseSettlementRangeEl) expenseSettlementRangeEl.value = "";
  expenseSettlementRangeEl?._flatpickr?.clear();
  if (expenseDescEl && expenseDescEl.options.length) expenseDescEl.selectedIndex = 0;
  if (expenseMethodEl) expenseMethodEl.value = "efectivo";
  if (expensePayCashEl) expensePayCashEl.value = "";
  if (expensePayTransferEl) expensePayTransferEl.value = "";
  if (expensePayPeyaEl) expensePayPeyaEl.value = "";
  expenseDraftItems = [];
  applyExpenseProviderRules();
  renderExpenseTotals();
  if (expenseMixedWrapEl) expenseMixedWrapEl.classList.add("hidden");
  if (expenseMixedDiffEl) expenseMixedDiffEl.textContent = "";
}

function openExpenseFormForEdit(exp) {
  if (!exp) return;
  resetExpenseForm();
  setExpenseEditMode(exp.id);
  if (expenseFormWrapEl) expenseFormWrapEl.classList.remove("hidden");

  const provider = String(exp.provider || "").trim().toUpperCase();
  const description = String(exp.description || "").trim().toUpperCase();
  const amount = Math.max(0, Number(exp.amount || 0));
  const qty = Math.max(0, Number(exp.qty || 0));
  const unitPrice = qty > 0 ? amount / qty : amount;

  if (expenseDateEl) expenseDateEl.value = String(exp.date || todayKey());
  ensureExpenseSelectOption(expenseProviderEl, provider);
  if (expenseProviderEl && provider) expenseProviderEl.value = provider;
  applyExpenseProviderRules();
  const parsedItems = parseExpenseItemsFromDescription(description);
  if (parsedItems.length) {
    for (const it of parsedItems) ensureExpenseSelectOption(expenseDescEl, it.description);
    expenseDraftItems = parsedItems;
    if (expenseDescEl && expenseDescEl.options.length) expenseDescEl.selectedIndex = 0;
    if (expenseQtyEl) expenseQtyEl.value = "";
    if (expenseUnitPriceEl) expenseUnitPriceEl.value = "";
    if (expenseDirectAmountEl) expenseDirectAmountEl.value = "";
  } else {
    ensureExpenseSelectOption(expenseDescEl, description);
    if (expenseDescEl && description) expenseDescEl.value = description;
    if (getExpenseInputMode() === "direct") {
      if (expenseDirectAmountEl) expenseDirectAmountEl.value = amount > 0 ? String(amount) : "";
    } else {
      if (expenseQtyEl) expenseQtyEl.value = qty > 0 ? String(qty) : "";
      if (expenseUnitPriceEl) expenseUnitPriceEl.value = unitPrice > 0 ? String(Number(unitPrice.toFixed(2))) : "";
    }
  }

  if (expenseMethodEl) expenseMethodEl.value = normalizePaymentMethod(exp.method || "efectivo");
  if (expensePayCashEl) expensePayCashEl.value = Number(exp.pay_cash || 0) > 0 ? String(Number(exp.pay_cash || 0)) : "";
  if (expensePayTransferEl) expensePayTransferEl.value = Number(exp.pay_transfer || 0) > 0 ? String(Number(exp.pay_transfer || 0)) : "";
  if (expensePayPeyaEl) expensePayPeyaEl.value = Number(exp.pay_peya || 0) > 0 ? String(Number(exp.pay_peya || 0)) : "";
  if (expenseMixedWrapEl) expenseMixedWrapEl.classList.toggle("hidden", expenseMethodEl?.value !== "mixto");

  renderExpenseTotals();
  renderExpenseMixedDiff();
  setExpenseMsg("Editando gasto seleccionado.");
}

function initSettlementRangePicker() {
  if (!expenseSettlementRangeEl || typeof window.flatpickr !== "function") return;
  if (expenseSettlementRangeEl._flatpickr) return;
  window.flatpickr(expenseSettlementRangeEl, {
    mode: "range",
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "d/m/Y",
    locale: window.flatpickr.l10ns.es || "default",
    allowInput: false,
    clickOpens: true,
  });
}

function getSettlementRange() {
  const fp = expenseSettlementRangeEl?._flatpickr;
  if (!fp || !Array.isArray(fp.selectedDates) || fp.selectedDates.length < 2) return null;
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [a, b] = fp.selectedDates;
  const from = fmt(a);
  const to = fmt(b);
  return from <= to ? { from, to } : { from: to, to: from };
}

function initPeyaLiquidationRangePicker() {
  if (!peyaLiqRangeEl || typeof window.flatpickr !== "function") return;
  if (peyaLiqRangeEl._flatpickr) return;
  window.flatpickr(peyaLiqRangeEl, {
    mode: "range",
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "d/m/Y",
    locale: window.flatpickr.l10ns.es || "default",
    allowInput: false,
    clickOpens: true,
  });
}

function getPeyaLiqRange() {
  const fp = peyaLiqRangeEl?._flatpickr;
  if (!fp || !Array.isArray(fp.selectedDates) || fp.selectedDates.length < 2) return null;
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [a, b] = fp.selectedDates;
  const from = fmt(a);
  const to = fmt(b);
  return from <= to ? { from, to } : { from: to, to: from };
}

function initInfoRangePicker() {
  if (!infoRangeEl || typeof window.flatpickr !== "function") return;
  if (infoRangeEl._flatpickr) return;
  window.flatpickr(infoRangeEl, {
    mode: "range",
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "d/m/Y",
    locale: window.flatpickr.l10ns.es || "default",
    allowInput: false,
    clickOpens: true,
    onClose: () => renderInfoByRange(),
  });
}

function getInfoRange() {
  const fp = infoRangeEl?._flatpickr;
  if (!fp || !Array.isArray(fp.selectedDates) || fp.selectedDates.length < 2) return null;
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [a, b] = fp.selectedDates;
  const from = fmt(a);
  const to = fmt(b);
  return from <= to ? { from, to } : { from: to, to: from };
}

function initInfoStatsPeriodPicker() {
  if (!infoStatsPeriodInputEl || typeof window.flatpickr !== "function") return;
  if (infoStatsPeriodInputEl._flatpickr) return;
  window.flatpickr(infoStatsPeriodInputEl, {
    mode: "range",
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "d/m/Y",
    locale: window.flatpickr.l10ns.es || "default",
    allowInput: false,
    clickOpens: true,
    onClose: () => renderInfoStats(),
  });
}

function getInfoStatsPeriodRange() {
  const fp = infoStatsPeriodInputEl?._flatpickr;
  if (!fp || !Array.isArray(fp.selectedDates) || fp.selectedDates.length < 2) return null;
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [a, b] = fp.selectedDates;
  const from = fmt(a);
  const to = fmt(b);
  return from <= to ? { from, to } : { from: to, to: from };
}

function applyDefaultPickerRanges() {
  const infoStatsFp = infoStatsPeriodInputEl?._flatpickr;
  if (infoStatsFp && !(infoStatsPeriodInputEl?.value || "").trim()) {
    const t = new Date();
    const from = new Date(t);
    from.setDate(t.getDate() - 6);
    infoStatsFp.setDate([from, t], true, "Y-m-d");
  }
  const infoFp = infoRangeEl?._flatpickr;
  if (infoFp && !(infoRangeEl?.value || "").trim()) {
    const t = todayKey();
    const startMonth = `${t.slice(0, 8)}01`;
    infoFp.setDate([startMonth, t], true, "Y-m-d");
  }
}

function initDeferredUi() {
  if (deferredUiInitDone) return;
  deferredUiInitDone = true;
  initSettlementRangePicker();
  initPeyaLiquidationRangePicker();
  initInfoRangePicker();
  initInfoStatsPeriodPicker();
  applyDefaultPickerRanges();
}

function scheduleDeferredUiInit() {
  if (deferredUiInitDone) return;
  const runner = () => initDeferredUi();
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(runner, { timeout: 1200 });
  } else {
    setTimeout(runner, 0);
  }
}

function renderInfoByRange() {
  if (!infoResultsEl) return;
  const range = getInfoRange();
  if (!range) {
    infoResultsEl.innerHTML = ``;
    return;
  }

  const selected = {
    presCash: Boolean(filterPresCashEl?.checked),
    presTransfer: Boolean(filterPresTransferEl?.checked),
    pyCash: Boolean(filterPyCashEl?.checked),
    pyTransfer: Boolean(filterPyTransferEl?.checked),
    pyPeya: Boolean(filterPyPeyaEl?.checked),
    expCash: Boolean(filterExpCashEl?.checked),
    expTransfer: Boolean(filterExpTransferEl?.checked),
    expPeya: Boolean(filterExpPeyaEl?.checked),
    cComun: Boolean(filterCComunEl?.checked),
    cNegro: Boolean(filterCNegroEl?.checked),
    cBlanco: Boolean(filterCBlancoEl?.checked),
  };
  if (!Object.values(selected).some(Boolean)) {
    infoResultsEl.innerHTML = ``;
    return;
  }

  let presCash = 0;
  let presTransfer = 0;
  let pyCash = 0;
  let pyTransfer = 0;
  let pyPeya = 0;
  let expCash = 0;
  let expTransfer = 0;
  let expPeya = 0;
  let cComun = 0;
  let cNegro = 0;
  let cBlanco = 0;

  const inRange = (dayKey) => String(dayKey || "") >= range.from && String(dayKey || "") <= range.to;
  for (const s of sales) {
    if (!inRange(s.dayKey)) continue;
    const channel = String(s.channel || "presencial");
    const cash = Number(s?.totals?.cash || 0);
    const transfer = Number(s?.totals?.transfer || 0);
    const peya = Number(s?.totals?.peya || 0);
    if (channel === "pedidosya") {
      pyCash += cash;
      pyTransfer += transfer;
      pyPeya += peya;
    } else {
      presCash += cash;
      presTransfer += transfer;
    }
    for (const it of s.items || []) {
      const qty = Number(it?.qty || 0);
      if (it?.sku === "cubanito_comun") cComun += qty;
      if (it?.sku === "cubanito_negro") cNegro += qty;
      if (it?.sku === "cubanito_blanco") cBlanco += qty;
    }
  }
  for (const e of expenses) {
    if (!inRange(e.date)) continue;
    const split = expenseSplitPayments(e);
    expCash += Number(split.cash || 0);
    expTransfer += Number(split.transfer || 0);
    expPeya += Number(split.peya || 0);
  }

  const cards = [];
  let totalMoneySelected = 0;
  let totalQtySelected = 0;
  const pushMoney = (title, value) => cards.push(`<div class="kpi"><div class="kpi-title">${title}</div><div class="kpi-value">$${money(value)}</div></div>`);
  const pushQty = (title, value) => cards.push(`<div class="kpi"><div class="kpi-title">${title}</div><div class="kpi-value">${value}</div></div>`);

  if (selected.presCash) { pushMoney("Presencial efectivo", presCash); totalMoneySelected += presCash; }
  if (selected.presTransfer) { pushMoney("Presencial transferencia", presTransfer); totalMoneySelected += presTransfer; }
  if (selected.pyCash) { pushMoney("PedidosYa efectivo", pyCash); totalMoneySelected += pyCash; }
  if (selected.pyTransfer) { pushMoney("PedidosYa transferencia", pyTransfer); totalMoneySelected += pyTransfer; }
  if (selected.pyPeya) { pushMoney("PedidosYa PeYa", pyPeya); totalMoneySelected += pyPeya; }
  if (selected.expCash) { pushMoney("Gastos efectivo", expCash); totalMoneySelected += expCash; }
  if (selected.expTransfer) { pushMoney("Gastos transferencia", expTransfer); totalMoneySelected += expTransfer; }
  if (selected.expPeya) { pushMoney("Gastos PeYa", expPeya); totalMoneySelected += expPeya; }
  if (selected.cComun) { pushQty("Consumo común", cComun); totalQtySelected += cComun; }
  if (selected.cNegro) { pushQty("Consumo negro", cNegro); totalQtySelected += cNegro; }
  if (selected.cBlanco) { pushQty("Consumo blanco", cBlanco); totalQtySelected += cBlanco; }

  const headers = [];
  if (totalMoneySelected > 0) {
    headers.push(`<div class="kpi kpiWide"><div class="kpi-title">Total general seleccionado</div><div class="kpi-value">$${money(totalMoneySelected)}</div></div>`);
  }
  if (totalQtySelected > 0) {
    headers.push(`<div class="kpi kpiWide"><div class="kpi-title">Total consumo seleccionado</div><div class="kpi-value">${totalQtySelected}</div></div>`);
  }

  infoResultsEl.innerHTML = [...headers, ...cards].join("");
}

function hourLabel(hour) {
  const h = String(hour).padStart(2, "0");
  return `${h}:00 - ${h}:59`;
}

function saleHour(sale) {
  const h = Number(String(sale?.time || "").split(":")[0]);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  return h;
}

function timeToMinutes(raw) {
  const m = String(raw || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesToTime(totalMinutes) {
  const mins = Math.max(0, Math.min(23 * 60 + 59, Number(totalMinutes || 0)));
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function bestSellingWindowForDay(list) {
  const rows = (list || [])
    .map((s) => {
      const minutes = timeToMinutes(s?.time);
      const hour = saleHour(s);
      return {
        minutes,
        hour,
        total: Number(s?.totals?.total || 0),
      };
    })
    .filter((r) => r.minutes != null && r.hour != null && r.hour >= INFO_STATS_START_HOUR && r.hour <= INFO_STATS_END_HOUR && r.total > 0)
    .sort((a, b) => a.minutes - b.minutes);

  if (!rows.length) return null;

  let best = null;
  let sum = 0;
  let left = 0;
  for (let right = 0; right < rows.length; right++) {
    sum += rows[right].total;
    while (rows[right].minutes - rows[left].minutes > INFO_STATS_DAY_WINDOW_MINUTES) {
      sum -= rows[left].total;
      left += 1;
    }
    const start = rows[left].minutes;
    const end = rows[right].minutes;
    const duration = end - start;
    const candidate = {
      from: minutesToTime(start),
      to: minutesToTime(end),
      total: sum,
      duration,
      start,
    };
    if (
      !best
      || candidate.total > best.total
      || (candidate.total === best.total && candidate.duration < best.duration)
      || (candidate.total === best.total && candidate.duration === best.duration && candidate.start < best.start)
    ) {
      best = candidate;
    }
  }
  return best;
}

function buildHourlyStats(list) {
  const totalHours = INFO_STATS_END_HOUR - INFO_STATS_START_HOUR + 1;
  const hours = Array.from({ length: totalHours }, (_, idx) => ({
    hour: INFO_STATS_START_HOUR + idx,
    idx,
    count: 0,
    total: 0,
    presencial: 0,
    pedidosya: 0,
  }));
  const byHour = new Map(hours.map((r) => [r.hour, r]));

  for (const s of list || []) {
    const hour = saleHour(s);
    if (hour == null || hour < INFO_STATS_START_HOUR || hour > INFO_STATS_END_HOUR) continue;
    const row = byHour.get(hour);
    if (!row) continue;
    const total = Number(s?.totals?.total || 0);
    row.count += 1;
    row.total += total;
    if (String(s?.channel || "presencial") === "pedidosya") row.pedidosya += total;
    else row.presencial += total;
  }
  return hours;
}

function pickTopHour(rows, field) {
  const valid = (rows || []).filter((r) => Number(r?.[field] || 0) > 0);
  if (!valid.length) return null;
  return valid.slice().sort((a, b) => Number(b[field] || 0) - Number(a[field] || 0) || a.hour - b.hour)[0];
}

function summarizeChannelVs(list) {
  let presencial = 0;
  let pedidosya = 0;
  for (const s of list || []) {
    const hour = saleHour(s);
    if (hour == null || hour < INFO_STATS_START_HOUR || hour > INFO_STATS_END_HOUR) continue;
    const total = Number(s?.totals?.total || 0);
    if (String(s?.channel || "presencial") === "pedidosya") pedidosya += total;
    else presencial += total;
  }
  let winner = "Empate";
  if (presencial > pedidosya) winner = "Presencial";
  if (pedidosya > presencial) winner = "PedidosYa";
  return { presencial, pedidosya, winner };
}

function renderInfoStatsHourRows(rows, options = {}) {
  if (!infoStatsHoursEl) return;
  const raw = rows || [];
  const data = raw.filter((r) => Number(r.total || 0) > 0 || Number(r.count || 0) > 0);
  if (!raw.length || !data.length) {
    infoStatsHoursEl.innerHTML = `<div class="muted tiny">No hay ventas para el período seleccionado.</div>`;
    return;
  }
  const mode = options.mode === "month" ? "month" : "day";
  const divisor = Math.max(1, Number(options.divisor || 1));
  const pointsData = raw.map((r) => ({
    hour: Number(r.hour || 0),
    idx: Number(r.idx || 0),
    value: Number(r.total || 0) / divisor,
    count: Number(r.count || 0) / divisor,
  }));
  const maxY = Math.max(...pointsData.map((p) => p.value), 1);
  const width = 760;
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 520px)").matches;
  const height = isMobile ? 420 : 320;
  const padLeft = 40;
  const padRight = 14;
  const padTop = 16;
  const padBottom = 34;
  const w = width - padLeft - padRight;
  const h = height - padTop - padBottom;
  const maxIndex = Math.max(pointsData.length - 1, 1);
  const x = (idx) => padLeft + (idx / maxIndex) * w;
  const y = (val) => padTop + (1 - (val / maxY)) * h;
  const linePts = pointsData.map((p) => `${x(p.idx).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const areaPts = `${padLeft},${padTop + h} ${linePts} ${padLeft + w},${padTop + h}`;
  const topHours = pointsData
    .slice()
    .sort((a, b) => b.value - a.value || a.hour - b.hour)
    .slice(0, 3)
    .filter((x) => x.value > 0);
  const topText = topHours.length
    ? topHours.map((p, i) => {
      const right = mode === "month"
        ? `$${money(p.value)} prom./día`
        : `$${money(p.value)}`;
      return `<div class="tiny muted">${i + 1}. ${hourLabel(p.hour)} · ${right} · ${p.count.toFixed(mode === "month" ? 1 : 0)} venta(s)</div>`;
    }).join("")
    : `<div class="tiny muted">Sin horas destacadas.</div>`;

  const xTicks = pointsData
    .map((p) => `<text x="${x(p.idx)}" y="${height - 10}" text-anchor="middle" class="infoChartTick">${String(p.hour).padStart(2, "0")}</text>`)
    .join("");
  const yTicks = [0, 0.5, 1]
    .map((r) => {
      const val = maxY * r;
      const yy = y(val);
      return `
        <line x1="${padLeft}" y1="${yy}" x2="${padLeft + w}" y2="${yy}" class="infoChartGrid"></line>
        <text x="${padLeft - 6}" y="${yy + 4}" text-anchor="end" class="infoChartTick">$${money(val)}</text>
      `;
    }).join("");

  infoStatsHoursEl.innerHTML = `
    <div class="infoChartWrap">
      <svg viewBox="0 0 ${width} ${height}" class="infoChartSvg" role="img" aria-label="Gráfico de ventas por hora">
        ${yTicks}
        <polygon points="${areaPts}" class="infoChartArea"></polygon>
        <polyline points="${linePts}" class="infoChartLine"></polyline>
        ${xTicks}
      </svg>
    </div>
    <div class="infoChartTop">${topText}</div>
  `;
}

function renderInfoStats() {
  if (!infoStatsSummaryEl || !infoStatsHoursEl) return;
  const mode = infoStatsMode === "month" ? "month" : infoStatsMode === "period" ? "period" : "day";
  const day = String(infoStatsDayInputEl?.value || todayKey());
  const month = String(infoStatsMonthInputEl?.value || monthKeyNow());
  const period = getInfoStatsPeriodRange();
  const isEligibleForInfoStats = (dayKey) => {
    const k = String(dayKey || "");
    if (!k) return false;
    if (INFO_STATS_EXCLUDED_DAY_KEYS.has(k)) return false;
    return k >= INFO_STATS_MIN_DAY_KEY;
  };

  if (infoStatsDayInputEl && !infoStatsDayInputEl.value) infoStatsDayInputEl.value = day;
  if (infoStatsMonthInputEl && !infoStatsMonthInputEl.value) infoStatsMonthInputEl.value = month;

  const list = mode === "day"
    ? sales.filter((s) => String(s.dayKey || "") === day && isEligibleForInfoStats(s.dayKey))
    : mode === "period"
    ? sales.filter((s) => {
      const k = String(s.dayKey || "");
      if (!period) return false;
      return k >= period.from && k <= period.to && isEligibleForInfoStats(k);
    })
    : sales.filter((s) => String(s.dayKey || "").startsWith(`${month}-`) && isEligibleForInfoStats(s.dayKey));
  const hours = buildHourlyStats(list);
  const topByTotal = pickTopHour(hours, "total");
  const channel = summarizeChannelVs(list);

  if (!list.length) {
    const emptyLabel = mode === "day"
      ? formatDayKey(day)
      : mode === "period"
      ? (period ? `${formatDayKey(period.from)} a ${formatDayKey(period.to)}` : "período sin definir")
      : month;
    infoStatsSummaryEl.innerHTML = `<div class="kpi kpiWide"><div class="kpi-title">Período</div><div class="kpi-value">Sin ventas válidas en ${emptyLabel}</div></div>`;
    infoStatsHoursEl.innerHTML = `<div class="muted tiny">No hay datos para mostrar.</div>`;
    return;
  }

  if (mode === "day") {
    const dayWindow = bestSellingWindowForDay(list);
    const dayBestLabel = dayWindow ? `${dayWindow.from} - ${dayWindow.to}` : (topByTotal ? hourLabel(topByTotal.hour) : "-");
    infoStatsSummaryEl.innerHTML = `
      <div class="kpi">
        <div class="kpi-title">Más vendido</div>
        <div class="kpi-value">${dayBestLabel}</div>
      </div>
      <div class="kpi">
        <div class="kpi-title">Canal ganador</div>
        <div class="kpi-value">${channel.winner}</div>
      </div>
      <div class="kpi kpiWide">
        <div class="kpi-title">Presencial vs PeYa</div>
        <div class="kpi-value">$${money(channel.presencial)} / $${money(channel.pedidosya)}</div>
      </div>
    `;
    renderInfoStatsHourRows(hours, { mode: "day" });
    return;
  }

  const activeDays = new Set(list.map((s) => String(s.dayKey || ""))).size || 1;
  const bestHour = pickTopHour(hours, "total");

  infoStatsSummaryEl.innerHTML = `
    <div class="kpi">
      <div class="kpi-title">Más vendido</div>
      <div class="kpi-value">${bestHour ? hourLabel(bestHour.hour) : "-"}</div>
    </div>
    <div class="kpi">
      <div class="kpi-title">Canal ganador</div>
      <div class="kpi-value">${channel.winner}</div>
    </div>
    <div class="kpi kpiWide">
      <div class="kpi-title">Presencial vs PeYa</div>
      <div class="kpi-value">$${money(channel.presencial)} / $${money(channel.pedidosya)}</div>
    </div>
  `;
  renderInfoStatsHourRows(hours, { mode: "month", divisor: activeDays });
}

function setInfoStatsMode(mode) {
  infoStatsMode = mode === "month" ? "month" : mode === "period" ? "period" : "day";
  infoStatsModeDayEl?.classList.toggle("ghost", infoStatsMode !== "day");
  infoStatsModePeriodEl?.classList.toggle("ghost", infoStatsMode !== "period");
  infoStatsModeMonthEl?.classList.toggle("ghost", infoStatsMode !== "month");
  infoStatsDayWrapEl?.classList.toggle("hidden", infoStatsMode !== "day");
  infoStatsPeriodWrapEl?.classList.toggle("hidden", infoStatsMode !== "period");
  infoStatsMonthWrapEl?.classList.toggle("hidden", infoStatsMode !== "month");
  if (document.getElementById("tab-informacion")?.classList.contains("show")) {
    renderInfoStats();
  }
}

async function loadProductsFromDB() {
  if (!hasSupabaseClient()) {
    const fallback = loadListCache(LS_PRODUCTS_KEY);
    return fallback.length ? fallback : null;
  }
  const { data, error } = await window.supabase
    .from("products")
    .select("sku,name,unit,price_presencial,price_pedidosya,created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    const fallback = loadListCache(LS_PRODUCTS_KEY);
    return fallback.length ? fallback : null;
  }

  const list = (data || []).map((r) => {
    const sku = String(r.sku || "").trim();
    const baseName = sku === "cubanito_negro"
      ? "Cubanito choco negro"
      : sku === "cubanito_blanco"
      ? "Cubanito choco blanco"
      : String(r.name || r.sku);
    return {
      sku,
      name: sku === "garrapinadas" ? "Garrapiñadas" : baseName,
      unit: String(r.unit || "Unidad"),
      prices: {
        presencial: Number(r.price_presencial || 0),
        pedidosya: Number(r.price_pedidosya || 0),
      },
    };
  }).filter((p) => !!p.sku);
  const preferred = ["cubanito_comun", "cubanito_blanco", "cubanito_negro", "garrapinadas"];
  list.sort((a, b) => {
    const ia = preferred.indexOf(a.sku);
    const ib = preferred.indexOf(b.sku);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.name.localeCompare(b.name, "es");
  });
  saveListCache(LS_PRODUCTS_KEY, list);
  return list;
}

async function upsertProductToDB(p) {
  if (!hasSupabaseClient()) throw new Error("Sin internet. No se pudo sincronizar el producto.");
  const payload = {
    sku: p.sku,
    name: p.sku === "garrapinadas" ? "Garrapiñadas" : p.name,
    unit: p.unit || "Unidad",
    price_presencial: Number(p.prices?.presencial || 0),
    price_pedidosya: Number(p.prices?.pedidosya || 0),
  };
  const { error } = await window.supabase.from("products").upsert(payload, { onConflict: "sku" });
  if (error) throw error;
}

function applyLoadedSales(nextSales) {
  if (!Array.isArray(nextSales)) return false;
  const fallbackEmpty = salesLoadState !== "ok" && nextSales.length === 0 && Array.isArray(sales) && sales.length > 0;
  if (fallbackEmpty) return false;
  sales = nextSales;
  return true;
}

function applyLoadedExpenses(nextExpenses) {
  if (!Array.isArray(nextExpenses)) return false;
  const fallbackEmpty = expensesLoadState !== "ok" && nextExpenses.length === 0 && Array.isArray(expenses) && expenses.length > 0;
  if (fallbackEmpty) return false;
  expenses = nextExpenses;
  return true;
}

async function loadSalesFromDB() {
  if (!hasSupabaseClient()) {
    salesLoadState = "fallback";
    return loadListCache(LS_SALES_KEY);
  }
  const { data, error } = await window.supabase
    .from("sales")
    .select("*")
    .order("day", { ascending: true })
    .order("time", { ascending: true });

  if (error) {
    console.error(error);
    salesLoadState = "fallback";
    return loadListCache(LS_SALES_KEY);
  }

  const cacheById = new Map(loadListCache(LS_SALES_KEY).map((s) => [String(s.id), s]));
  const list = (data || []).map((r) => ({
    id: r.id,
    dayKey: String(r.day),
    time: r.time,
    channel: r.channel || "presencial",
    items: r.items || [],
    totals: {
      total: Number(r.total),
      cash: Number(r.cash),
      transfer: Number(r.transfer),
      peya: Number(r.peya ?? cacheById.get(String(r.id))?.totals?.peya ?? 0),
    },
  }));
  salesLoadState = "ok";
  saveListCache(LS_SALES_KEY, list);
  return list;
}

async function loadExpensesFromDB() {
  if (!hasSupabaseClient()) {
    expensesLoadState = "fallback";
    return loadListCache(LS_EXPENSES_KEY);
  }
  const { data, error } = await window.supabase
    .from("expenses")
    .select("*")
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    expensesLoadState = "fallback";
    return loadListCache(LS_EXPENSES_KEY);
  }

  const list = (data || []).map((r) => ({
    id: r.id,
    date: String(r.date || ""),
    provider: String(r.provider || ""),
    qty: Number(r.qty || 0),
    description: String(r.description || ""),
    iva: Number(r.iva || 0),
    iibb: Number(r.iibb || 0),
    amount: Number(r.amount || 0),
    method: String(r.method || "efectivo"),
    pay_cash: Number(r.pay_cash || 0),
    pay_transfer: Number(r.pay_transfer || 0),
    pay_peya: Number(r.pay_peya || 0),
  }));
  expensesLoadState = "ok";
  saveListCache(LS_EXPENSES_KEY, list);
  return list;
}

async function loadPeyaLiquidationsFromDB() {
  if (!hasSupabaseClient()) return loadListCache(LS_PEYA_LIQ_LIST_KEY);
  if (!hasPeyaLiqTable) return loadListCache(LS_PEYA_LIQ_LIST_KEY);
  const { data, error } = await window.supabase
    .from("peya_liquidations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (String(error.code || "") === "PGRST205" || msg.includes("could not find the table")) {
      hasPeyaLiqTable = false;
      try { localStorage.setItem(LS_HAS_PEYA_LIQ_TABLE_KEY, "0"); } catch {}
      return loadListCache(LS_PEYA_LIQ_LIST_KEY);
    }
    console.error(error);
    return loadListCache(LS_PEYA_LIQ_LIST_KEY);
  }
  hasPeyaLiqTable = true;
  try { localStorage.setItem(LS_HAS_PEYA_LIQ_TABLE_KEY, "1"); } catch {}

  const list = (data || []).map((r) => ({
    id: String(r.id),
    month: String(r.month || ""),
    from: String(r.from_date || ""),
    to: String(r.to_date || ""),
    amount: Number(r.amount || 0),
    created_at: String(r.created_at || ""),
  }));
  saveListCache(LS_PEYA_LIQ_LIST_KEY, list);
  return list;
}

async function insertPeyaLiquidationToDB(row) {
  if (!hasSupabaseClient()) throw new Error("Sin internet.");
  if (!hasPeyaLiqTable) throw new Error("missing_peya_liq_table");
  const payload = {
    id: row.id,
    month: row.month,
    from_date: row.from,
    to_date: row.to,
    amount: row.amount,
  };
  const { error } = await window.supabase.from("peya_liquidations").insert(payload);
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (String(error.code || "") === "PGRST205" || msg.includes("could not find the table")) {
      hasPeyaLiqTable = false;
      try { localStorage.setItem(LS_HAS_PEYA_LIQ_TABLE_KEY, "0"); } catch {}
      throw new Error("missing_peya_liq_table");
    }
    throw error;
  }
}

async function loadCarryoversFromDB() {
  if (!hasSupabaseClient()) return loadObjectCache(LS_CARRYOVER_BY_MONTH_KEY);
  const { data, error } = await window.supabase
    .from("monthly_carryovers")
    .select("*");

  if (error) {
    console.error(error);
    return loadObjectCache(LS_CARRYOVER_BY_MONTH_KEY);
  }

  const out = {};
  for (const r of data || []) {
    const month = String(r.month || "");
    if (!month) continue;
    out[month] = {
      cash: Number(r.cash || 0),
      transfer: Number(r.transfer || 0),
      peya: Number(r.peya || 0),
    };
  }
  saveObjectCache(LS_CARRYOVER_BY_MONTH_KEY, out);
  return out;
}

async function upsertCarryoverToDB(month, values) {
  if (!hasSupabaseClient()) throw new Error("Sin internet.");
  const payload = {
    month,
    cash: Number(values.cash || 0),
    transfer: Number(values.transfer || 0),
    peya: Number(values.peya || 0),
  };
  const { error } = await window.supabase
    .from("monthly_carryovers")
    .upsert(payload, { onConflict: "month" });
  if (error) throw error;
}

async function processOfflineQueue() {
  if (STRICT_CLOUD_SYNC) {
    saveOfflineQueue([]);
    return;
  }
  if (syncingOfflineQueue) return;
  if (!hasSupabaseClient() || !navigator.onLine) return;
  const queue = loadOfflineQueue();
  if (!queue.length) return;
  syncingOfflineQueue = true;
  const remain = [];
  let salesChanged = false;
  let expensesChanged = false;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    try {
      if (item?.kind === "sale" && item?.op === "insert") {
        await insertSaleToDB(item.payload);
        salesChanged = true;
      } else if (item?.kind === "expense" && item?.op === "insert") {
        await insertExpenseToDB(item.payload);
        expensesChanged = true;
      }
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        if (item?.kind === "sale") salesChanged = true;
        if (item?.kind === "expense") expensesChanged = true;
        continue;
      }
      // Si sigue offline o hay corte, cortamos para reintentar luego.
      if (isLikelyNetworkError(e)) {
        remain.push(item, ...queue.slice(i + 1));
        break;
      }
      // Errores de permisos/sesión/validación: lo dejamos en cola.
      remain.push(item);
    }
  }

  saveOfflineQueue(remain);
  try {
    if (salesChanged) applyLoadedSales(await loadSalesFromDB());
    if (expensesChanged) applyLoadedExpenses(await loadExpensesFromDB());
  } catch {}
  renderAll();
  syncingOfflineQueue = false;
}

async function loadCarryoverHistoryFromDB() {
  if (!hasSupabaseClient()) return loadListCache(LS_CARRYOVER_HISTORY_LIST_KEY);
  if (!hasCarryoverHistoryTable) return loadListCache(LS_CARRYOVER_HISTORY_LIST_KEY);
  const { data, error } = await window.supabase
    .from("monthly_carryover_history")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (String(error.code || "") === "PGRST205" || msg.includes("could not find the table")) {
      hasCarryoverHistoryTable = false;
      return loadListCache(LS_CARRYOVER_HISTORY_LIST_KEY);
    }
    console.error(error);
    return loadListCache(LS_CARRYOVER_HISTORY_LIST_KEY);
  }

  hasCarryoverHistoryTable = true;
  const list = (data || []).map((r) => ({
    id: String(r.id),
    month: String(r.month || ""),
    cash: Number(r.cash || 0),
    transfer: Number(r.transfer || 0),
    peya: Number(r.peya || 0),
    created_at: String(r.created_at || ""),
  }));
  saveListCache(LS_CARRYOVER_HISTORY_LIST_KEY, list);
  return list;
}

async function insertCarryoverHistoryToDB(row) {
  if (!hasSupabaseClient()) throw new Error("Sin internet.");
  if (!hasCarryoverHistoryTable) throw new Error("missing_carryover_history_table");
  const payload = {
    id: row.id,
    month: row.month,
    cash: Number(row.cash || 0),
    transfer: Number(row.transfer || 0),
    peya: Number(row.peya || 0),
  };
  const { error } = await window.supabase.from("monthly_carryover_history").insert(payload);
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (String(error.code || "") === "PGRST205" || msg.includes("could not find the table")) {
      hasCarryoverHistoryTable = false;
      throw new Error("missing_carryover_history_table");
    }
    throw error;
  }
}

async function insertExpenseToDB(expense) {
  if (!hasSupabaseClient()) throw new Error("Sin internet.");
  if (!session?.user) throw new Error("Tenes que iniciar sesion");
  if (!isAdmin) throw new Error("No sos admin");
  const payload = {
    id: expense.id,
    date: expense.date,
    provider: expense.provider,
    qty: expense.qty,
    description: expense.description,
    iva: expense.iva,
    iibb: expense.iibb,
    amount: expense.amount,
    method: expense.method,
    pay_cash: expense.pay_cash,
    pay_transfer: expense.pay_transfer,
    pay_peya: expense.pay_peya,
  };
  const variants = [];
  variants.push(payload);
  const { pay_cash, pay_transfer, pay_peya, ...withoutSplit } = payload;
  variants.push(withoutSplit);

  let lastError = null;
  for (const base of variants) {
    const descBase = String(base.description || "");
    const candidates = [
      descBase,
      safeExpenseDescription(descBase.slice(0, 80)).value,
      safeExpenseDescription(descBase.slice(0, 60)).value,
      safeExpenseDescription(descBase.slice(0, 40)).value,
      safeExpenseDescription(descBase.slice(0, 24)).value,
    ];

    for (const desc of candidates) {
      const attemptPayload = { ...base, description: desc };
      const { error } = await window.supabase.from("expenses").insert(attemptPayload);
      if (!error) return;
      lastError = error;
      const msg = String(error.message || "").toLowerCase();
      const canRetryLen = msg.includes("too long") || msg.includes("value too long") || msg.includes("character varying");
      const canRetrySplit = msg.includes("pay_");
      if (!canRetryLen && !canRetrySplit) break;
    }
  }

  throw lastError || new Error("No se pudo guardar el gasto.");
}

async function insertSaleToDB(sale) {
  if (!hasSupabaseClient()) throw new Error("Sin internet.");
  const payload = {
    id: sale.id,
    day: sale.dayKey,
    time: sale.time,
    channel: sale.channel,
    items: sale.items,
    total: sale.totals.total,
    cash: sale.totals.cash,
    transfer: sale.totals.transfer,
    peya: Number(sale.totals.peya || 0),
  };

  let { error } = await window.supabase.from("sales").insert(payload);
  if (!error) return;
  if (String(error.message || "").toLowerCase().includes("peya")) {
    const { peya, ...fallback } = payload;
    const retry = await window.supabase.from("sales").insert(fallback);
    if (!retry.error) return;
    error = retry.error;
  }
  if (String(error.message || "").toLowerCase().includes("channel")) {
    throw new Error("Falta la columna channel en sales. Actualiza la tabla en Supabase para guardar Presencial/PedidosYa correctamente.");
  }
  throw error;
}

async function updateSaleInDB(sale) {
  if (!hasSupabaseClient()) throw new Error("Sin internet.");
  if (!session?.user || !isAdmin) throw new Error("Solo admin");
  const payload = {
    day: sale.dayKey,
    time: sale.time,
    channel: sale.channel,
    items: sale.items,
    total: sale.totals.total,
    cash: sale.totals.cash,
    transfer: sale.totals.transfer,
    peya: Number(sale.totals.peya || 0),
  };
  let { error } = await window.supabase.from("sales").update(payload).eq("id", sale.id);
  if (!error) return;
  if (String(error.message || "").toLowerCase().includes("peya")) {
    const { peya, ...fallback } = payload;
    const retry = await window.supabase.from("sales").update(fallback).eq("id", sale.id);
    if (!retry.error) return;
    error = retry.error;
  }
  throw error;
}

async function updateExpenseInDB(expense) {
  if (!hasSupabaseClient()) throw new Error("Sin internet.");
  if (!session?.user || !isAdmin) throw new Error("Solo admin");
  const payload = {
    date: expense.date,
    provider: expense.provider,
    qty: expense.qty,
    description: expense.description,
    iva: expense.iva,
    iibb: expense.iibb,
    amount: expense.amount,
    method: expense.method,
    pay_cash: expense.pay_cash,
    pay_transfer: expense.pay_transfer,
    pay_peya: expense.pay_peya,
  };
  const variants = [];
  variants.push(payload);
  const { pay_cash, pay_transfer, pay_peya, ...withoutSplit } = payload;
  variants.push(withoutSplit);

  let lastError = null;
  for (const base of variants) {
    const descBase = String(base.description || "");
    const candidates = [
      descBase,
      safeExpenseDescription(descBase.slice(0, 80)).value,
      safeExpenseDescription(descBase.slice(0, 60)).value,
      safeExpenseDescription(descBase.slice(0, 40)).value,
      safeExpenseDescription(descBase.slice(0, 24)).value,
    ];

    for (const desc of candidates) {
      const attemptPayload = { ...base, description: desc };
      const { error } = await window.supabase.from("expenses").update(attemptPayload).eq("id", expense.id);
      if (!error) return;
      lastError = error;
      const msg = String(error.message || "").toLowerCase();
      const canRetryLen = msg.includes("too long") || msg.includes("value too long") || msg.includes("character varying");
      const canRetrySplit = msg.includes("pay_");
      if (!canRetryLen && !canRetrySplit) break;
    }
  }

  throw lastError || new Error("No se pudo editar el gasto.");
}

async function deleteSaleById(id) {
  if (!hasSupabaseClient()) throw new Error("Sin internet.");
  if (!session?.user || !isAdmin) throw new Error("Solo admin");
  const { error } = await window.supabase.from("sales").delete().eq("id", id);
  if (error) throw error;
  saveListCache(LS_SALES_KEY, loadListCache(LS_SALES_KEY).filter((s) => s.id !== id));
}

async function deleteDaySales(dayKey) {
  if (!hasSupabaseClient()) throw new Error("Sin internet.");
  if (!session?.user || !isAdmin) throw new Error("Solo admin");
  const { error } = await window.supabase.from("sales").delete().eq("day", dayKey);
  if (error) throw error;
  saveListCache(LS_SALES_KEY, loadListCache(LS_SALES_KEY).filter((s) => s.dayKey !== dayKey));
}

async function deleteExpenseById(id) {
  if (!hasSupabaseClient()) throw new Error("Sin internet.");
  if (!session?.user || !isAdmin) throw new Error("Solo admin");
  const { error } = await window.supabase.from("expenses").delete().eq("id", id);
  if (error) throw error;
  saveListCache(LS_EXPENSES_KEY, loadListCache(LS_EXPENSES_KEY).filter((e) => e.id !== id));
}

async function refreshSession() {
  if (!hasSupabaseClient()) {
    session = null;
    return;
  }
  const { data } = await window.supabase.auth.getSession();
  const remoteSession = data?.session || null;
  if (forceGuestMode) {
    let rememberedAdmin = false;
    try { rememberedAdmin = localStorage.getItem(LS_ADMIN_REMEMBER_KEY) === "1"; } catch {}
    const adminEmailSession = String(remoteSession?.user?.email || "").toLowerCase() === String(ADMIN_CODE_EMAIL).toLowerCase();
    if (!(rememberedAdmin || adminEmailSession)) {
      session = null;
      return;
    }
    forceGuestMode = false;
    try { localStorage.removeItem(FORCE_GUEST_KEY); } catch {}
  }
  session = remoteSession;
}

async function checkIsAdmin() {
  if (!session?.user) return false;
  if (!hasSupabaseClient()) return false;
  const { data, error } = await window.supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error(error);
    return false;
  }
  return !!data;
}

function setBadge(text, kind) {
  if (!authBadgeEl) return;
  authBadgeEl.textContent = text;
  authBadgeEl.classList.remove("good", "bad");
  if (kind === "good") authBadgeEl.classList.add("good");
  if (kind === "bad") authBadgeEl.classList.add("bad");
}

function setEditEnabled(enabled) {
  const btnUndo = $("#btn-undo");
  const btnReset = $("#btn-reset-day");
  const menuGastos = document.querySelector('.menuItem[data-go="gastos"]');
  const menuEditar = document.querySelector('.menuItem[data-go="editar"]');
  const tabGastos = document.getElementById("tab-gastos");
  const tabEditar = document.getElementById("tab-editar");

  [btnUndo, btnReset].forEach((b) => {
    if (!b) return;
    b.disabled = !enabled;
    b.style.opacity = enabled ? "1" : "0.55";
    b.style.pointerEvents = enabled ? "auto" : "none";
  });

  [btnSavePrices, btnAddProduct, ...$$("#tab-editar input")].forEach((el) => {
    if (!el) return;
    el.disabled = !enabled;
    el.style.opacity = enabled ? "1" : "0.75";
  });

  [btnExpenseAdd, btnExpenseSave, btnExpenseCancel, ...$$("#tab-gastos input"), ...$$("#tab-gastos select")].forEach((el) => {
    if (!el) return;
    el.disabled = !enabled;
    el.style.opacity = enabled ? "1" : "0.75";
  });

  if (menuGastos) menuGastos.style.display = enabled ? "" : "none";
  if (menuEditar) menuEditar.style.display = enabled ? "" : "none";
  if (tabGastos) tabGastos.style.display = enabled ? "" : "none";
  if (tabEditar) tabEditar.style.display = enabled ? "" : "none";
  if (!enabled && activeTab === "gastos") goTo("cobrar");
  if (!enabled && activeTab === "editar") goTo("cobrar");

  if (editNoteEl) {
    const hasText = String(editNoteEl.textContent || "").trim().length > 0;
    editNoteEl.style.display = !enabled && hasText ? "block" : "none";
  }
  if (catalogLockNoteEl) {
    const hasText = String(catalogLockNoteEl.textContent || "").trim().length > 0;
    catalogLockNoteEl.style.display = !enabled && hasText ? "block" : "none";
  }
}

function applyCajaAccessUi() {
  const guestMode = !session?.user && !isAdmin;
  const canEditInitial = !guestMode;
  [
    cajaResumenCardEl,
    cajaMonthCardEl,
    cajaCarryoverCardEl,
    cajaPeyaCardEl,
    cajaExportCardEl,
  ].forEach((el) => el?.classList.toggle("hidden", guestMode));
  cajaCarroCardEl?.classList.remove("hidden");
  cajaCierreBlockEl?.classList.remove("hidden");
  cajaInicialBlockEl?.classList.toggle("hidden", guestMode);
  cashInitialReadonlyWrapEl?.classList.toggle("hidden", !guestMode);
  if (btnCashInitialSaveEl) {
    btnCashInitialSaveEl.disabled = !canEditInitial;
    btnCashInitialSaveEl.classList.toggle("hidden", !canEditInitial);
  }
  if (btnCashInitialEditEl) {
    btnCashInitialEditEl.disabled = !canEditInitial;
    btnCashInitialEditEl.classList.toggle("hidden", !canEditInitial);
  }
}

async function applyAuthState() {
  if (!hasSupabaseClient()) {
    let rememberedAdmin = false;
    try { rememberedAdmin = localStorage.getItem(LS_ADMIN_REMEMBER_KEY) === "1"; } catch {}
    if (!forceGuestMode && rememberedAdmin) {
      session = { user: { id: "offline-admin", email: ADMIN_CODE_EMAIL } };
      isAdmin = true;
    } else {
      session = null;
      isAdmin = false;
    }
    if (isAdmin && forceGuestMode) {
      forceGuestMode = false;
      try { localStorage.removeItem(FORCE_GUEST_KEY); } catch {}
    }
    applyAuthUi();
    return;
  }
  await refreshSession();
  isAdmin = await checkIsAdmin();
  if (isAdmin && forceGuestMode) {
    forceGuestMode = false;
    try { localStorage.removeItem(FORCE_GUEST_KEY); } catch {}
  }
  try { localStorage.setItem(LS_ADMIN_REMEMBER_KEY, isAdmin ? "1" : "0"); } catch {}
  applyAuthUi();
}

function applyAuthUi() {
  if (authUserEl) authUserEl.textContent = session?.user ? `Usuario: ${session.user.email}` : "";

  if (!session?.user) {
    setBadge("Invitado", "bad");
    setAuthMsg("Invitado: podes guardar ventas. Gastos y edicion solo admin.");
    setEditEnabled(false);
    applyCajaAccessUi();
    return;
  }

  if (!isAdmin) {
    setBadge("Usuario (no admin)", "bad");
    setAuthMsg("Usuario no admin: podes guardar ventas. Gastos y edicion solo admin.");
    setEditEnabled(false);
    applyCajaAccessUi();
    return;
  }

  setBadge("Admin OK", "good");
  setAuthMsg("Admin OK. Podes guardar ventas y editar catalogo.");
  if (forceGuestMode) {
    forceGuestMode = false;
    try { localStorage.removeItem(FORCE_GUEST_KEY); } catch {}
  }
  setEditEnabled(true);
  applyCajaAccessUi();
}

const menuBtn = $("#menu-btn");
const menuEl = $("#menu");
const menuWrap = $(".menuWrap");
let lastTouchAt = 0;

function isGhostClick() {
  return Date.now() - lastTouchAt < 450;
}

function goTo(tab) {
  if (!isAdmin && (tab === "gastos" || tab === "editar")) tab = "cobrar";
  activeTab = tab;
  $$(".panel").forEach((p) => p.classList.remove("show"));
  document.getElementById(`tab-${tab}`)?.classList.add("show");
  if (tab === "caja" || tab === "informacion" || tab === "gastos") initDeferredUi();
  $$(".menuItem").forEach((item) => {
    item.classList.toggle("is-active", String(item.dataset.go || "") === String(tab || ""));
  });
  try { localStorage.setItem(ACTIVE_TAB_KEY, tab); } catch {}
  closeMenu();
  applyPedidosYaTheme();
  renderAll();
}
function openMenu() {
  if (!menuEl || !menuBtn) return;
  menuEl.classList.add("show");
  menuEl.setAttribute("aria-hidden", "false");
  menuEl.inert = false;
  menuBtn.setAttribute("aria-expanded", "true");
}
function closeMenu() {
  if (!menuEl || !menuBtn) return;
  // Evita foco dentro de un contenedor oculto para no disparar warning de aria-hidden.
  if (menuEl.contains(document.activeElement)) menuBtn.focus();
  menuEl.classList.remove("show");
  menuEl.setAttribute("aria-hidden", "true");
  menuEl.inert = true;
  menuBtn.setAttribute("aria-expanded", "false");
}
function toggleMenu() {
  menuEl?.classList.contains("show") ? closeMenu() : openMenu();
}

if (menuBtn && menuEl && menuWrap) {
  menuEl.inert = true;
  const safePreventDefault = (e) => {
    if (e?.cancelable) e.preventDefault();
  };
  const onMenuToggle = (e) => {
    safePreventDefault(e);
    e.stopPropagation();
    toggleMenu();
  };
  const onMenuItemTap = (e) => {
    safePreventDefault(e);
    e.stopPropagation();
    const item = e.currentTarget;
    $$(".menuItem").forEach((el) => el.classList.remove("is-active"));
    item.classList.add("is-pressed");
    setTimeout(() => {
      item.classList.remove("is-pressed");
      goTo(item.dataset.go);
    }, 90);
  };

  menuBtn.addEventListener("touchstart", (e) => {
    lastTouchAt = Date.now();
    onMenuToggle(e);
  }, { passive: false });
  menuBtn.addEventListener("click", (e) => {
    if (isGhostClick()) return;
    onMenuToggle(e);
  });

  menuEl.addEventListener("click", (e) => e.stopPropagation());
  $$(".menuItem").forEach((item) => {
    item.addEventListener("touchstart", (e) => {
      lastTouchAt = Date.now();
      onMenuItemTap(e);
    }, { passive: false });
    item.addEventListener("click", (e) => {
      if (isGhostClick()) return;
      onMenuItemTap(e);
    });
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menuWrap.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}

function garrapinadasSubtotal(qty, unitPrice, channel) {
  qty = clampQty(qty);
  if (channel === "pedidosya") return { packs: 0, rest: qty, subtotal: qty * unitPrice, savings: 0 };
  const packs = Math.floor(qty / 3);
  const rest = qty % 3;
  const subtotal = packs * 3000 + rest * unitPrice;
  const full = qty * unitPrice;
  return { packs, rest, subtotal, savings: full - subtotal };
}

function cartTotal(cartObj, channel = activeChannel) {
  let total = 0;
  let g = { packs: 0, rest: 0, subtotal: 0, savings: 0 };

  for (const sku of getSkus()) {
    const qty = Number(cartObj[sku] || 0);
    const unit = getPrice(channel, sku);
    if (sku === "garrapinadas") {
      g = garrapinadasSubtotal(qty, unit, channel);
      total += g.subtotal;
    } else {
      total += qty * unit;
    }
  }

  return { total, garrapinadas: g };
}

function getCheckoutTotals(cartObj = getCart(), channel = activeChannel) {
  const base = cartTotal(cartObj, channel);
  const subtotal = Number(base.total || 0);
  if (channel !== "pedidosya") {
    return { subtotal, discountPct: 0, discountAmount: 0, total: subtotal, garrapinadas: base.garrapinadas };
  }

  const discountPct = Math.max(0, Math.min(100, Number(pedidosyaDiscountPct || 0)));
  const discountAmount = Math.round((subtotal * discountPct) / 100);
  const total = Math.max(0, subtotal - discountAmount);
  return { subtotal, discountPct, discountAmount, total, garrapinadas: base.garrapinadas };
}

function buildProductsGridSignature(skus) {
  const productPart = skus
    .map((sku) => {
      const p = getProduct(sku) || {};
      const pp = Number(p?.prices?.presencial || 0);
      const py = Number(p?.prices?.pedidosya || 0);
      return `${sku}:${String(p.name || "")}:${String(p.unit || "")}:${pp}:${py}`;
    })
    .join("|");
  return `${activeChannel}::${productPart}`;
}

function renderProductsGrid() {
  if (!productsGridEl) return;
  const skus = getSkus();

  if (!skus.length) {
    productsGridSignature = "";
    productsGridEl.innerHTML = `<div class="card" style="grid-column:1/-1;"><strong>No hay productos.</strong><p class="muted tiny">Cargalos en Supabase (tabla products).</p></div>`;
    return;
  }

  const nextSignature = buildProductsGridSignature(skus);
  if (nextSignature === productsGridSignature && productsGridEl.children.length > 0) {
    renderCart();
    return;
  }
  productsGridSignature = nextSignature;

  productsGridEl.innerHTML = skus
    .map((sku) => {
      const p = getProduct(sku);
      const price = getPrice(activeChannel, sku);
      const promo = sku === "garrapinadas" && activeChannel === "presencial" ? `<p class="hint" data-promo="garrapinadas">Promo: 3 por $3000</p>` : "";
      return `
        <div class="card product" data-sku="${sku}">
          <div class="row">
            <div>
              <h2>${getLabel(sku)}</h2>
              <p class="muted">$${money(price)}</p>
              ${promo}
            </div>
            <div class="pill">${p.unit || "Unidad"}</div>
          </div>
          <div class="counter">
            <button class="btn ghost counterIconBtn counterIconBtnMinus" data-action="dec" type="button" aria-label="Restar uno">
              <span aria-hidden="true"></span>
            </button>
            <input class="qty" type="number" inputmode="numeric" min="0" step="1" value="0" data-qty="${sku}" />
            <button class="btn ghost counterIconBtn counterIconBtnPlus" data-action="inc" type="button" aria-label="Sumar uno">
              <span aria-hidden="true"></span>
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  renderCart();
}

productsGridEl?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const card = e.target.closest(".product");
  const sku = card?.dataset?.sku;
  const action = btn.getAttribute("data-action");
  if (!sku || !action) return;

  const cart = { ...getCart() };
  if (action === "inc") cart[sku] = clampQty((cart[sku] || 0) + 1);
  if (action === "dec") cart[sku] = clampQty((cart[sku] || 0) - 1);
  setCart(cart);
  if (saveMsgEl) saveMsgEl.textContent = "";
  renderCart();
});

productsGridEl?.addEventListener("input", (e) => {
  const input = e.target.closest(".qty");
  if (!input) return;
  const sku = input.dataset.qty;
  const cart = { ...getCart() };
  cart[sku] = clampQty(input.value);
  setCart(cart);
  renderCart();
});

function renderEdit() {
  if (!priceEditorListEl) return;
  if (!products.length) {
    priceEditorListEl.innerHTML = `<div class="muted tiny">No hay productos.</div>`;
    return;
  }

  priceEditorListEl.innerHTML = products
    .map(
      (p) => `
    <div class="priceEditorRow" data-sku="${p.sku}">
      <div class="priceEditorName"><strong>${p.name}</strong><div class="muted tiny">${p.unit || "Unidad"}</div></div>
      <div class="editPrices">
        <label class="field"><span>Presencial</span><input type="number" min="0" step="50" data-price-edit="presencial" data-sku="${p.sku}" value="${p.prices.presencial}" /></label>
        <label class="field"><span>PedidosYa</span><input type="number" min="0" step="50" data-price-edit="pedidosya" data-sku="${p.sku}" value="${p.prices.pedidosya}" /></label>
      </div>
    </div>`
    )
    .join("");
}

btnSavePrices?.addEventListener("click", async () => {
  if (!isAdmin) return setCatalogMsg("Solo admin puede editar precios.");
  try {
    let changed = 0;
    for (const inp of $$('[data-price-edit]')) {
      const sku = inp.getAttribute("data-sku");
      const channel = inp.getAttribute("data-price-edit");
      const p = getProduct(sku);
      if (!p || !channel) continue;
      const nextValue = Math.max(0, Number(inp.value || 0));
      if (Number(p.prices[channel] || 0) !== nextValue) changed += 1;
      p.prices[channel] = nextValue;
    }

    const payload = products.map((p) => ({
      sku: p.sku,
      name: p.sku === "garrapinadas" ? "Garrapiñadas" : p.name,
      unit: p.unit || "Unidad",
      price_presencial: Number(p.prices?.presencial || 0),
      price_pedidosya: Number(p.prices?.pedidosya || 0),
    }));
    const { error } = await window.supabase.from("products").upsert(payload, { onConflict: "sku" });
    if (error) throw error;

    saveListCache(LS_PRODUCTS_KEY, products);
    renderProductsGrid();
    renderAll();
    setCatalogMsg(changed > 0 ? `Precios guardados (${changed} cambios).` : "No habia cambios para guardar.");
  } catch (e) {
    console.error(e);
    setCatalogMsg(`Error guardando precios: ${e?.message || "sin detalle"}`);
  }
});

btnAddProduct?.addEventListener("click", async () => {
  if (!isAdmin) return setCatalogMsg("Solo admin puede agregar productos.");

  const name = String($("#new-product-name")?.value || "").trim();
  const unit = String($("#new-product-unit")?.value || "Unidad").trim() || "Unidad";
  const pp = Math.max(0, Number($("#new-price-presencial")?.value || 0));
  const py = Math.max(0, Number($("#new-price-pedidosya")?.value || 0));

  if (!name) return setCatalogMsg("Pone un nombre.");

  const base = slugifySku(name);
  if (!base) return setCatalogMsg("El nombre no genera un SKU valido.");

  let sku = base;
  let n = 2;
  while (getProduct(sku)) {
    sku = `${base}_${n}`;
    n += 1;
  }

  const newProduct = { sku, name, unit, prices: { presencial: pp, pedidosya: py } };

  try {
    await upsertProductToDB(newProduct);
    products.push(newProduct);
    saveListCache(LS_PRODUCTS_KEY, products);
    ensureCartKeys();
    renderAll();
    $("#new-product-name").value = "";
    $("#new-product-unit").value = "";
    $("#new-price-presencial").value = "";
    $("#new-price-pedidosya").value = "";
    setCatalogMsg("Producto guardado en Supabase.");
  } catch (e) {
    console.error(e);
    setCatalogMsg("Error agregando producto en Supabase.");
  }
});

btnLoginCode?.addEventListener("click", async () => {
  try {
    if (!hasSupabaseClient()) {
      setBadge("Sin internet", "bad");
      setAuthMsg("Sin internet: no se puede iniciar sesion admin.");
      return;
    }
    setAuthMsg("Entrando con codigo...");
    const code = (authCodeEl?.value || "").trim();
    if (!code) return setAuthMsg("Ingresa un codigo.");

    // Si venimos de "Salir", desactiva invitado forzado antes de loguear.
    forceGuestMode = false;
    try { localStorage.removeItem(FORCE_GUEST_KEY); } catch {}

    const loginPromise = window.supabase.auth.signInWithPassword({
      email: ADMIN_CODE_EMAIL,
      password: code,
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout al iniciar sesion")), 10000)
    );
    const { data, error } = await Promise.race([loginPromise, timeoutPromise]);
    if (error) throw error;

    if (data?.session) session = data.session;
    isAdmin = await checkIsAdmin();
    try { localStorage.setItem(LS_ADMIN_REMEMBER_KEY, isAdmin ? "1" : "0"); } catch {}
    applyAuthUi();
    renderAll();
    if (isAdmin) goTo("cobrar");
  } catch (e) {
    console.error(e);
    try {
      const fallback = await window.supabase.auth.getSession();
      if (fallback?.data?.session) {
        session = fallback.data.session;
        isAdmin = await checkIsAdmin();
        applyAuthUi();
        renderAll();
        if (isAdmin) goTo("cobrar");
        return;
      }
    } catch {}
    setBadge("Error", "bad");
    setAuthMsg("No se pudo iniciar sesion. Probá de nuevo.");
  }
});

authCodeToggleEl?.addEventListener("click", () => {
  if (!authCodeEl) return;
  const show = authCodeEl.type === "password";
  authCodeEl.type = show ? "text" : "password";
  authCodeToggleEl.setAttribute("aria-pressed", show ? "true" : "false");
  authCodeToggleEl.setAttribute("aria-label", show ? "Ocultar código" : "Mostrar código");
});

authCodeEl?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  btnLoginCode?.click();
});

btnLogin?.addEventListener("click", async () => {});

btnLogout?.addEventListener("click", async () => {
  try {
    // Salida local inmediata (no depende de red)
    forceGuestMode = true;
    try { localStorage.setItem(FORCE_GUEST_KEY, "1"); } catch {}
    try { localStorage.setItem(LS_ADMIN_REMEMBER_KEY, "0"); } catch {}
    session = null;
    isAdmin = false;
    applyAuthUi();
    renderAll();
    goTo("cobrar");

    // No forzamos signOut remoto para no bloquear el siguiente login.
  } catch (e) {
    console.error(e);
    setAuthMsg("Se aplico salida local. Si sigue abierta en servidor, se cerrará al recargar.");
  }
});

function setActiveChannel(ch) {
  if (!["presencial", "pedidosya"].includes(ch)) return;
  activeChannel = ch;
  if (transferLabelEl) transferLabelEl.textContent = "Transferencia";
  tabPresencial?.classList.toggle("active", ch === "presencial");
  tabPedidosYa?.classList.toggle("active", ch === "pedidosya");
  syncPayModeByChannel();
  const cashMode = payModeEls.find((r) => r.value === "cash");
  if (cashMode) cashMode.checked = true;
  applyPedidosYaTheme();
  if (saveMsgEl) saveMsgEl.textContent = "";
  renderProductsGrid();
  renderCart();
  applyPayMode();
}

function applyPedidosYaTheme() {
  // Fondo rojo solo cuando el panel de Cobrar esta visible y el canal es PedidosYa.
  const cobrarVisible = document.getElementById("tab-cobrar")?.classList.contains("show");
  const enable = Boolean(cobrarVisible) && activeChannel === "pedidosya";
  document.body.classList.toggle("pedidosya-mode", enable);
}

tabPresencial?.addEventListener("click", () => setActiveChannel("presencial"));
tabPedidosYa?.addEventListener("click", () => setActiveChannel("pedidosya"));

const payModeEls = Array.from(document.querySelectorAll('input[name="paymode"]'));
const payModePeyaInputEl = document.querySelector('input[name="paymode"][value="peya"]');
const payModePeyaChipEl = payModePeyaInputEl?.closest("label");
const getPayMode = () => payModeEls.find((r) => r.checked)?.value || "cash";

function syncPayModeByChannel() {
  const showPeya = activeChannel === "pedidosya";
  payModePeyaChipEl?.classList.toggle("hidden", !showPeya);
  if (!showPeya && getPayMode() === "peya") {
    const transferMode = payModeEls.find((r) => r.value === "transfer");
    if (transferMode) transferMode.checked = true;
  }
}

function renderSplitDiff() {
  const { total } = getCheckoutTotals(getCart(), activeChannel);
  const cash = Number(cashEl?.value || 0);
  const transfer = Number(transferEl?.value || 0);
  const diff = cash + transfer - total;

  if (!cartHasItems(getCart())) {
    if (diffEl) diffEl.textContent = "-";
    diffEl?.classList.remove("good", "bad");
    return;
  }

  if (diff === 0) {
    if (diffEl) diffEl.textContent = "OK";
    diffEl?.classList.add("good");
    diffEl?.classList.remove("bad");
  } else {
    const label = diff < 0 ? "Falta" : "Sobra";
    if (diffEl) diffEl.textContent = `${label}: $${money(Math.abs(diff))}`;
    diffEl?.classList.remove("good");
    diffEl?.classList.add("bad");
  }
}

function renderCashChange() {
  const mode = getPayMode();
  const cart = getCart();
  const show = mode === "cash" && cartHasItems(cart);
  cashChangeAreaEl?.classList.toggle("hidden", !show);

  if (!show) {
    if (cashReceivedEl) cashReceivedEl.value = "";
    if (cashChangeEl) cashChangeEl.textContent = "—";
    cashChangeEl?.classList.remove("good", "bad");
    return;
  }

  const raw = String(cashReceivedEl?.value || "").trim();
  if (!raw) {
    if (cashChangeEl) cashChangeEl.textContent = "—";
    cashChangeEl?.classList.remove("good", "bad");
    return;
  }

  const paid = Math.max(0, parseNum(raw));
  const { total } = getCheckoutTotals(cart, activeChannel);
  const delta = paid - total;

  if (Math.abs(delta) < 0.01) {
    if (cashChangeEl) cashChangeEl.textContent = "Sin vuelto";
    cashChangeEl?.classList.add("good");
    cashChangeEl?.classList.remove("bad");
    return;
  }
  if (delta > 0) {
    if (cashChangeEl) cashChangeEl.textContent = `$${money(delta)}`;
    cashChangeEl?.classList.add("good");
    cashChangeEl?.classList.remove("bad");
    return;
  }
  if (cashChangeEl) cashChangeEl.textContent = `Falta: $${money(Math.abs(delta))}`;
  cashChangeEl?.classList.remove("good");
  cashChangeEl?.classList.add("bad");
}

function applyPayMode() {
  const mode = getPayMode();
  const cart = getCart();
  const { total } = getCheckoutTotals(cart, activeChannel);

  if (mixedArea) mixedArea.classList.toggle("hidden", mode !== "mixed");

  if (!cartHasItems(cart)) {
    if (mode !== "mixed") {
      if (cashEl) cashEl.value = "0";
      if (transferEl) transferEl.value = "0";
    }
    if (diffEl) {
      diffEl.textContent = "-";
      diffEl.classList.remove("good", "bad");
    }
    renderCashChange();
    return;
  }

  if (mode === "cash") {
    if (cashEl) cashEl.value = String(total);
    if (transferEl) transferEl.value = "0";
  } else if (mode === "transfer") {
    if (cashEl) cashEl.value = "0";
    if (transferEl) transferEl.value = String(total);
  } else if (mode === "peya") {
    if (cashEl) cashEl.value = "0";
    if (transferEl) transferEl.value = "0";
  } else {
    renderSplitDiff();
  }
  renderCashChange();
}

payModeEls.forEach((r) => r.addEventListener("change", () => applyPayMode()));
cashEl?.addEventListener("input", () => {
  if (getPayMode() === "mixed") renderSplitDiff();
});
transferEl?.addEventListener("input", () => {
  if (getPayMode() === "mixed") renderSplitDiff();
});
cashReceivedEl?.addEventListener("input", () => {
  renderCashChange();
});

pedidosyaDiscountEl?.addEventListener("input", () => {
  pedidosyaDiscountPct = Math.max(0, Math.min(100, Number(pedidosyaDiscountEl.value || 0)));
  pedidosyaDiscountEl.value = String(pedidosyaDiscountPct);
  renderCart();
});

function renderCart() {
  const cart = getCart();
  for (const sku of getSkus()) {
    const el = document.querySelector(`[data-qty="${sku}"]`);
    if (el) el.value = String(cart[sku] || 0);
  }

  const { subtotal, total, discountPct, discountAmount, garrapinadas } = getCheckoutTotals(cart, activeChannel);
  if (totalEl) totalEl.textContent = `$${money(subtotal)}`;
  if (summaryTitleEl) summaryTitleEl.textContent = activeChannel === "pedidosya" ? "Subtotal" : "Total";

  if (pedidosyaDiscountBoxEl) pedidosyaDiscountBoxEl.classList.toggle("hidden", activeChannel !== "pedidosya");
  if (pedidosyaDiscountAmountEl) pedidosyaDiscountAmountEl.textContent = `$${money(discountAmount)}`;
  if (pedidosyaFinalTotalEl) pedidosyaFinalTotalEl.textContent = `$${money(total)}`;
  if (pedidosyaDiscountEl && Number(pedidosyaDiscountEl.value || 0) !== discountPct) {
    pedidosyaDiscountEl.value = String(discountPct);
  }

  if (activeChannel === "presencial" && (cart.garrapinadas || 0) > 0 && garrapinadas.packs > 0) {
    const text = `Promo garrapiñadas: ${garrapinadas.packs}x(3 por $3000)` +
      (garrapinadas.rest ? ` + ${garrapinadas.rest} suelta(s)` : "") +
      (garrapinadas.savings > 0 ? ` · Ahorras $${money(garrapinadas.savings)}` : "");
    if (promoLineEl) promoLineEl.textContent = text;
  } else if (promoLineEl) {
    promoLineEl.textContent = "";
  }

  applyPayMode();
}

$("#btn-save")?.addEventListener("click", async () => {
  if (savingSaleInFlight) return;
  const cart = getCart();
  const { total } = getCheckoutTotals(cart, activeChannel);
  const mode = getPayMode();
  const saleDayKey = String(saleDateEl?.value || todayKey()).trim();

  if (!cartHasItems(cart)) return (saveMsgEl.textContent = "No hay productos cargados.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDayKey)) return (saveMsgEl.textContent = "Fecha invalida.");
  if (mode === "peya" && activeChannel !== "pedidosya") return (saveMsgEl.textContent = "PeYa solo esta disponible en PedidosYa.");
  let cash = Number(cashEl?.value || 0);
  let transfer = Number(transferEl?.value || 0);
  let peya = 0;
  if (mode === "cash") {
    cash = total;
    transfer = 0;
    peya = 0;
  } else if (mode === "transfer") {
    cash = 0;
    transfer = total;
    peya = 0;
  } else if (mode === "peya") {
    cash = 0;
    transfer = 0;
    peya = total;
  } else if (cash + transfer !== total) {
    return (saveMsgEl.textContent = "En mixto, efectivo + transferencia debe dar exacto.");
  }

  const sale = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    dayKey: saleDayKey,
    time: nowTime(),
    channel: activeChannel,
    items: Object.entries(cart)
      .filter(([, q]) => Number(q) > 0)
      .map(([sku, q]) => ({ sku, qty: Number(q), unitPrice: getPrice(activeChannel, sku) })),
    totals: { total, cash, transfer, peya },
  };

  savingSaleInFlight = true;
  const btnSaveSale = $("#btn-save");
  setBusyButton(btnSaveSale, true, "Guardando...");
  saveMsgEl.textContent = `Guardando venta (${formatDayKey(saleDayKey)})...`;

  try {
    await runWithRetry(() => insertSaleToDB(sale), 1, 350);
    sales = [...sales, sale];
    saveListCache(LS_SALES_KEY, sales);
    void loadSalesFromDB()
      .then((freshSales) => {
        if (applyLoadedSales(freshSales)) renderAll();
      })
      .catch(() => {});
    clearActiveCart();
    salesTodayExpanded = false;
    renderAll();
    saveMsgEl.textContent = `Venta guardada (${formatDayKey(saleDayKey)}).`;
  } catch (e) {
    console.error(e);
    saveMsgEl.textContent = `No se guardo la venta. Verifica conexion/permisos y reintenta (${e?.message || "sin detalle"}).`;
  } finally {
    savingSaleInFlight = false;
    setBusyButton(btnSaveSale, false);
  }
});

$("#btn-clear")?.addEventListener("click", () => {
  clearActiveCart();
  if (saveMsgEl) saveMsgEl.textContent = "";
  renderAll();
});

$("#btn-reset-day")?.addEventListener("click", async () => {
  if (!session?.user || !isAdmin) return alert("Solo admin puede reiniciar el dia.");
  const key = todayKey();
  try {
    await deleteDaySales(key);
    applyLoadedSales(await loadSalesFromDB());
    renderAll();
  } catch (e) {
    console.error(e);
    alert("Error reiniciando en Supabase.");
  }
});

$("#btn-undo")?.addEventListener("click", async () => {
  if (!session?.user || !isAdmin) return alert("Solo admin puede deshacer ventas.");
  const key = todayKey();
  const todayList = sales.filter((s) => s.dayKey === key);
  if (!todayList.length) return;

  const last = todayList.slice().sort((a, b) => a.time.localeCompare(b.time)).pop();
  try {
    await deleteSaleById(last.id);
    applyLoadedSales(await loadSalesFromDB());
    salesTodayExpanded = false;
    renderAll();
  } catch (e) {
    console.error(e);
    alert("Error deshaciendo en Supabase.");
  }
});

const salesByDay = (dayKey) => sales.filter((s) => s.dayKey === dayKey);
const salesToday = () => salesByDay(todayKey());
const monthKeyNow = () => todayKey().slice(0, 7);

function renderSaleCard(s) {
  const itemsText = s.items.map((it) => `${getLabel(it.sku)} x ${it.qty}`).join(" · ");
  const channelTag = s.channel ? ` · ${s.channel === "pedidosya" ? "PedidosYa" : "Presencial"}` : "";
  const payText = getSalePaymentLabel(s);

  return `
    <div class="sale" data-sale-id="${s.id}">
      <div class="sale-top">
        <div><strong>${s.time}</strong> <span class="muted tiny">· ${payText}${channelTag}</span></div>
        <div><strong>$${money(s.totals.total)}</strong></div>
      </div>
      <div class="sale-items">${itemsText}</div>
      <div class="actions" style="margin-top:8px;">
        <button class="btn ghost tinyBtn" data-edit-sale="${s.id}" type="button">Editar venta</button>
        <button class="btn danger ghost tinyBtn" data-delete-sale="${s.id}" type="button">Eliminar venta</button>
      </div>
    </div>
  `;
}

function calcTotalsForDay(dayKey) {
  const list = salesByDay(dayKey);
  let total = 0;
  let cash = 0;
  let transfer = 0;
  let peya = 0;
  const counts = {};
  for (const sku of getSkus()) counts[sku] = 0;

  for (const s of list) {
    const split = getVentasSplit(s);
    total += Number(s?.totals?.total || (Number(split.cash || 0) + Number(split.transfer || 0) + Number(split.peya || 0)));
    cash += Number(split.cash || 0);
    transfer += Number(split.transfer || 0);
    peya += Number(split.peya || 0);
    for (const it of s.items || []) {
      if (counts[it.sku] == null) counts[it.sku] = 0;
      counts[it.sku] += Number(it.qty || 0);
    }
  }

  return { total, cash, transfer, peya, counts, list };
}

function renderSalesList() {
  if (!salesListEl) return;
  const list = salesToday().slice().reverse();
  if (!list.length) {
    salesListEl.innerHTML = `<div class="muted tiny">Todavia no hay ventas guardadas hoy.</div>`;
    if (salesMoreWrapEl) salesMoreWrapEl.classList.add("hidden");
    if (salesLessTopWrapEl) salesLessTopWrapEl.classList.add("hidden");
    return;
  }

  const visibleList = salesTodayExpanded ? list : list.slice(0, 1);
  salesListEl.innerHTML = visibleList.map(renderSaleCard).join("");
  const canExpand = list.length > 1;
  if (salesMoreWrapEl) salesMoreWrapEl.classList.remove("hidden");
  if (salesLessTopWrapEl) salesLessTopWrapEl.classList.toggle("hidden", !canExpand || !salesTodayExpanded);
  if (btnSalesMoreEl) {
    btnSalesMoreEl.textContent = salesTodayExpanded ? "Ver menos" : "Ver mas";
    btnSalesMoreEl.disabled = !canExpand;
  }
}

btnSalesMoreEl?.addEventListener("click", () => {
  salesTodayExpanded = !salesTodayExpanded;
  renderSalesList();
});
btnSalesLessTopEl?.addEventListener("click", () => {
  salesTodayExpanded = false;
  renderSalesList();
});

function renderCaja() {
  if (!kpiTotalEl || !kpiCashEl || !kpiTransferEl || !kpiPeyaEl) return;
  const day = todayKey();
  const initialDay = cashInitialTargetDayKey();
  const { counts, list } = calcTotalsForDay(day);
  let cash = 0;
  let transfer = 0;
  let peya = 0;

  for (const s of list) {
    cash += Number(s?.totals?.cash || 0);
    transfer += Number(s?.totals?.transfer || 0);
    peya += Number(s?.totals?.peya || 0);
  }
  // En caja, PeYa de ventas no suma al total hasta que exista liquidacion.
  const baseTotal = cash + transfer;
  const initial = Math.max(0, parseNum(cashInitialEl?.value));
  const hasReal = String(cashRealEl?.value || "").trim().length > 0;
  const realCounted = hasReal ? parseNum(cashRealEl?.value) : 0;
  const netEndCash = hasReal ? (realCounted - initial) : null;
  const realNet = realCounted - initial;
  const deltaPreview = realNet - cash;
  const savedAdjust = cashAdjustByDay[initialDay];
  const hasSavedAdjust = (
    Boolean(savedAdjust?.adjust_saved)
    || (savedAdjust?.adjust_saved == null
      && savedAdjust != null
      && savedAdjust.real != null
      && Number.isFinite(Number(savedAdjust?.delta)))
  );
  const initialLocked = Boolean(savedAdjust?.initial_locked);
  const canEditInitial = Boolean(session?.user || isAdmin);
  const initialUnlockedForDay = String(cashInitialEditDay || "") === String(initialDay);
  const appliedDelta = hasSavedAdjust ? Number(savedAdjust.delta) : 0;
  const total = baseTotal + appliedDelta;

  if (cajaDateEl) cajaDateEl.textContent = `Caja - Fecha: ${formatDayKey(day)}`;
  kpiTotalEl.textContent = `$${money(total)}`;
  kpiCashEl.textContent = `$${money(cash)}`;
  kpiTransferEl.textContent = `$${money(transfer)}`;
  kpiPeyaEl.textContent = `$${money(peya)}`;
  if (kpiTotalNoteEl) {
    if (!hasSavedAdjust) {
      if (!hasReal) kpiTotalNoteEl.textContent = "Caja carro";
      else if (deltaPreview === 0) kpiTotalNoteEl.textContent = "Diferencia calculada: OK (falta guardar).";
      else if (deltaPreview > 0) kpiTotalNoteEl.textContent = `Sobrante detectado: +$${money(deltaPreview)} (falta guardar).`;
      else kpiTotalNoteEl.textContent = `Faltante detectado: -$${money(Math.abs(deltaPreview))} (falta guardar).`;
    } else if (appliedDelta === 0) kpiTotalNoteEl.textContent = "Ajuste guardado: sin diferencia.";
    else if (appliedDelta > 0) kpiTotalNoteEl.textContent = `Ajuste guardado por sobrante: +$${money(appliedDelta)}`;
    else kpiTotalNoteEl.textContent = `Ajuste guardado por faltante: -$${money(Math.abs(appliedDelta))}`;
  }

  if (countsEl) {
    countsEl.innerHTML = Object.keys(counts)
      .map((sku) => `<div class="count"><div>${getLabel(sku)}</div><div><strong>${counts[sku]}</strong></div></div>`)
      .join("");
  }

  if (cashInitialEl) cashInitialEl.disabled = !canEditInitial || (initialLocked && !initialUnlockedForDay);
  if (btnCashInitialSaveEl) btnCashInitialSaveEl.disabled = !canEditInitial;
  if (btnCashInitialEditEl) btnCashInitialEditEl.disabled = !canEditInitial;
  if (cashInitialReadonlyEl) cashInitialReadonlyEl.textContent = `$${money(initial)}`;
  if (cashNetEndEl) {
    cashNetEndEl.textContent = hasReal ? `$${money(netEndCash)}` : `$${money(0)}`;
    cashNetEndEl.classList.remove("good", "bad");
  }

  if (!hasReal) {
    if (cashDeltaEl) cashDeltaEl.textContent = `$${money(0)}`;
    cashDeltaEl?.classList.remove("good", "bad");
    return;
  }

  const cashDelta = (realCounted - initial) - cash;
  if (cashDelta === 0) {
    if (cashDeltaEl) cashDeltaEl.textContent = "OK";
    cashDeltaEl?.classList.add("good");
    cashDeltaEl?.classList.remove("bad");
  } else {
    const label = cashDelta < 0 ? "Faltante" : "Sobrante";
    if (cashDeltaEl) cashDeltaEl.textContent = `${label}: $${money(Math.abs(cashDelta))}`;
    cashDeltaEl?.classList.remove("good");
    cashDeltaEl?.classList.add("bad");
  }
}

function renderCashInitialHistory() {
  if (!cashInitialHistoryEl) return;
  const rows = Object.entries(cashAdjustByDay || {})
    .map(([day, v]) => ({
      day,
      initial: Math.max(0, Number(v?.initial || 0)),
      savedAt: String(v?.savedAt || ""),
      adjusted: Boolean(v?.adjust_saved),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && Number.isFinite(r.initial))
    .sort((a, b) => String(b.day).localeCompare(String(a.day)));

  if (!rows.length) {
    cashInitialHistoryEl.innerHTML = `<div class="muted tiny">Todavía no hay caja inicial guardada.</div>`;
    cashInitialHistoryLessTopWrapEl?.classList.add("hidden");
    cashInitialHistoryMoreWrapEl?.classList.add("hidden");
    return;
  }

  const visibleRows = cashInitialHistoryExpanded ? rows : rows.slice(0, 1);
  cashInitialHistoryEl.innerHTML = visibleRows.map((r) => {
    const status = r.adjusted ? " · cierre guardado" : "";
    return `
      <div class="sale">
        <div class="sale-top">
          <div><strong>${formatDayKey(r.day)}</strong><span class="muted tiny">${status}</span></div>
          <div><strong>$${money(r.initial)}</strong></div>
        </div>
      </div>
    `;
  }).join("");
  const canExpand = rows.length > 1;
  cashInitialHistoryLessTopWrapEl?.classList.toggle("hidden", !canExpand || !cashInitialHistoryExpanded);
  cashInitialHistoryMoreWrapEl?.classList.toggle("hidden", !canExpand);
  if (btnCashInitialHistoryMoreEl) {
    btnCashInitialHistoryMoreEl.disabled = !canExpand;
    btnCashInitialHistoryMoreEl.textContent = cashInitialHistoryExpanded ? "Ver menos" : "Ver mas";
  }
}

function upsertCashInitialHistoryForDay(day, initial) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return;
  const prev = cashAdjustByDay[day] || {};
  cashAdjustByDay[day] = {
    ...prev,
    initial: Math.max(0, Number(initial || 0)),
    initial_locked: Boolean(prev.initial_locked),
    savedAt: new Date().toISOString(),
  };
  saveCashAdjustStore(cashAdjustByDay);
}

function saveCashAdjustForToday() {
  const day = todayKey();
  const prev = cashAdjustByDay[day] || {};
  const rawInitial = String(cashInitialEl?.value ?? "").trim();
  const fallbackInitial = Math.max(0, Number(prev.initial || 0));
  const initial = rawInitial ? Math.max(0, parseNum(rawInitial)) : fallbackInitial;
  if (!String(cashRealEl?.value || "").trim()) {
    setCashAdjustMsg("Ingresa el efectivo real contado para guardar.");
    return;
  }
  const real = parseNum(cashRealEl.value);
  const { list } = calcTotalsForDay(day);
  let cash = 0;
  for (const s of list) cash += Number(s?.totals?.cash || 0);
  const delta = (real - initial) - cash;

  cashAdjustByDay[day] = {
    ...prev,
    initial,
    real,
    delta,
    adjust_saved: true,
    initial_locked: true,
    savedAt: new Date().toISOString(),
  };
  saveCashAdjustStore(cashAdjustByDay);
  cashInitialEditDay = "";
  saveCashInitialPersist(initial);
  if (cashRealEl) cashRealEl.value = "";
  setCashAdjustMsg("Ajuste guardado.");
  setCashInitialMsg("Caja inicial guardada.");
  renderCaja();
  renderCashInitialHistory();
}

function saveCashInitialForToday() {
  if (!session?.user && !isAdmin) {
    setCashInitialMsg("Modo invitado: no se puede modificar caja inicial.");
    return;
  }
  const day = cashInitialTargetDayKey();
  const initial = Math.max(0, parseNum(cashInitialEl?.value));
  const prev = cashAdjustByDay[day] || {};
  cashAdjustByDay[day] = {
    ...prev,
    initial,
    delta: null,
    adjust_saved: false,
    initial_locked: true,
    savedAt: new Date().toISOString(),
  };
  saveCashAdjustStore(cashAdjustByDay);
  cashInitialEditDay = "";
  saveCashInitialPersist(initial);
  setCashInitialMsg(`Caja inicial guardada para ${formatDayKey(day)}.`);
  setCashAdjustMsg("Para aplicar ajuste de caja, carga efectivo real y guarda ajuste.");
  renderCaja();
  renderCashInitialHistory();
}

function editCashInitialForToday() {
  if (!session?.user && !isAdmin) {
    setCashInitialMsg("Modo invitado: no se puede modificar caja inicial.");
    return;
  }
  const day = cashInitialTargetDayKey();
  const prev = cashAdjustByDay[day] || {
    initial: Math.max(0, parseNum(cashInitialEl?.value)),
    initial_locked: true,
    adjust_saved: false,
    delta: null,
  };
  const savedAt = new Date().toISOString();
  cashAdjustByDay[day] = { ...prev, initial_locked: false, delta: null, adjust_saved: false, savedAt };
  saveCashAdjustStore(cashAdjustByDay);
  cashInitialEditDay = day;
  setCashInitialMsg(`Podés modificar la caja inicial de ${formatDayKey(day)}.`);
  setCashAdjustMsg("Volvé a guardar el ajuste de caja real.");
  renderCaja();
  renderCashInitialHistory();
}

cashInitialEl?.addEventListener("input", () => {
  if (!session?.user && !isAdmin) return;
  const targetDay = cashInitialTargetDayKey();
  setCashInitialMsg(`Cambios en caja inicial sin guardar (se aplicará a ${formatDayKey(targetDay)}).`);
  renderCaja();
});
cashInitialEl?.addEventListener("focus", () => {
  if (!session?.user && !isAdmin) return;
  if (String(cashInitialEl.value ?? "").trim() === "0") {
    cashInitialEl.value = "";
  }
});
cashRealEl?.addEventListener("input", () => {
  setCashAdjustMsg("Cambios en caja real sin guardar.");
  renderCaja();
});
btnCashAdjustSaveEl?.addEventListener("click", saveCashAdjustForToday);
btnCashInitialSaveEl?.addEventListener("click", saveCashInitialForToday);
btnCashInitialEditEl?.addEventListener("click", editCashInitialForToday);
btnCashInitialHistoryMoreEl?.addEventListener("click", () => {
  cashInitialHistoryExpanded = !cashInitialHistoryExpanded;
  renderCashInitialHistory();
});
btnCashInitialHistoryLessTopEl?.addEventListener("click", () => {
  cashInitialHistoryExpanded = false;
  renderCashInitialHistory();
});

function renderTodaySummary() {
  const dk = todayKey();
  const { total, list } = calcTotalsForDay(dk);
  let cash = 0;
  let transfer = 0;
  let peya = 0;
  for (const s of list) {
    const split = getVentasSplit(s);
    cash += Number(split.cash || 0);
    transfer += Number(split.transfer || 0);
    peya += Number(split.peya || 0);
  }
  if (todayTitleEl) todayTitleEl.textContent = `Ventas - ${formatDayKey(dk)}`;
  if (todayTotalEl) todayTotalEl.textContent = `$${money(total)}`;
  if (todayCountEl) todayCountEl.textContent = String(list.length);
  if (todayCashEl) todayCashEl.textContent = `$${money(cash)}`;
  if (todayTransferEl) todayTransferEl.textContent = `$${money(transfer)}`;
  if (todayPeyaEl) todayPeyaEl.textContent = `$${money(peya)}`;
}

function renderMonthlySales() {
  if (!salesMonthInputEl || !monthTotalEl || !monthCashEl || !monthTransferEl || !monthPeyaEl) return;
  const month = String(salesMonthInputEl.value || monthKeyNow());
  if (!salesMonthInputEl.value) salesMonthInputEl.value = month;

  let cash = 0;
  let transfer = 0;
  let peya = 0;
  let qtyComun = 0;
  let qtyNegro = 0;
  let qtyBlanco = 0;
  for (const s of sales) {
    if (!String(s.dayKey || "").startsWith(`${month}-`)) continue;
    const split = getVentasSplit(s);
    cash += Number(split.cash || 0);
    transfer += Number(split.transfer || 0);
    peya += Number(split.peya || 0);
    for (const it of s.items || []) {
      const qty = Number(it?.qty || 0);
      if (it?.sku === "cubanito_comun") qtyComun += qty;
      if (it?.sku === "cubanito_negro") qtyNegro += qty;
      if (it?.sku === "cubanito_blanco") qtyBlanco += qty;
    }
  }
  const total = cash + transfer + peya;

  monthTotalEl.textContent = `$${money(total)}`;
  monthCashEl.textContent = `$${money(cash)}`;
  monthTransferEl.textContent = `$${money(transfer)}`;
  monthPeyaEl.textContent = `$${money(peya)}`;
  if (monthQtyComunEl) monthQtyComunEl.textContent = String(qtyComun);
  if (monthQtyNegroEl) monthQtyNegroEl.textContent = String(qtyNegro);
  if (monthQtyBlancoEl) monthQtyBlancoEl.textContent = String(qtyBlanco);
}

function calcCajaMonthlyData(month) {
  let cashSales = 0;
  let transferSales = 0;
  for (const s of sales) {
    if (!String(s.dayKey || "").startsWith(`${month}-`)) continue;
    cashSales += Number(s?.totals?.cash || 0);
    transferSales += Number(s?.totals?.transfer || 0);
  }

  let cashExpenses = 0;
  let transferExpenses = 0;
  let peyaExpenses = 0;
  for (const e of expenses) {
    if (!String(e.date || "").startsWith(`${month}-`)) continue;
    const split = expenseSplitPayments(e);
    cashExpenses += Number(split.cash || 0);
    transferExpenses += Number(split.transfer || 0);
    peyaExpenses += Number(split.peya || 0);
  }

  const carry = carryoverByMonth[month] || { cash: 0, transfer: 0, peya: 0 };
  const peyaLiqAmount = peyaLiquidations
    .filter((x) => String(x.month) === month)
    .reduce((acc, x) => acc + Number(x.amount || 0), 0);
  const cash = Number(carry.cash || 0) + (cashSales - cashExpenses);
  const transfer = Number(carry.transfer || 0) + (transferSales - transferExpenses);
  // En caja mensual, PeYa entra solo por saldo previo, gastos y liquidaciones.
  const peya = Number(carry.peya || 0) - peyaExpenses + peyaLiqAmount;
  const total = cash + transfer + peya;

  return { month, total, cash, transfer, peya };
}

function buildCajaMonthLedger(month) {
  const carry = carryoverByMonth[month] || { cash: 0, transfer: 0, peya: 0 };
  const entries = [];
  const toIsoKey = (day, hhmm = "00:00") => `${day}T${hhmm}:00`;

  if (Number(carry.cash || 0) || Number(carry.transfer || 0) || Number(carry.peya || 0)) {
    entries.push({
      kind: "carryover",
      sortKey: toIsoKey(`${month}-01`, "00:00"),
      title: `Saldo inicial del mes ${month}`,
      delta: {
        cash: Number(carry.cash || 0),
        transfer: Number(carry.transfer || 0),
        peya: Number(carry.peya || 0),
      },
    });
  }

  for (const s of sales) {
    const dayKey = String(s.dayKey || "");
    if (!dayKey.startsWith(`${month}-`)) continue;
    entries.push({
      kind: "sale",
      sortKey: toIsoKey(dayKey, String(s.time || "00:00")),
      title: `Venta ${formatDayKey(dayKey)} ${String(s.time || "").trim()} · ${String(s.channel || "presencial") === "pedidosya" ? "PedidosYa" : "Presencial"}`,
      delta: {
        cash: Number(s?.totals?.cash || 0),
        transfer: Number(s?.totals?.transfer || 0),
        // Las ventas PeYa no impactan caja hasta liquidacion.
        peya: 0,
      },
    });
  }

  for (const e of expenses) {
    const date = String(e.date || "");
    if (!date.startsWith(`${month}-`)) continue;
    const split = expenseSplitPayments(e);
    entries.push({
      kind: "expense",
      sortKey: toIsoKey(date, "23:00"),
      title: `Gasto ${formatDayKey(date)}${e.provider ? ` · ${e.provider}` : ""}`,
      delta: {
        cash: -Number(split.cash || 0),
        transfer: -Number(split.transfer || 0),
        peya: -Number(split.peya || 0),
      },
    });
  }

  for (const liq of peyaLiquidations) {
    if (String(liq.month || "") !== month) continue;
    const sortDay = String(liq.to || `${month}-28`);
    entries.push({
      kind: "peya_liq",
      sortKey: toIsoKey(sortDay, "23:30"),
      title: `Liquidación PeYa ${formatDayKey(liq.from)} a ${formatDayKey(liq.to)}`,
      delta: {
        cash: 0,
        transfer: 0,
        peya: Number(liq.amount || 0),
      },
    });
  }

  const order = { carryover: 0, sale: 1, expense: 2, peya_liq: 3 };
  entries.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)) || (order[a.kind] - order[b.kind]));

  const running = { cash: 0, transfer: 0, peya: 0, total: 0 };
  return entries.map((entry) => {
    running.cash += Number(entry.delta.cash || 0);
    running.transfer += Number(entry.delta.transfer || 0);
    running.peya += Number(entry.delta.peya || 0);
    running.total = running.cash + running.transfer + running.peya;
    return {
      ...entry,
      balance: { ...running },
    };
  });
}

function renderCajaMonthHistory() {
  if (!cajaMonthHistoryEl) return;
  const month = String(cajaMonthInputEl?.value || monthKeyNow());
  const rows = buildCajaMonthLedger(month).slice().reverse();

  if (!rows.length) {
    cajaMonthHistoryEl.innerHTML = `<div class="muted tiny">Todavía no hay movimientos para ${month}.</div>`;
    cajaMonthHistoryMoreWrapEl?.classList.add("hidden");
    cajaMonthHistoryLessTopWrapEl?.classList.add("hidden");
    cajaMonthHistoryLessBottomWrapEl?.classList.add("hidden");
    return;
  }

  const visibleRows = cajaMonthHistoryExpanded ? rows : rows.slice(0, 1);
  cajaMonthHistoryEl.innerHTML = visibleRows.map((r) => `
    <div class="sale">
      <div class="sale-top">
        <div><strong>${r.title}</strong></div>
        <div><strong>$${money(r.balance.total)}</strong></div>
      </div>
      <div class="sale-items">
        ${Number(r.delta.cash || 0) !== 0 ? `${Number(r.delta.cash) > 0 ? "Sumó" : "Restó"} efectivo $${money(Math.abs(Number(r.delta.cash)))} · Saldo efectivo $${money(r.balance.cash)}` : ""}
        ${Number(r.delta.transfer || 0) !== 0 ? `${Number(r.delta.cash || 0) !== 0 ? " · " : ""}${Number(r.delta.transfer) > 0 ? "Sumó" : "Restó"} transferencia $${money(Math.abs(Number(r.delta.transfer)))} · Saldo transferencia $${money(r.balance.transfer)}` : ""}
        ${Number(r.delta.peya || 0) !== 0 ? `${(Number(r.delta.cash || 0) !== 0 || Number(r.delta.transfer || 0) !== 0) ? " · " : ""}${Number(r.delta.peya) > 0 ? "Sumó" : "Restó"} PeYa $${money(Math.abs(Number(r.delta.peya)))} · Saldo PeYa $${money(r.balance.peya)}` : ""}
        · Saldo total $${money(r.balance.total)}
      </div>
    </div>
  `).join("");
  const canExpand = rows.length > 1;
  cajaMonthHistoryMoreWrapEl?.classList.toggle("hidden", !canExpand || cajaMonthHistoryExpanded);
  cajaMonthHistoryLessTopWrapEl?.classList.toggle("hidden", !canExpand || !cajaMonthHistoryExpanded);
  cajaMonthHistoryLessBottomWrapEl?.classList.toggle("hidden", !canExpand || !cajaMonthHistoryExpanded);
  if (btnCajaMonthHistoryMoreEl) btnCajaMonthHistoryMoreEl.textContent = "Ver mas";
}

function renderCajaMonthly() {
  if (!cajaMonthInputEl || !cajaMonthTotalEl || !cajaMonthCashEl || !cajaMonthTransferEl || !cajaMonthPeyaEl) return;
  const month = String(cajaMonthInputEl.value || monthKeyNow());
  if (!cajaMonthInputEl.value) cajaMonthInputEl.value = month;
  const snap = calcCajaMonthlyData(month);

  cajaMonthTotalEl.textContent = `$${money(snap.total)}`;
  cajaMonthCashEl.textContent = `$${money(snap.cash)}`;
  cajaMonthTransferEl.textContent = `$${money(snap.transfer)}`;
  cajaMonthPeyaEl.textContent = `$${money(snap.peya)}`;
  renderCajaMonthHistory();
}

function syncCarryoverInputs() {
  const month = String(cajaMonthInputEl?.value || monthKeyNow());
  const carry = carryoverByMonth[month] || { cash: 0, transfer: 0, peya: 0 };
  if (carryoverCashEl) carryoverCashEl.value = String(Number(carry.cash || 0));
  if (carryoverTransferEl) carryoverTransferEl.value = String(Number(carry.transfer || 0));
  if (carryoverPeyaEl) carryoverPeyaEl.value = String(Number(carry.peya || 0));
}

function syncPeyaLiqInputs() {
  if (peyaLiqAmountEl) peyaLiqAmountEl.value = "";
  const fp = peyaLiqRangeEl?._flatpickr;
  if (fp) {
    fp.clear();
  } else if (peyaLiqRangeEl) {
    peyaLiqRangeEl.value = "";
  }
}

function renderPeyaLiqHistory() {
  if (!peyaLiqHistoryEl) return;
  const month = String(cajaMonthInputEl?.value || monthKeyNow());
  const rows = peyaLiquidations
    .filter((x) => String(x.month) === month)
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  if (!rows.length) {
    peyaLiqHistoryEl.innerHTML = `<div class="muted tiny">Todavia no hay liquidaciones PeYa para ${month}.</div>`;
    return;
  }

  peyaLiqHistoryEl.innerHTML = rows.map((r) => `
    <div class="sale">
      <div class="sale-top">
        <div><strong>${r.month}</strong> <span class="muted tiny">· ${formatDayKey(r.from)} a ${formatDayKey(r.to)}</span></div>
        <div><strong>$${money(r.amount)}</strong></div>
      </div>
    </div>
  `).join("");
}

function renderCarryoverHistory() {
  if (!carryoverHistoryEl) return;
  const month = String(cajaMonthInputEl?.value || monthKeyNow());
  const rows = carryoverHistory
    .filter((x) => String(x.month) === month)
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  if (!rows.length) {
    carryoverHistoryEl.innerHTML = `<div class="muted tiny">Todavia no hay sobrantes cargados para ${month}.</div>`;
    return;
  }

  carryoverHistoryEl.innerHTML = rows.map((r) => `
    <div class="sale">
      <div class="sale-top">
        <div><strong>${r.month}</strong></div>
        <div><strong>$${money(Number(r.cash || 0) + Number(r.transfer || 0) + Number(r.peya || 0))}</strong></div>
      </div>
      <div class="sale-items">Efectivo $${money(r.cash)} · Transferencia $${money(r.transfer)} · PeYa $${money(r.peya)}</div>
    </div>
  `).join("");
}

function renderHistory() {
  if (!historyListEl) return;
  const existingDayKeys = Array.from(new Set(sales.map((s) => s.dayKey)));
  const dayKeys = buildContinuousDayKeys(existingDayKeys);

  if (!dayKeys.length) {
    historyListEl.innerHTML = `<div class="historyRow"><div><div><strong>${formatDayKey(todayKey())}</strong></div><div class="historyMeta">0 venta(s) · Efectivo $0 · Transf $0 · PeYa $0</div></div><div><strong>$0</strong></div></div>`;
    historyMoreWrapEl?.classList.add("hidden");
    historyLessTopWrapEl?.classList.add("hidden");
    historyMoreWrapBottomEl?.classList.add("hidden");
    return;
  }

  const visibleDayKeys = historyExpanded ? dayKeys : dayKeys.slice(0, 1);
  historyListEl.innerHTML = visibleDayKeys
    .map((dk) => {
      const { total, cash, transfer, peya, list } = calcTotalsForDay(dk);
      return `<div class="historyRow" data-day="${dk}"><div><div><strong>${formatDayKey(dk)}</strong></div><div class="historyMeta">${list.length} venta(s) · Efectivo $${money(cash)} · Transf $${money(transfer)} · PeYa $${money(peya)}</div></div><div><strong>$${money(total)}</strong></div></div>`;
    })
    .join("");

  $$(".historyRow").forEach((row) => row.addEventListener("click", () => openHistoryDay(row.dataset.day)));
  const canExpand = dayKeys.length > 0;
  historyMoreWrapEl?.classList.toggle("hidden", !canExpand || historyExpanded);
  historyLessTopWrapEl?.classList.toggle("hidden", !canExpand || !historyExpanded);
  historyMoreWrapBottomEl?.classList.toggle("hidden", !canExpand || !historyExpanded);
  if (btnHistoryMoreEl) btnHistoryMoreEl.textContent = "Ver mas";
  if (btnHistoryMoreBottomEl) btnHistoryMoreBottomEl.textContent = "Ver menos";
}

function openHistoryDay(dayKey) {
  if (!historyDetailEl || !historyListEl) return;
  if (!dayKey) return;
  const { total, list } = calcTotalsForDay(dayKey);
  let cash = 0;
  let transfer = 0;
  let peya = 0;
  let qtyComun = 0;
  let qtyNegro = 0;
  let qtyBlanco = 0;
  for (const s of list) {
    const split = getVentasSplit(s);
    cash += Number(split.cash || 0);
    transfer += Number(split.transfer || 0);
    peya += Number(split.peya || 0);
    for (const it of s.items || []) {
      const qty = Number(it?.qty || 0);
      if (it?.sku === "cubanito_comun") qtyComun += qty;
      if (it?.sku === "cubanito_negro") qtyNegro += qty;
      if (it?.sku === "cubanito_blanco") qtyBlanco += qty;
    }
  }

  if (historyTitleEl) historyTitleEl.textContent = `Historial - ${formatDayKey(dayKey)}`;
  if (histTotalEl) histTotalEl.textContent = `$${money(total)}`;
  if (histCashEl) histCashEl.textContent = `$${money(cash)}`;
  if (histTransferEl) histTransferEl.textContent = `$${money(transfer)}`;
  if (histPeyaEl) histPeyaEl.textContent = `$${money(peya)}`;
  if (histQtyComunEl) histQtyComunEl.textContent = String(qtyComun);
  if (histQtyNegroEl) histQtyNegroEl.textContent = String(qtyNegro);
  if (histQtyBlancoEl) histQtyBlancoEl.textContent = String(qtyBlanco);
  currentHistoryDayKey = dayKey;
  historyDaySalesExpanded = false;
  renderHistoryDaySales();

  historyDetailEl.classList.remove("hidden");
  historyListEl.classList.add("hidden");
  historyMoreWrapEl?.classList.add("hidden");
  historyLessTopWrapEl?.classList.add("hidden");
  historyMoreWrapBottomEl?.classList.add("hidden");
}

function renderHistoryDaySales() {
  if (!histSalesListEl) return;
  const dayList = salesByDay(currentHistoryDayKey).slice().reverse();
  if (!dayList.length) {
    histSalesListEl.innerHTML = `<div class="muted tiny">No hay ventas cargadas para este dia.</div>`;
    histSalesMoreWrapEl?.classList.add("hidden");
    return;
  }
  const visible = historyDaySalesExpanded ? dayList : dayList.slice(0, 1);
  histSalesListEl.innerHTML = visible.map(renderSaleCard).join("");
  const canExpand = dayList.length > 1;
  histSalesMoreWrapEl?.classList.toggle("hidden", !canExpand);
  if (btnHistSalesMoreEl) btnHistSalesMoreEl.textContent = historyDaySalesExpanded ? "Ver menos" : "Ver mas";
}

btnHistoryMoreEl?.addEventListener("click", () => {
  historyExpanded = !historyExpanded;
  renderHistory();
});
btnHistoryMoreBottomEl?.addEventListener("click", () => {
  historyExpanded = false;
  renderHistory();
});
btnHistoryLessTopEl?.addEventListener("click", () => {
  historyExpanded = false;
  renderHistory();
});
btnHistSalesMoreEl?.addEventListener("click", () => {
  historyDaySalesExpanded = !historyDaySalesExpanded;
  renderHistoryDaySales();
});

btnHistoryBack?.addEventListener("click", () => {
  historyDetailEl?.classList.add("hidden");
  historyListEl?.classList.remove("hidden");
  renderHistory();
});

function excelSerialFromYMD(y, m, d) {
  const utc = Date.UTC(y, m - 1, d);
  const epoch = Date.UTC(1899, 11, 30);
  return Math.floor((utc - epoch) / 86400000);
}

function excelSerialFromDayKey(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return excelSerialFromYMD(y, m, d);
}

function monthNameEsUpper(month) {
  const names = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
  ];
  return names[Number(month) - 1] || "";
}

function buildContinuousDayKeys(dayKeys) {
  if (!dayKeys.length) return [];
  const sortedAsc = dayKeys.slice().sort();
  const parse = (k) => {
    const [y, m, d] = String(k).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const out = [];
  let cur = parse(sortedAsc[0]);
  const lastRecordedKey = String(sortedAsc[sortedAsc.length - 1] || "");
  const endKey = String(todayKey()) > lastRecordedKey ? String(todayKey()) : lastRecordedKey;
  const last = parse(endKey);
  while (cur <= last) {
    out.push(fmt(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out.sort().reverse();
}

function calcDayForTemplate(daySales) {
  const out = {
    comunes: 0,
    banados: 0,
    otro: 0,
    efectivo: 0,
    transferencia: 0,
    pedidosya: 0,
    ventasPresencial: 0,
  };

  for (const s of daySales) {
    const channel = s.channel || "presencial";
    for (const it of s.items || []) {
      if (it.sku === "cubanito_comun") out.comunes += Number(it.qty || 0);
      else if (it.sku === "cubanito_blanco" || it.sku === "cubanito_negro") out.banados += Number(it.qty || 0);
      else out.otro += Number(it.qty || 0);
    }

    if (channel === "pedidosya") {
      out.pedidosya += Number(s.totals?.total || 0);
    } else {
      out.efectivo += Number(s.totals?.cash || 0);
      out.transferencia += Number(s.totals?.transfer || 0);
      out.ventasPresencial += Number(s.totals?.total || 0);
    }
  }
  return out;
}

function calcMonthForTemplate(year, month) {
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
  const byDay = new Map();

  const monthly = {
    transferencia: 0,
    efectivo: 0,
    pedidosya: 0,
    total: 0,
    comunes: 0,
    banados: 0,
  };

  for (const s of sales) {
    if (!String(s.dayKey || "").startsWith(monthPrefix)) continue;
    if (!byDay.has(s.dayKey)) byDay.set(s.dayKey, []);
    byDay.get(s.dayKey).push(s);
  }

  for (const [dayKey, daySales] of byDay.entries()) {
    const d = calcDayForTemplate(daySales);
    monthly.transferencia += d.transferencia;
    monthly.efectivo += d.efectivo;
    monthly.pedidosya += d.pedidosya;
    monthly.total += d.ventasPresencial + d.pedidosya;
    monthly.comunes += d.comunes;
    monthly.banados += d.banados;
  }

  return { byDay, monthly };
}

function expensesByMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  return expenses.filter((e) => String(e.date || "").startsWith(prefix));
}

function expenseSplitPayments(e) {
  const amount = Number(e.amount || 0);
  const cash = Number(e.pay_cash || 0);
  const transfer = Number(e.pay_transfer || 0);
  const peya = Number(e.pay_peya || 0);
  const method = normalizeExpenseMethod(e.method);

  if (method === "mixto") return { cash, transfer, peya };
  if (method === "efectivo") return { cash: amount, transfer: 0, peya: 0 };
  if (method === "transferencia") return { cash: 0, transfer: amount, peya: 0 };
  if (method === "peya") return { cash: 0, transfer: 0, peya: amount };
  return { cash, transfer, peya };
}

function setCellNumberPreserveStyle(ws, addr, value) {
  const n = Number(value || 0);
  if (ws[addr]) {
    // Si la celda tiene formula, no la pisamos (el Excel decide el calculo)
    if (ws[addr].f) return;
    ws[addr].t = "n";
    ws[addr].v = n;
    delete ws[addr].w;
    return;
  }
  ws[addr] = { t: "n", v: n };
}

$("#btn-export")?.addEventListener("click", async () => {
  const [year, month] = todayKey().split("-").map(Number);
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
  const monthSales = sales.filter((s) => String(s.dayKey || "").startsWith(monthPrefix));
  if (!monthSales.length) return alert("No hay ventas cargadas para este mes.");
  if (!window.XLSX) return alert("Falta libreria XLSX.");

  try {
    const monthName = monthNameEsUpper(month);
    const { byDay, monthly } = calcMonthForTemplate(year, month);
    const monthExpenses = expensesByMonth(year, month);

    const daysInMonth = new Date(year, month, 0).getDate();
    const rows = [];
    rows.push([`CUBANITOS PATAGONIA - VENTAS ${monthName} ${year}`]);
    rows.push([]);
    rows.push(["DIA", "COMUNES", "BAÑADOS", "OTRO", "EFECTIVO", "TRANSFERENCIA", "PEDIDOS YA", "VENTAS PRESENCIAL", "TOTAL DIA"]);

    for (let d = 1; d <= daysInMonth; d++) {
      const dayKey = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const daySales = byDay.get(dayKey) || [];
      const v = calcDayForTemplate(daySales);
      const totalDia = v.ventasPresencial + v.pedidosya;
      rows.push([
        dayKey,
        v.comunes,
        v.banados,
        v.otro,
        v.efectivo,
        v.transferencia,
        v.pedidosya,
        v.ventasPresencial,
        totalDia,
      ]);
    }

    rows.push([]);
    rows.push(["RESUMEN MENSUAL"]);
    rows.push(["Transferencia", monthly.transferencia]);
    rows.push(["Efectivo", monthly.efectivo]);
    rows.push(["PedidosYa", monthly.pedidosya]);
    rows.push(["Total mes", monthly.total]);
    rows.push([]);
    rows.push(["CONSUMO CUBANITOS"]);
    rows.push(["Comunes", monthly.comunes]);
    rows.push(["Bañados", monthly.banados]);

    // Hoja de gastos del mes
    const expenseRows = [];
    expenseRows.push([`CUBANITOS PATAGONIA - GASTOS ${monthName} ${year}`]);
    expenseRows.push([]);
    expenseRows.push([
      "FECHA",
      "ABONO",
      "RUBRO",
      "PROVEEDOR",
      "CANTIDAD",
      "DESCRIPCION",
      "$ c/IVA+Ing.Br",
      "EFECTIVO",
      "TRANSFERENCIA",
      "PEYA WALLET",
    ]);

    const orderedExpenses = monthExpenses
      .slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    let expTotal = 0;
    let expCash = 0;
    let expTransfer = 0;
    let expPeya = 0;

    for (const e of orderedExpenses) {
      const split = expenseSplitPayments(e);
      const tax = Number(e.iva || 0) + Number(e.iibb || 0);
      const totalWithTax = Number(e.amount || 0) + tax;
      expTotal += totalWithTax;
      expCash += split.cash;
      expTransfer += split.transfer;
      expPeya += split.peya;

      expenseRows.push([
        formatDayKey(e.date),
        "C",
        e.description || "",
        e.provider || "",
        Number(e.qty || 0),
        e.description || "",
        totalWithTax,
        split.cash,
        split.transfer,
        split.peya,
      ]);
    }

    expenseRows.push([]);
    expenseRows.push(["RESUMEN GASTOS", "", "", "", "", "", expTotal, expCash, expTransfer, expPeya]);

    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 13 },
      { wch: 15 }, { wch: 12 }, { wch: 18 }, { wch: 12 },
    ];

    const wse = window.XLSX.utils.aoa_to_sheet(expenseRows);
    wse["!cols"] = [
      { wch: 12 }, { wch: 8 }, { wch: 18 }, { wch: 20 }, { wch: 10 },
      { wch: 55 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
    ];

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, `VENTAS ${monthName}`);
    window.XLSX.utils.book_append_sheet(wb, wse, `GASTOS ${monthName}`);

    const out = window.XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CUBANITOS_VENTAS_${year}-${String(month).padStart(2, "0")}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert(e?.message || "Error exportando Excel de plantilla.");
  }
});

function expensesCurrentMonth() {
  const [y, m] = todayKey().split("-").map(Number);
  const prefix = `${y}-${String(m).padStart(2, "0")}-`;
  return expenses.filter((e) => String(e.date || "").startsWith(prefix));
}

function paymentMethodLabel(method) {
  const m = normalizeExpenseMethod(method);
  if (m === "transferencia") return "Transferencia";
  if (m === "peya") return "PeYa";
  if (m === "mixto") return "Mixto";
  return "Efectivo";
}

function normalizeExpenseMethod(method) {
  const raw = String(method || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
  if (!raw) return "efectivo";
  if (raw === "efectivo" || raw === "cash") return "efectivo";
  if (raw === "transferencia" || raw === "transfer" || raw === "transf") return "transferencia";
  if (raw === "peya" || raw === "pedidosya" || raw === "pedidoya" || raw === "wallet") return "peya";
  if (raw === "mixto" || raw === "mixta" || raw === "mixed") return "mixto";
  return raw;
}

function safeExpenseDescription(text) {
  const raw = String(text || "").trim();
  if (raw.length <= MAX_EXPENSE_DESC_LEN) return { value: raw, trimmed: false };
  return { value: `${raw.slice(0, MAX_EXPENSE_DESC_LEN - 3)}...`, trimmed: true };
}

function renderExpenseMixedDiff() {
  if (!expenseMixedDiffEl) return;
  if (expenseMethodEl?.value !== "mixto") {
    expenseMixedDiffEl.textContent = "";
    return;
  }
  const total = getExpenseTotal();
  const cash = parseNum(expensePayCashEl?.value);
  const transfer = parseNum(expensePayTransferEl?.value);
  const peya = parseNum(expensePayPeyaEl?.value);
  const diff = cash + transfer + peya - total;
  if (Math.abs(diff) < 0.01) {
    expenseMixedDiffEl.textContent = "OK";
  } else {
    const lbl = diff < 0 ? "Falta" : "Sobra";
    expenseMixedDiffEl.textContent = `${lbl}: $${money(Math.abs(diff))}`;
  }
}

function addCurrentExpenseItem() {
  const description = String(expenseDescEl?.value || "").trim();
  const directMode = getExpenseInputMode() === "direct";
  const qty = directMode ? 1 : Math.max(0, parseNum(expenseQtyEl?.value));
  const unitPrice = directMode
    ? Math.max(0, parseNum(expenseDirectAmountEl?.value))
    : Math.max(0, parseNum(expenseUnitPriceEl?.value));
  const amount = directMode ? unitPrice : qty * unitPrice;

  if (!description || description === ADD_NEW_SELECT_VALUE) {
    setExpenseMsg("Selecciona descripcion.");
    return false;
  }
  if (unitPrice <= 0) {
    setExpenseMsg(directMode ? "Ingresa un monto mayor a 0." : "Ingresa un precio unidad mayor a 0.");
    return false;
  }
  if (qty <= 0) {
    setExpenseMsg("Ingresa una cantidad mayor a 0.");
    return false;
  }

  expenseDraftItems.push({ description, qty, unitPrice, amount, directMode });
  if (expenseUnitPriceEl) expenseUnitPriceEl.value = "";
  if (expenseQtyEl) expenseQtyEl.value = "";
  if (expenseDirectAmountEl) expenseDirectAmountEl.value = "";
  if (expenseDescEl && expenseDescEl.options.length) expenseDescEl.selectedIndex = 0;
  setExpenseMsg("Item agregado. Podes cargar el siguiente.");
  renderExpenseTotals();
  renderExpenseMixedDiff();
  return true;
}

function renderExpenses() {
  if (!expenseListEl || !expenseKpiTotalEl || !expenseKpiCountEl) return;
  const monthList = expensesCurrentMonth();
  const total = monthList.reduce((acc, e) => acc + Number(e.amount || 0), 0);
  const list = expenses
    .slice()
    .sort((a, b) => {
      const d = String(b.date).localeCompare(String(a.date));
      if (d !== 0) return d;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });

  expenseKpiTotalEl.textContent = `$${money(total)}`;
  expenseKpiCountEl.textContent = String(monthList.length);
  const renderExpenseCard = (e) => `
    <div class="sale" data-expense-id="${e.id}">
      <div class="sale-top">
        <div><strong>${formatDayKey(e.date)}</strong> <span class="muted tiny">· ${e.provider} · ${paymentMethodLabel(e.method)}</span></div>
        <div><strong>$${money(e.amount)}</strong></div>
      </div>
      <div class="sale-items">${e.description}${
        e.method === "mixto" ? ` · Mix: Ef $${money(e.pay_cash)} / Tr $${money(e.pay_transfer)} / PeYa $${money(e.pay_peya)}` : ""
      }</div>
      <div class="actions" style="margin-top:8px;">
        <button class="btn ghost tinyBtn" data-edit-expense="${e.id}" type="button">Editar gasto</button>
        <button class="btn danger ghost tinyBtn" data-delete-expense="${e.id}" type="button">Eliminar gasto</button>
      </div>
    </div>
  `;

  const visibleGeneral = expensesExpanded ? list : list.slice(0, 1);
  expenseListEl.innerHTML = list.length
    ? visibleGeneral.map(renderExpenseCard).join("")
    : `<div class="muted tiny">Todavia no hay gastos cargados.</div>`;

  const hasManyGeneral = list.length > 1;
  if (expenseMoreWrapEl) expenseMoreWrapEl.classList.toggle("hidden", !hasManyGeneral || expensesExpanded);
  if (expenseLessTopWrapEl) expenseLessTopWrapEl.classList.toggle("hidden", !hasManyGeneral || !expensesExpanded);
  if (expenseLessBottomWrapEl) expenseLessBottomWrapEl.classList.toggle("hidden", !hasManyGeneral || !expensesExpanded);
  if (btnExpenseMoreEl) {
    btnExpenseMoreEl.disabled = !hasManyGeneral;
    btnExpenseMoreEl.style.opacity = hasManyGeneral ? "1" : "0.45";
    btnExpenseMoreEl.style.pointerEvents = hasManyGeneral ? "auto" : "none";
  }

  if (!expenseMonthInputEl?.value) expenseMonthInputEl.value = monthKeyNow();
  const month = String(expenseMonthInputEl?.value || monthKeyNow());
  const monthPrefix = `${month}-`;
  const monthExpenses = list.filter((e) => String(e.date || "").startsWith(monthPrefix));
  let monthCash = 0;
  let monthTransfer = 0;
  let monthPeya = 0;
  for (const e of monthExpenses) {
    const split = expenseSplitPayments(e);
    monthCash += Number(split.cash || 0);
    monthTransfer += Number(split.transfer || 0);
    monthPeya += Number(split.peya || 0);
  }
  const monthTotal = monthCash + monthTransfer + monthPeya;
  if (expenseMonthCashEl) expenseMonthCashEl.textContent = `$${money(monthCash)}`;
  if (expenseMonthTransferEl) expenseMonthTransferEl.textContent = `$${money(monthTransfer)}`;
  if (expenseMonthPeyaEl) expenseMonthPeyaEl.textContent = `$${money(monthPeya)}`;
  if (expenseMonthTotalEl) expenseMonthTotalEl.textContent = `$${money(monthTotal)}`;

  if (expenseMonthListEl) {
    expenseMonthListEl.innerHTML = monthExpenses.length
      ? monthExpenses.map((e, idx) => `
        <div class="sale" data-expense-id="${e.id}">
          <div class="sale-top">
            <div><strong>${idx + 1}. ${formatDayKey(e.date)}</strong> <span class="muted tiny">· ${e.provider} · ${paymentMethodLabel(e.method)}</span></div>
            <div><strong>$${money(e.amount)}</strong></div>
          </div>
          <div class="sale-items">${e.description}${
            e.method === "mixto" ? ` · Mix: Ef $${money(e.pay_cash)} / Tr $${money(e.pay_transfer)} / PeYa $${money(e.pay_peya)}` : ""
          }</div>
          <div class="actions" style="margin-top:8px;">
            <button class="btn ghost tinyBtn" data-edit-expense="${e.id}" type="button">Editar gasto</button>
            <button class="btn danger ghost tinyBtn" data-delete-expense="${e.id}" type="button">Eliminar gasto</button>
          </div>
        </div>
      `).join("")
      : `<div class="muted tiny">No hay gastos cargados para ese mes.</div>`;
  }
}

document.addEventListener("click", async (e) => {
  const expMoreBtn = e.target.closest("#btn-expense-more");
  if (expMoreBtn) {
    expensesExpanded = true;
    renderExpenses();
    return;
  }
  const expLessTopBtn = e.target.closest("#btn-expense-less-top");
  if (expLessTopBtn) {
    expensesExpanded = false;
    renderExpenses();
    return;
  }
  const expLessBottomBtn = e.target.closest("#btn-expense-less-bottom");
  if (expLessBottomBtn) {
    expensesExpanded = false;
    renderExpenses();
    return;
  }
  const editSaleBtn = e.target.closest("[data-edit-sale]");
  if (editSaleBtn) {
    if (!session?.user || !isAdmin) return alert("Solo admin puede editar ventas.");
    const id = editSaleBtn.getAttribute("data-edit-sale");
    const sale = sales.find((x) => String(x.id) === String(id));
    if (!sale) return;

    const nextChannelRaw = prompt("Canal (presencial/pedidosya):", String(sale.channel || "presencial"));
    if (nextChannelRaw == null) return;
    const nextChannel = String(nextChannelRaw).trim().toLowerCase();
    if (!["presencial", "pedidosya"].includes(nextChannel)) return alert("Canal invalido.");
    const nextItems = [];
    for (const it of sale.items || []) {
      const qtyRaw = prompt(`Cantidad para ${getLabel(it.sku)}:`, String(Number(it.qty || 0)));
      if (qtyRaw == null) return;
      const qty = Math.max(0, Number(qtyRaw || 0));
      if (!Number.isFinite(qty)) return alert("Cantidad invalida.");
      if (qty <= 0) continue;
      nextItems.push({ ...it, qty });
    }
    if (!nextItems.length) return alert("La venta debe tener al menos 1 item con cantidad mayor a 0.");

    const total = nextItems.reduce((acc, it) => acc + Number(it.qty || 0) * Number(it.unitPrice || 0), 0);
    const defaultMethod = Number(sale.totals?.cash || 0) > 0 && (Number(sale.totals?.transfer || 0) > 0 || Number(sale.totals?.peya || 0) > 0)
      ? "mixto"
      : Number(sale.totals?.cash || 0) > 0
      ? "efectivo"
      : Number(sale.totals?.peya || 0) > 0
      ? "peya"
      : "transferencia";
    const payMethodRaw = prompt("Metodo de pago (efectivo/transferencia/peya/mixto):", defaultMethod);
    if (payMethodRaw == null) return;
    const payMethod = String(payMethodRaw).trim().toLowerCase();
    if (!["efectivo", "transferencia", "peya", "mixto"].includes(payMethod)) return alert("Metodo invalido.");

    let nextCash = 0;
    let nextTransfer = 0;
    let nextPeya = 0;
    if (payMethod === "efectivo") {
      nextCash = total;
      nextTransfer = 0;
      nextPeya = 0;
    } else if (payMethod === "transferencia") {
      nextCash = 0;
      nextTransfer = total;
      nextPeya = 0;
    } else if (payMethod === "peya") {
      nextCash = 0;
      nextTransfer = 0;
      nextPeya = total;
    } else {
      const nextCashRaw = prompt("Mixto - Efectivo:", String(Number(sale.totals?.cash || 0)));
      if (nextCashRaw == null) return;
      const nextTransferRaw = prompt("Mixto - Transferencia:", String(Number(sale.totals?.transfer || 0)));
      if (nextTransferRaw == null) return;
      const nextPeyaRaw = prompt("Mixto - PeYa:", String(Number(sale.totals?.peya || 0)));
      if (nextPeyaRaw == null) return;
      nextCash = Math.max(0, Number(nextCashRaw || 0));
      nextTransfer = Math.max(0, Number(nextTransferRaw || 0));
      nextPeya = Math.max(0, Number(nextPeyaRaw || 0));
      if (!Number.isFinite(nextCash) || !Number.isFinite(nextTransfer) || !Number.isFinite(nextPeya)) return alert("Monto invalido.");
      if (Math.abs(nextCash + nextTransfer + nextPeya - total) > 0.01) return alert("En mixto, la suma debe dar el total.");
    }

    const updated = {
      ...sale,
      channel: nextChannel,
      items: nextItems,
      totals: { ...sale.totals, total, cash: nextCash, transfer: nextTransfer, peya: nextPeya },
    };
    try {
      await updateSaleInDB(updated);
      sales = sales.map((x) => (String(x.id) === String(updated.id) ? updated : x));
      saveListCache(LS_SALES_KEY, sales);
      renderAll();
      alert("Venta editada correctamente.");
    } catch (err) {
      console.error(err);
      alert(`Error editando venta: ${err?.message || "sin detalle"}`);
    }
    return;
  }

  const saleBtn = e.target.closest("[data-delete-sale]");
  if (saleBtn) {
    if (!session?.user || !isAdmin) return alert("Solo admin puede eliminar ventas.");
    const id = saleBtn.getAttribute("data-delete-sale");
    if (!id) return;
    const sale = sales.find((s) => String(s.id) === String(id));
    const saleTotal = Number(sale?.totals?.total || 0);
    const ok = confirm(`¿Confirmas eliminar esta venta${sale ? ` de $${money(saleTotal)}` : ""}?\nEsta acción no se puede deshacer.`);
    if (!ok) return;
    try {
      await deleteSaleById(id);
      applyLoadedSales(await loadSalesFromDB());
      salesTodayExpanded = false;
      renderAll();
      alert("Venta eliminada correctamente.");
    } catch (err) {
      console.error(err);
      alert(`Error eliminando venta: ${err?.message || "sin detalle"}`);
    }
    return;
  }

  const removeExpenseDraftBtn = e.target.closest("[data-remove-expense-draft]");
  if (removeExpenseDraftBtn) {
    const idx = Number(removeExpenseDraftBtn.getAttribute("data-remove-expense-draft"));
    if (!Number.isInteger(idx) || idx < 0 || idx >= expenseDraftItems.length) return;
    expenseDraftItems.splice(idx, 1);
    renderExpenseTotals();
    renderExpenseMixedDiff();
    setExpenseMsg("Item quitado.");
    return;
  }

  const editExpenseDraftBtn = e.target.closest("[data-edit-expense-draft]");
  if (editExpenseDraftBtn) {
    const idx = Number(editExpenseDraftBtn.getAttribute("data-edit-expense-draft"));
    loadExpenseDraftItemIntoForm(idx);
    return;
  }

  const editExpenseBtn = e.target.closest("[data-edit-expense]");
  if (editExpenseBtn) {
    if (!session?.user || !isAdmin) return alert("Solo admin puede editar gastos.");
    const id = editExpenseBtn.getAttribute("data-edit-expense");
    const exp = expenses.find((x) => String(x.id) === String(id));
    if (!exp) return;
    openExpenseFormForEdit(exp);
    return;
  }

  const expenseBtn = e.target.closest("[data-delete-expense]");
  if (expenseBtn) {
    if (!session?.user || !isAdmin) return alert("Solo admin puede eliminar gastos.");
    const id = expenseBtn.getAttribute("data-delete-expense");
    if (!id) return;
    const expense = expenses.find((x) => String(x.id) === String(id));
    const expenseAmount = Number(expense?.amount || 0);
    const ok = confirm(`¿Confirmas eliminar este gasto${expense ? ` de $${money(expenseAmount)}` : ""}?\nEsta acción no se puede deshacer.`);
    if (!ok) return;
    try {
      await deleteExpenseById(id);
      applyLoadedExpenses(await loadExpensesFromDB());
      if (expenseEditingId && String(expenseEditingId) === String(id)) resetExpenseForm();
      renderAll();
      alert("Gasto eliminado correctamente.");
    } catch (err) {
      console.error(err);
      alert(`Error eliminando gasto: ${err?.message || "sin detalle"}`);
    }
  }
});

btnExpenseAdd?.addEventListener("click", () => {
  if (!expenseFormWrapEl) return;
  const willShow = expenseFormWrapEl.classList.contains("hidden");
  expenseFormWrapEl.classList.toggle("hidden", !willShow);
  if (willShow) {
    if (expenseEditingId) resetExpenseForm();
  } else {
    resetExpenseForm();
  }
  setExpenseMsg("");
});

btnExpenseCancel?.addEventListener("click", () => {
  if (expenseFormWrapEl) expenseFormWrapEl.classList.add("hidden");
  resetExpenseForm();
  setExpenseMsg("");
});

expenseMethodEl?.addEventListener("change", () => {
  const isMixed = expenseMethodEl.value === "mixto";
  if (expenseMixedWrapEl) expenseMixedWrapEl.classList.toggle("hidden", !isMixed);
  renderExpenseMixedDiff();
});
expenseUnitPriceEl?.addEventListener("input", () => {
  renderExpenseTotals();
  renderExpenseMixedDiff();
});
expenseQtyEl?.addEventListener("input", () => {
  renderExpenseTotals();
  renderExpenseMixedDiff();
});
expenseDirectAmountEl?.addEventListener("input", () => {
  renderExpenseTotals();
  renderExpenseMixedDiff();
});
expensePayCashEl?.addEventListener("input", renderExpenseMixedDiff);
expensePayTransferEl?.addEventListener("input", renderExpenseMixedDiff);
expensePayPeyaEl?.addEventListener("input", renderExpenseMixedDiff);

expenseProviderEl?.addEventListener("change", () => {
  if (expenseProviderEl.value === ADD_NEW_SELECT_VALUE) {
    const added = addExpenseSelectOption("provider");
    if (!added && expenseProviders.length) expenseProviderEl.value = expenseProviders[0];
  }
  applyExpenseProviderRules();
  renderExpenseTotals();
  renderExpenseMixedDiff();
});

expenseDescEl?.addEventListener("change", () => {
  if (expenseDescEl.value !== ADD_NEW_SELECT_VALUE) return;
  const added = addExpenseSelectOption("description");
  if (!added && expenseDescriptions.length) expenseDescEl.value = expenseDescriptions[0];
  renderExpenseTotals();
  renderExpenseMixedDiff();
});

btnExpenseAddItem?.addEventListener("click", () => {
  addCurrentExpenseItem();
});

btnExpenseSave?.addEventListener("click", async () => {
  if (savingExpenseInFlight) return;
  if (!session?.user) return setExpenseMsg("Inicia sesion para guardar gastos.");
  if (!isAdmin) return setExpenseMsg("Solo admin puede guardar gastos.");
  const date = String(expenseDateEl?.value || "").trim();
  const provider = String(expenseProviderEl?.value || "").trim();
  const providerRule = getExpenseProviderRule();
  const directMode = getExpenseInputMode() === "direct";
  const currentDescription = String(expenseDescEl?.value || "").trim();
  const currentQty = directMode ? 1 : Math.max(0, parseNum(expenseQtyEl?.value));
  const currentUnitPrice = directMode
    ? Math.max(0, parseNum(expenseDirectAmountEl?.value))
    : Math.max(0, parseNum(expenseUnitPriceEl?.value));
  const currentAmount = directMode ? currentUnitPrice : currentQty * currentUnitPrice;
  const method = String(expenseMethodEl?.value || "efectivo");
  const payCash = Math.max(0, parseNum(expensePayCashEl?.value));
  const payTransfer = Math.max(0, parseNum(expensePayTransferEl?.value));
  const payPeya = Math.max(0, parseNum(expensePayPeyaEl?.value));
  const settlementRange = getSettlementRange();
  const isEditing = Boolean(expenseEditingId);
  const editingExpense = isEditing ? expenses.find((x) => String(x.id) === String(expenseEditingId)) : null;
  if (isEditing && !editingExpense) {
    resetExpenseForm();
    return setExpenseMsg("El gasto a editar ya no existe. Recarga la lista.");
  }

  const items = [...expenseDraftItems];
  if (currentAmount > 0 && currentDescription && currentDescription !== ADD_NEW_SELECT_VALUE) {
    items.push({
      description: currentDescription,
      qty: currentQty,
      unitPrice: currentUnitPrice,
      amount: currentAmount,
      directMode,
    });
  }
  const amount = items.reduce((acc, it) => acc + Number(it.amount || 0), 0);
  const qty = items.reduce((acc, it) => acc + Number(it.qty || 0), 0);
  const baseDescription = items
    .map((it) => (it.directMode ? `${it.description} $${money(it.amount)}` : `${it.description} x${it.qty} a $${money(it.unitPrice)}`))
    .join(" + ");
  const fullDescription = providerRule?.settlement && settlementRange
    ? `[${formatDayKey(settlementRange.from)} a ${formatDayKey(settlementRange.to)}] ${baseDescription}`
    : baseDescription;
  const { value: description, trimmed: descriptionTrimmed } = safeExpenseDescription(fullDescription);

  if (!date) return setExpenseMsg("Completa la fecha.");
  if (!provider || provider === ADD_NEW_SELECT_VALUE) return setExpenseMsg("Selecciona proveedor.");
  if (providerRule?.settlement) {
    if (!settlementRange) return setExpenseMsg("Selecciona el rango de fechas a liquidar.");
  }
  if (!items.length) return setExpenseMsg("Agrega al menos un item al gasto.");
  if (!description) return setExpenseMsg("Completa descripcion de items.");
  if (method === "mixto") {
    const sum = payCash + payTransfer + payPeya;
    if (Math.abs(sum - amount) > 0.01) return setExpenseMsg("En mixto, efectivo + transferencia + PeYa debe dar el monto total.");
  }

  const expense = {
    id: isEditing && editingExpense ? editingExpense.id : `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    date,
    provider,
    qty,
    description,
    iva: 0,
    iibb: 0,
    amount,
    method,
    pay_cash: method === "mixto" ? payCash : method === "efectivo" ? amount : 0,
    pay_transfer: method === "mixto" ? payTransfer : method === "transferencia" ? amount : 0,
    pay_peya: method === "mixto" ? payPeya : method === "peya" ? amount : 0,
  };

  if (isEditing) {
    savingExpenseInFlight = true;
    setBusyButton(btnExpenseSave, true, "Guardando...");
    try {
      await updateExpenseInDB(expense);
      expenses = expenses.map((x) => (String(x.id) === String(expense.id) ? expense : x));
      saveListCache(LS_EXPENSES_KEY, expenses);
      renderAll();
      setExpenseMsg(`Gasto editado. Total: $${money(amount)}${descriptionTrimmed ? " (descripcion resumida)" : ""}`);
      resetExpenseForm();
      if (expenseFormWrapEl) expenseFormWrapEl.classList.remove("hidden");
    } catch (e) {
      console.error(e);
      setExpenseMsg(`Error editando gasto: ${e?.message || "sin detalle"}`);
    } finally {
      savingExpenseInFlight = false;
      setBusyButton(btnExpenseSave, false);
    }
    return;
  }

  savingExpenseInFlight = true;
  setBusyButton(btnExpenseSave, true, "Guardando...");

  try {
    await runWithRetry(() => insertExpenseToDB(expense), 1, 350);
    applyLoadedExpenses(await loadExpensesFromDB());
    renderAll();
    setExpenseMsg(`Gasto guardado. Total: $${money(amount)}${descriptionTrimmed ? " (descripcion resumida)" : ""}`);
    resetExpenseForm();
    if (expenseFormWrapEl) expenseFormWrapEl.classList.remove("hidden");
  } catch (e) {
    console.error(e);
    setExpenseMsg(`No se guardo el gasto. Verifica conexion/permisos y reintenta (${e?.message || "sin detalle"}).`);
  } finally {
    savingExpenseInFlight = false;
    setBusyButton(btnExpenseSave, false);
  }
});

salesMonthInputEl?.addEventListener("change", renderMonthlySales);
btnSalesMonthMoreEl?.addEventListener("click", () => {
  if (salesMonthExtraEl) salesMonthExtraEl.classList.remove("hidden");
  if (salesMonthMoreWrapEl) salesMonthMoreWrapEl.classList.add("hidden");
  if (salesMonthLessWrapEl) salesMonthLessWrapEl.classList.remove("hidden");
});
btnSalesMonthLessEl?.addEventListener("click", () => {
  if (salesMonthExtraEl) salesMonthExtraEl.classList.add("hidden");
  if (salesMonthMoreWrapEl) salesMonthMoreWrapEl.classList.remove("hidden");
  if (salesMonthLessWrapEl) salesMonthLessWrapEl.classList.add("hidden");
});
btnCajaRealMoreEl?.addEventListener("click", () => setExpandableSection(cajaRealExtraEl, btnCajaRealMoreEl, btnCajaRealLessEl, true));
btnCajaRealLessEl?.addEventListener("click", () => setExpandableSection(cajaRealExtraEl, btnCajaRealMoreEl, btnCajaRealLessEl, false));
btnCarryoverMoreEl?.addEventListener("click", () => setExpandableSection(carryoverExtraEl, btnCarryoverMoreEl, btnCarryoverLessEl, true));
btnCarryoverLessEl?.addEventListener("click", () => setExpandableSection(carryoverExtraEl, btnCarryoverMoreEl, btnCarryoverLessEl, false));
btnPeyaLiqMoreEl?.addEventListener("click", () => setExpandableSection(peyaLiqExtraEl, btnPeyaLiqMoreEl, btnPeyaLiqLessEl, true));
btnPeyaLiqLessEl?.addEventListener("click", () => setExpandableSection(peyaLiqExtraEl, btnPeyaLiqMoreEl, btnPeyaLiqLessEl, false));
btnInfoMoreEl?.addEventListener("click", () => setExpandableSection(infoExtraEl, btnInfoMoreEl, btnInfoLessEl, true));
btnInfoLessEl?.addEventListener("click", () => setExpandableSection(infoExtraEl, btnInfoMoreEl, btnInfoLessEl, false));
btnCajaMonthHistoryMoreEl?.addEventListener("click", () => {
  cajaMonthHistoryExpanded = true;
  renderCajaMonthHistory();
});
btnCajaMonthHistoryLessTopEl?.addEventListener("click", () => {
  cajaMonthHistoryExpanded = false;
  renderCajaMonthHistory();
});
btnCajaMonthHistoryLessBottomEl?.addEventListener("click", () => {
  cajaMonthHistoryExpanded = false;
  renderCajaMonthHistory();
});
infoStatsModeDayEl?.addEventListener("click", () => setInfoStatsMode("day"));
infoStatsModePeriodEl?.addEventListener("click", () => setInfoStatsMode("period"));
infoStatsModeMonthEl?.addEventListener("click", () => setInfoStatsMode("month"));
infoStatsDayInputEl?.addEventListener("change", renderInfoStats);
infoStatsPeriodInputEl?.addEventListener("change", renderInfoStats);
infoStatsMonthInputEl?.addEventListener("change", renderInfoStats);
expenseMonthInputEl?.addEventListener("change", () => {
  renderExpenses();
});
[
  filterPresCashEl,
  filterPresTransferEl,
  filterPyCashEl,
  filterPyTransferEl,
  filterPyPeyaEl,
  filterExpCashEl,
  filterExpTransferEl,
  filterExpPeyaEl,
  filterCComunEl,
  filterCNegroEl,
  filterCBlancoEl,
].forEach((el) => el?.addEventListener("change", renderInfoByRange));

cajaMonthInputEl?.addEventListener("change", () => {
  cajaMonthHistoryExpanded = false;
  syncCarryoverInputs();
  syncPeyaLiqInputs();
  renderCajaMonthly();
  renderCarryoverHistory();
  renderPeyaLiqHistory();
});
btnCarryoverSaveEl?.addEventListener("click", async () => {
  const month = String(cajaMonthInputEl?.value || monthKeyNow());
  const cash = Math.max(0, Number(carryoverCashEl?.value || 0));
  const transfer = Math.max(0, Number(carryoverTransferEl?.value || 0));
  const peya = Math.max(0, Number(carryoverPeyaEl?.value || 0));
  const row = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    month,
    cash,
    transfer,
    peya,
    created_at: new Date().toISOString(),
  };
  try {
    await upsertCarryoverToDB(month, { cash, transfer, peya });
    try {
      await insertCarryoverHistoryToDB(row);
      carryoverHistory = await loadCarryoverHistoryFromDB();
    } catch (histErr) {
      if (String(histErr?.message || "") !== "missing_carryover_history_table") console.error(histErr);
      carryoverHistory.push(row);
      saveListCache(LS_CARRYOVER_HISTORY_LIST_KEY, carryoverHistory);
    }
    carryoverByMonth = await loadCarryoversFromDB();
    setCarryoverMsg(`Caja sobrante guardada para ${month}.`);
  } catch (e) {
    console.error(e);
    setCarryoverMsg(`No se guardo en nube para ${month}. No se aplicaron cambios locales.`);
  }
  renderCajaMonthly();
  renderCarryoverHistory();
});
btnPeyaLiqSaveEl?.addEventListener("click", () => {
  savePeyaLiquidation();
});

async function savePeyaLiquidation() {
  const month = String(cajaMonthInputEl?.value || monthKeyNow());
  const range = getPeyaLiqRange();
  if (!range) {
    setPeyaLiqMsg("Selecciona rango de fechas (desde/hasta).");
    return;
  }
  const amount = Math.max(0, Number(peyaLiqAmountEl?.value || 0));
  const row = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    month,
    from: range.from,
    to: range.to,
    amount,
    created_at: new Date().toISOString(),
  };

  try {
    await insertPeyaLiquidationToDB(row);
    peyaLiquidations = await loadPeyaLiquidationsFromDB();
  } catch (e) {
    if (String(e?.message || "") !== "missing_peya_liq_table") console.error(e);
    setPeyaLiqMsg("No se guardo la liquidacion en nube. No se aplicaron cambios locales.");
    return;
  }

  setPeyaLiqMsg(`Liquidacion PeYa guardada para ${month} (rango ${formatDayKey(range.from)} a ${formatDayKey(range.to)}).`);
  renderCajaMonthly();
  renderPeyaLiqHistory();
  syncPeyaLiqInputs();
}

function salesFingerprint(list) {
  return (list || [])
    .map((s) => `${s?.id}|${s?.dayKey}|${s?.time}|${Number(s?.totals?.total || 0)}|${Number(s?.totals?.cash || 0)}|${Number(s?.totals?.transfer || 0)}|${Number(s?.totals?.peya || 0)}|${String(s?.channel || "")}`)
    .join("~");
}

function expensesFingerprint(list) {
  return (list || [])
    .map((e) => `${e?.id}|${e?.date}|${Number(e?.amount || 0)}|${String(e?.method || "")}|${Number(e?.pay_cash || 0)}|${Number(e?.pay_transfer || 0)}|${Number(e?.pay_peya || 0)}|${String(e?.provider || "")}`)
    .join("~");
}

async function refreshLiveData(source = "poll", targets = ["sales", "expenses"]) {
  if (liveSyncInFlight) return;
  if (!hasSupabaseClient() || !navigator.onLine) return;
  liveSyncInFlight = true;
  try {
    const wantSales = targets.includes("sales");
    const wantExpenses = targets.includes("expenses");
    const tasks = [];
    if (wantSales) tasks.push(loadSalesFromDB());
    if (wantExpenses) tasks.push(loadExpensesFromDB());
    const loaded = await Promise.all(tasks);

    let idx = 0;
    const dbSales = wantSales ? loaded[idx++] : null;
    const dbExpenses = wantExpenses ? loaded[idx++] : null;

    const salesChanged = wantSales ? salesFingerprint(dbSales) !== salesFingerprint(sales) : false;
    const expensesChanged = wantExpenses ? expensesFingerprint(dbExpenses) !== expensesFingerprint(expenses) : false;
    if (!salesChanged && !expensesChanged) return;

    let applied = false;
    if (salesChanged) applied = applyLoadedSales(dbSales) || applied;
    if (expensesChanged) applied = applyLoadedExpenses(dbExpenses) || applied;
    if (applied) renderAll();
  } catch (e) {
    if (source === "realtime") console.error(e);
  } finally {
    liveSyncInFlight = false;
  }
}

function stopLiveSync() {
  if (liveSyncTimer) {
    clearInterval(liveSyncTimer);
    liveSyncTimer = null;
  }
  if (!liveSyncChannel) return;
  try {
    if (hasSupabaseClient() && typeof window.supabase.removeChannel === "function") {
      window.supabase.removeChannel(liveSyncChannel);
    } else if (typeof liveSyncChannel.unsubscribe === "function") {
      liveSyncChannel.unsubscribe();
    }
  } catch {}
  liveSyncChannel = null;
}

function startLiveSync() {
  stopLiveSync();
  if (!hasSupabaseClient()) return;

  try {
    if (typeof window.supabase.channel === "function") {
      liveSyncChannel = window.supabase
        .channel(`${STORAGE_PREFIX}-live-sync`)
        .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () => {
          void refreshLiveData("realtime", ["sales"]);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => {
          void refreshLiveData("realtime", ["expenses"]);
        })
        .subscribe();
    }
  } catch (e) {
    console.error(e);
  }

  liveSyncTimer = setInterval(() => {
    if (!navigator.onLine) return;
    void refreshLiveData("poll", ["sales", "expenses"]);
  }, LIVE_SYNC_POLL_MS);

  if (!liveSyncVisibilityBound) {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      void refreshLiveData("visibility", ["sales", "expenses"]);
    });
    liveSyncVisibilityBound = true;
  }
}

function renderAll() {
  const isVisible = (tab) => document.getElementById(`tab-${tab}`)?.classList.contains("show");
  const anyVisible = ["cobrar", "ventas", "caja", "gastos", "informacion", "editar", "sesion"].some((tab) => isVisible(tab));

  if (!anyVisible) {
    renderProductsGrid();
    return;
  }

  if (isVisible("cobrar")) {
    renderProductsGrid();
  }
  if (isVisible("ventas")) {
    renderSalesList();
    renderTodaySummary();
    renderMonthlySales();
    if (historyListEl && !historyListEl.classList.contains("hidden")) renderHistory();
  }
  if (isVisible("caja")) {
    renderCaja();
    renderCajaMonthly();
    renderCashInitialHistory();
    renderCarryoverHistory();
    renderPeyaLiqHistory();
  }
  if (isVisible("informacion")) {
    renderInfoByRange();
    renderInfoStats();
  }
  if (isVisible("gastos")) {
    renderExpenses();
  }
  if (isVisible("editar")) {
    renderEdit();
  }
}

window.addEventListener("online", () => {
  processOfflineQueue();
  void refreshLiveData("online");
});

(async function init() {
  try {
    clearLocalDataCaches();
    if (STRICT_CLOUD_SYNC) saveOfflineQueue([]);
    try { forceGuestMode = localStorage.getItem(FORCE_GUEST_KEY) === "1"; } catch {}
    try { hasPeyaLiqTable = localStorage.getItem(LS_HAS_PEYA_LIQ_TABLE_KEY) !== "0"; } catch {}
    cashAdjustByDay = loadCashAdjustStore();
    carryoverByMonth = loadObjectCache(LS_CARRYOVER_BY_MONTH_KEY);
    peyaLiquidations = loadListCache(LS_PEYA_LIQ_LIST_KEY);
    carryoverHistory = loadListCache(LS_CARRYOVER_HISTORY_LIST_KEY);
    cajaMonthHistory = loadCajaMonthHistoryStore();
    expenseProviders = loadDynamicList(EXPENSE_PROVIDERS, LS_EXPENSE_PROVIDERS_KEY);
    expenseProviders = sanitizeProviderList(expenseProviders);
    expenseDescriptions = loadDynamicList(EXPENSE_DESCRIPTIONS, LS_EXPENSE_DESCRIPTIONS_KEY);
    refreshExpenseSelects();
    resetExpenseForm();
    const cachedProducts = loadListCache(LS_PRODUCTS_KEY);
    products = cachedProducts.length ? cachedProducts : structuredClone(DEFAULT_PRODUCTS);
    sales = loadListCache(LS_SALES_KEY);
    expenses = loadListCache(LS_EXPENSES_KEY);
    ensureCartKeys();
    let initialTab = "cobrar";
    try { initialTab = localStorage.getItem(ACTIVE_TAB_KEY) || "cobrar"; } catch {}
    goTo(initialTab);
    scheduleDeferredUiInit();

    const authInitPromise = applyAuthState();
    const dbInitPromise = Promise.all([
      loadProductsFromDB(),
      loadSalesFromDB(),
      loadExpensesFromDB(),
      loadCarryoversFromDB(),
      loadCarryoverHistoryFromDB(),
      loadPeyaLiquidationsFromDB(),
    ]);
    await authInitPromise;
    const [dbProducts, dbSales, dbExpenses, dbCarryoverByMonth, dbCarryoverHistory, dbPeyaLiquidations] = await dbInitPromise;

    if (dbProducts && dbProducts.length) {
      products = dbProducts;
    } else {
      products = structuredClone(DEFAULT_PRODUCTS);
      if (isAdmin && dbProducts && dbProducts.length === 0) {
        void (async () => {
          for (const p of products) {
            try { await upsertProductToDB(p); } catch {}
          }
        })();
      }
    }
    applyLoadedSales(dbSales);
    applyLoadedExpenses(dbExpenses);
    carryoverByMonth = dbCarryoverByMonth;
    carryoverHistory = dbCarryoverHistory;
    peyaLiquidations = dbPeyaLiquidations;
    if (saleDateEl) saleDateEl.value = todayKey();
    if (cajaMonthInputEl) cajaMonthInputEl.value = monthKeyNow();
    if (infoStatsDayInputEl) infoStatsDayInputEl.value = todayKey();
    if (infoStatsMonthInputEl) infoStatsMonthInputEl.value = monthKeyNow();
    applyDefaultPickerRanges();
    syncCarryoverInputs();
    syncPeyaLiqInputs();
    const persistedInitial = loadCashInitialPersist();
    const day = todayKey();
    const initialDay = cashInitialTargetDayKey();
    const todayAdjust = cashAdjustByDay[day];
    const initialAdjust = cashAdjustByDay[initialDay];
    if (initialAdjust) {
      const initialValue = Number(initialAdjust.initial ?? persistedInitial ?? 0);
      if (cashInitialEl) cashInitialEl.value = String(initialValue);
    } else if (cashInitialEl) {
      const initialValue = Number(persistedInitial ?? 0);
      cashInitialEl.value = String(initialValue);
    }
    if (cashRealEl) cashRealEl.value = "";
    if (todayAdjust) {
      if (todayAdjust.adjust_saved) setCashAdjustMsg("Ajuste de caja real cargado.");
      else setCashAdjustMsg("Caja inicial cargada (ajuste pendiente).");
    }
    ensureCartKeys();
    if (salesMonthExtraEl) salesMonthExtraEl.classList.add("hidden");
    if (salesMonthMoreWrapEl) salesMonthMoreWrapEl.classList.remove("hidden");
    if (salesMonthLessWrapEl) salesMonthLessWrapEl.classList.add("hidden");
    setExpandableSection(cajaRealExtraEl, btnCajaRealMoreEl, btnCajaRealLessEl, true);
    setExpandableSection(carryoverExtraEl, btnCarryoverMoreEl, btnCarryoverLessEl, false);
    setExpandableSection(peyaLiqExtraEl, btnPeyaLiqMoreEl, btnPeyaLiqLessEl, false);
    setExpandableSection(infoExtraEl, btnInfoMoreEl, btnInfoLessEl, false);
    setInfoStatsMode("day");
    goTo(initialTab);
    processOfflineQueue();
    startLiveSync();

    if (hasSupabaseClient()) {
      window.supabase.auth.onAuthStateChange(async (_event, newSession) => {
        session = newSession;
        await applyAuthState();
        const [dbSales, dbExpenses, dbCarryoverByMonth, dbCarryoverHistory, dbPeyaLiquidations, dbProductsReload] = await Promise.all([
          loadSalesFromDB(),
          loadExpensesFromDB(),
          loadCarryoversFromDB(),
          loadCarryoverHistoryFromDB(),
          loadPeyaLiquidationsFromDB(),
          loadProductsFromDB(),
        ]);
        applyLoadedSales(dbSales);
        applyLoadedExpenses(dbExpenses);
        carryoverByMonth = dbCarryoverByMonth;
        carryoverHistory = dbCarryoverHistory;
        peyaLiquidations = dbPeyaLiquidations;
        if (dbProductsReload?.length) {
          products = dbProductsReload;
          ensureCartKeys();
        }
        renderAll();
        processOfflineQueue();
        startLiveSync();
      });
    }
  } catch (e) {
    console.error(e);
    setAuthMsg("Error inicializando la app.");
  }
})();

