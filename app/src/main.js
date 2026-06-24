import { supabase } from './supabase.js'

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

// --- 接続テスト ---
// PostgREST のルート(/rest/v1/)は anon では 401 になる仕様なので使わない。
// 代わりに supabase-js でクエリし、「PostgREST から応答が返れば接続成功」と判定する。
// テスト用テーブルは未作成なので「テーブルが無い」エラー(PGRST205 / 42P01)は想定内＝connected。
async function testSupabaseConnection() {
  const { error } = await supabase
    .from('__connection_test__')
    .select('*')
    .limit(1)

  if (!error) {
    console.log('Supabase connected（クエリ成功）')
    return true
  }

  const code = (error.code || '').toString()
  const msg = (error.message || '').toLowerCase()

  // PostgREST まで到達している＝接続OK（テーブル未作成は想定内）
  const tableMissing =
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table')

  // anon キー不正・未認可（publishable key 誤用などはここ）
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

  // 構造化エラーが返っている時点で到達はしている → connected 扱い
  console.warn('Supabase 応答あり（判定は要確認）:', error)
  return true
}

logEnvDebug()
console.log('bar-kanri dev 起動 / client:', !!supabase)

testSupabaseConnection().then((ok) => {
  const el = document.querySelector('#app')
  if (el) {
    el.textContent = ok
      ? 'bar-kanri dev — Supabase connected（コンソールを確認）'
      : 'bar-kanri dev — Supabase 認証エラー（コンソールを確認）'
  }
})
