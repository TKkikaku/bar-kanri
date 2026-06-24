import './style.css'
import { supabase } from './supabase.js'
import { isUnlocked, tryUnlock, lock } from './auth.js'

// --- DOM ---
const lockScreen = document.querySelector('#lock-screen')
const appMain = document.querySelector('#app-main')
const lockForm = document.querySelector('#lock-form')
const lockPassword = document.querySelector('#lock-password')
const lockError = document.querySelector('#lock-error')
const logoutBtn = document.querySelector('#logout-btn')
const connStatus = document.querySelector('#conn-status')

// --- env 読み込みデバッグ（Step A 用。値そのものは出さず先頭だけ） ---
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

// --- 接続テスト（Step A） ---
// PostgREST のルート(/rest/v1/)は anon では 401 になる仕様なので使わない。
// supabase-js でクエリし「PostgREST から応答が返れば接続成功」と判定する。
async function testSupabaseConnection() {
  const { error } = await supabase.from('__connection_test__').select('*').limit(1)

  if (!error) return true

  const code = (error.code || '').toString()
  const msg = (error.message || '').toLowerCase()

  const tableMissing =
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table')
  const authProblem =
    code === '401' ||
    code === 'PGRST301' ||
    msg.includes('jwt') ||
    msg.includes('invalid api key') ||
    msg.includes('no api key') ||
    msg.includes('unauthorized')

  if (tableMissing) {
    console.log('Supabase connected（PostgREST 応答あり / テスト用テーブル未作成は想定内）', error)
    return true
  }
  if (authProblem) {
    console.error('Supabase 認証エラー（anon キーを確認）:', error)
    return false
  }
  console.warn('Supabase 応答あり（判定は要確認）:', error)
  return true
}

async function runConnectionTest() {
  connStatus.textContent = 'Supabase 接続確認中…'
  const ok = await testSupabaseConnection()
  if (ok) console.log('Supabase connected')
  connStatus.textContent = ok
    ? 'Supabase connected（コンソールを確認）'
    : 'Supabase 認証エラー（コンソールを確認）'
}

// --- 画面遷移 ---
function showApp() {
  lockScreen.hidden = true
  appMain.hidden = false
  runConnectionTest()
}

function showLock() {
  appMain.hidden = true
  lockScreen.hidden = false
  lockError.hidden = true
  lockPassword.value = ''
  setTimeout(() => lockPassword.focus(), 0)
}

// --- イベント ---
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

logoutBtn.addEventListener('click', () => {
  lock()
  showLock()
})

// --- 起動 ---
logEnvDebug()
if (isUnlocked()) {
  showApp()
} else {
  showLock()
}
