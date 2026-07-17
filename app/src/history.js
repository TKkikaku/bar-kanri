import { fetchSalesByMonth, fetchExpensesByMonth, deleteSlip, deleteExpense } from './db.js'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

let inited = false
// 既定は当月（ローカル日付基準。dashboard/summary/input と統一）
let month = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})()
let filter = 'all' // all | sale | expense
let lastItems = [] // 直近の描画内容（削除の確認文言をこの中から引く）

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

// 伝票を1行で表示（主担当を主役に、明細＝担当×杯数を meta に要約）
function mapSale(s) {
  const meta = []
  const detailText = (s.details || [])
    .map((d) => `${d.staff?.name || '?'}${d.drinks ? ` ${d.drinks}杯` : ''}`)
    .join('・')
  if (detailText) meta.push(detailText)
  if (s.ages && s.ages.length) meta.push(s.ages.join('・'))
  if (s.memo) meta.push(s.memo)
  return {
    type: 'sale',
    id: s.id,
    date: s.date,
    created_at: s.created_at || '',
    title: s.primary?.name || '(主担当不明)',
    meta: meta.join(' / '),
    amount: s.total_amount,
    badges: ['売上'],
    deletable: true,
    // 削除確認で「一緒に消えるバック」を提示するための合計（＝集約バック行の金額・§6）
    back: (s.details || []).reduce((a, d) => a + (d.back_amount || 0), 0),
  }
}

function mapExpense(e) {
  const badges = ['支出']
  if (e.is_auto_back) badges.push('自動バック')
  return {
    type: 'expense',
    id: e.id,
    date: e.date,
    created_at: e.created_at || '',
    title: e.category,
    meta: e.memo || '',
    amount: e.amount,
    badges,
    // 自動バック行は伝票の従属物。単体で消すと整合性が壊れるので削除させない（伝票削除時に cascade で消える・§7.3）
    deletable: !e.is_auto_back,
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
        <div class="rec" data-id="${it.id}" data-type="${it.type}">
          <div class="rec-main">
            <div class="rec-title">${esc(it.title)}</div>
            <div class="rec-amount ${it.type === 'sale' ? 'income' : 'expense'}">${it.type === 'sale' ? '+' : '−'}${yen(it.amount)}</div>
          </div>
          ${it.meta ? `<div class="rec-meta">${esc(it.meta)}</div>` : ''}
          <div class="rec-badges">${it.badges
            .map((b) => `<span class="badge ${b === '自動バック' ? 'auto' : it.type}">${b}</span>`)
            .join('')}${
            it.deletable
              ? '<button type="button" class="btn-mini danger rec-del">削除</button>'
              : ''
          }</div>
        </div>`
        )
        .join('')
      return `<div class="rec-date">${fmtDate(d)}</div>${rows}`
    })
    .join('')
}

function showMsg(text, kind) {
  const el = $('#hist-msg')
  el.textContent = text
  el.className = 'form-msg ' + (kind || '')
  el.hidden = false
  if (kind === 'ok') setTimeout(() => (el.hidden = true), 2500)
}

// 記録の削除（§7.3）。伝票は1文で明細＋集約バック行ごと消える（cascade・§6）。
async function handleDelete(row) {
  const id = row.dataset.id
  const type = row.dataset.type
  const it = lastItems.find((x) => x.id === id && x.type === type)
  if (!it) return

  // 何が一緒に消えるかを明示する（バックは伝票削除で cascade により同時に消えるため）
  const backNote =
    it.type === 'sale' && it.back > 0
      ? `\n自動計上されたバック ${yen(it.back)} も一緒に削除されます。`
      : ''
  const what = it.type === 'sale' ? '伝票' : '支出'
  const ok = window.confirm(
    `${fmtDate(it.date)} ${it.title} ${yen(it.amount)} の${what}を削除しますか？${backNote}\nこの操作は取り消せません。`
  )
  if (!ok) return

  const btn = row.querySelector('.rec-del')
  if (btn) {
    btn.disabled = true
    btn.textContent = '削除中…'
  }
  try {
    if (it.type === 'sale') await deleteSlip(id)
    else await deleteExpense(id)
    await loadHistory()
    showMsg(`${what}を削除しました`, 'ok')
  } catch (err) {
    console.error('削除に失敗:', err)
    if (btn) {
      btn.disabled = false
      btn.textContent = '削除'
    }
    showMsg('削除に失敗しました: ' + (err.message || err), 'err')
  }
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
    lastItems = items
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

  // 削除ボタン（委譲）。行は再描画で作り直されるのでリスナーは一覧側に置く。
  $('#hist-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.rec-del')
    if (!btn) return
    const row = btn.closest('.rec')
    if (row) handleDelete(row)
  })
}
