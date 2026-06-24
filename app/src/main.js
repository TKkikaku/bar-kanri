import './style.css'
import { isUnlocked, tryUnlock, lock } from './auth.js'
import { getStore, setStore } from './store.js'
import { initInput } from './input.js'
import { initHistory, loadHistory } from './history.js'
import { initDashboard, loadDashboard } from './dashboard.js'
import { initSummary, loadSummary } from './summary.js'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

// --- DOM ---
const lockScreen = $('#lock-screen')
const appMain = $('#app-main')
const lockForm = $('#lock-form')
const lockPassword = $('#lock-password')
const lockError = $('#lock-error')

// ===================== env デバッグ =====================
function logEnvDebug() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  const fmt = key?.startsWith('eyJ')
    ? 'JWT (Legacy anon) ✓'
    : key?.startsWith('sb_')
      ? 'publishable (sb_*) ⚠️ 401になる可能性'
      : '不明 / 未設定'
  console.log('[env] VITE_SUPABASE_URL =', url || '(未設定)')
  console.log('[env] VITE_SUPABASE_ANON_KEY 先頭10 =', key ? key.slice(0, 10) + '…' : '(未設定)')
  console.log('[env] anon key 形式 =', fmt, '/ 長さ =', key ? key.length : 0)
}

// ===================== ルーティング（ページ切替） =====================
function showPage(name) {
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${name}`))
  $$('[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === name))
  if (name === 'dashboard') loadDashboard()
  if (name === 'history') loadHistory()
  if (name === 'summary') loadSummary()
}

// ===================== 店舗切替（§8） =====================
function renderStore() {
  const cur = getStore()
  $$('[data-store-btn]').forEach((b) => b.classList.toggle('active', b.dataset.storeBtn === cur))
}

// ===================== 画面遷移（ロック/本体） =====================
function showApp() {
  lockScreen.hidden = true
  appMain.hidden = false
  renderStore()
  initInput()
  initHistory()
  initDashboard()
  initSummary()
  showPage('dashboard')
}

function showLock() {
  appMain.hidden = true
  lockScreen.hidden = false
  lockError.hidden = true
  lockPassword.value = ''
  setTimeout(() => lockPassword.focus(), 0)
}

// ===================== イベント =====================
lockForm.addEventListener('submit', (e) => {
  e.preventDefault()
  if (tryUnlock(lockPassword.value)) {
    lockError.hidden = true
    showApp()
  } else {
    lockError.hidden = false
    lockPassword.select()
  }
})

// 本体内のクリックを委譲（ナビ / 店舗切替 / ログアウト）
appMain.addEventListener('click', (e) => {
  const navBtn = e.target.closest('[data-page]')
  if (navBtn) {
    showPage(navBtn.dataset.page)
    return
  }
  const storeBtn = e.target.closest('[data-store-btn]')
  if (storeBtn) {
    setStore(storeBtn.dataset.storeBtn)
    renderStore()
    console.log('[store] 切替 →', getStore())
    // 表示中の画面を店舗に合わせて更新
    if ($('#page-dashboard').classList.contains('active')) loadDashboard()
    if ($('#page-history').classList.contains('active')) loadHistory()
    if ($('#page-summary').classList.contains('active')) loadSummary()
    return
  }
  if (e.target.closest('.logout-link')) {
    lock()
    showLock()
  }
})

// ===================== 起動 =====================
logEnvDebug()
if (isUnlocked()) showApp()
else showLock()
