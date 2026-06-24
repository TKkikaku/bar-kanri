// 単一パスワードによるアプリ全体ロック（§3）
// パスワードは env(VITE_APP_PASSWORD) で管理し、起動時に照合する。
// ※ クライアント側チェックのため秘匿性は低い（Anonymous Access 前提・§14）。

const UNLOCK_FLAG = 'bk_unlocked' // 解錠状態フラグ（localStorage）

export function isUnlocked() {
  return localStorage.getItem(UNLOCK_FLAG) === '1'
}

// 入力パスワードを照合。成功なら解錠状態を保存して true。
export function tryUnlock(input) {
  const expected = import.meta.env.VITE_APP_PASSWORD
  if (!expected) {
    console.warn('[auth] VITE_APP_PASSWORD が未設定です（app/.env.local を確認）')
    return false
  }
  const ok = input === expected
  if (ok) localStorage.setItem(UNLOCK_FLAG, '1')
  return ok
}

export function lock() {
  localStorage.removeItem(UNLOCK_FLAG)
}
