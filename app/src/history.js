import { fetchSalesByMonth, fetchExpensesByMonth } from './db.js'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

let inited = false
// 既定は当月（ローカル日付基準。dashboard/summary/input と統一）
let month = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})()
let filter = 'all' // all | sale | expense

const WD = ['日', '月', '火', '水', '木', '金', '土']
const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP')
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )

const fmtMonth = (m) => {
  const [y, mm] = m.split('-')
  return `${y}年${Number(mm)}月`
}
const fmtDate = (d) => {
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getMonth() + 1}/${dt.getDate()}（${WD[dt.getDay()]}）`
}

function shiftMonth(delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function mapSale(s) {
  const meta = [`${s.groups}組`]
  if (s.ages && s.ages.length) meta.push(s.ages.join('・'))
  if (s.nominated_drinks) meta.push(`指名ドリンク ${s.nominated_drinks}`)
  if (s.memo) meta.push(s.memo)
  return {
    type: 'sale',
    date: s.date,
    created_at: s.created_at || '',
    title: s.staff?.name || '(担当不明)',
    meta: meta.join(' / '),
    amount: s.amount,
    badges: ['売上'],
  }
}

function mapExpense(e) {
  const badges = ['支出']
  if (e.is_auto_back) badges.push('自動バック')
  return {
    type: 'expense',
    date: e.date,
    created_at: e.created_at || '',
    title: e.category,
    meta: e.memo || '',
    amount: e.amount,
    badges,
  }
}

function render(items) {
  const list = $('#hist-list')
  if (!items.length) {
    list.innerHTML = '<p class="muted" style="text-align:center;padding:32px 0;">この月の記録はありません</p>'
    return
  }
  const groups = {}
  items.forEach((it) => {
    ;(groups[it.date] ||= []).push(it)
  })
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a))

  list.innerHTML = dates
    .map((d) => {
      const rows = groups[d]
        .map(
          (it) => `
        <div class="rec">
          <div class="rec-main">
            <div class="rec-title">${esc(it.title)}</div>
            <div class="rec-amount ${it.type === 'sale' ? 'income' : 'expense'}">${it.type === 'sale' ? '+' : '−'}${yen(it.amount)}</div>
          </div>
          ${it.meta ? `<div class="rec-meta">${esc(it.meta)}</div>` : ''}
          <div class="rec-badges">${it.badges
            .map((b) => `<span class="badge ${b === '自動バック' ? 'auto' : it.type}">${b}</span>`)
            .join('')}</div>
        </div>`
        )
        .join('')
      return `<div class="rec-date">${fmtDate(d)}</div>${rows}`
    })
    .join('')
}

export async function loadHistory() {
  if (!inited) return
  $('#hist-month-label').textContent = fmtMonth(month)
  const list = $('#hist-list')
  list.innerHTML = '<p class="muted" style="text-align:center;padding:24px 0;">読み込み中…</p>'
  try {
    const [sales, expenses] = await Promise.all([
      filter === 'expense' ? [] : fetchSalesByMonth(month),
      filter === 'sale' ? [] : fetchExpensesByMonth(month),
    ])
    const items = [...sales.map(mapSale), ...expenses.map(mapExpense)]
    items.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
    render(items)
  } catch (err) {
    console.error('履歴の取得に失敗:', err)
    list.innerHTML = `<p class="form-msg err">読み込みに失敗しました: ${esc(err.message || err)}</p>`
  }
}

export function initHistory() {
  if (inited) return
  inited = true

  $('#hist-prev').addEventListener('click', () => {
    shiftMonth(-1)
    loadHistory()
  })
  $('#hist-next').addEventListener('click', () => {
    shiftMonth(1)
    loadHistory()
  })
  $('#hist-filter').addEventListener('click', (e) => {
    const t = e.target.closest('[data-hist-filter]')
    if (!t) return
    filter = t.dataset.histFilter
    $$('#hist-filter .tab').forEach((b) => b.classList.toggle('active', b === t))
    loadHistory()
  })
}
