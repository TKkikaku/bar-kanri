// 店舗切り替え（§8）。権限・所属の概念はなく、表示対象店舗を切り替えるだけ。
// 店舗一覧はアプリ定数で保持（stores テーブルは作らない）。

export const STORES = ['スタンド', 'サンライズ']

const KEY = 'bk_store'

export function getStore() {
  const s = localStorage.getItem(KEY)
  return STORES.includes(s) ? s : STORES[0]
}

export function setStore(s) {
  if (STORES.includes(s)) {
    localStorage.setItem(KEY, s)
    return true
  }
  return false
}
