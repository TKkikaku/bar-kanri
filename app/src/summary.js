import { fetchSalesByMonth, fetchExpensesByMonth, fetchGoal } from './db.js'

const $ = (sel, root = document) => root.querySelector(sel)

let inited = false
let month = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})()

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
function shiftMonth(delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 横棒（最大値に対する割合）
function barRows(entries, fmtVal) {
  const max = Math.max(1, ...entries.map((e) => e.value))
  return entries
    .map(
      (e) => `
    <div class="bd-row">
      <div class="bd-top"><span>${esc(e.label)}</span><span>${fmtVal(e.value)}</span></div>
      <div class="bd-bar"><div class="bd-fill" style="width:${Math.round((e.value / max) * 100)}%"></div></div>
    </div>`
    )
    .join('')
}

function agesText(ages) {
  const ent = Object.entries(ages).sort((a, b) => b[1] - a[1])
  if (!ent.length) return '—'
  return ent.map(([t, c]) => `${t}${c > 1 ? '×' + c : ''}`).join(' / ')
}

// 担当別集計（§9）
function aggregateStaff(sales) {
  const map = new Map()
  sales.forEach((r) => {
    const id = r.staff_member_id
    let a = map.get(id)
    if (!a) {
      a = { name: r.staff?.name || '(担当不明)', is_free: !!r.staff?.is_free, sales: 0, groups: 0, drinks: 0, ages: {} }
      map.set(id, a)
    }
    a.sales += r.amount || 0
    a.groups += r.groups || 0
    a.drinks += r.nominated_drinks || 0
    ;(r.ages || []).forEach((t) => {
      a.ages[t] = (a.ages[t] || 0) + 1
    })
  })
  return [...map.values()].sort((x, y) => y.sales - x.sales)
}

export async function loadSummary() {
  if (!inited) return
  $('#sum-month-label').textContent = fmtMonth(month)
  const root = $('#sum-body')
  root.innerHTML = '<p class="muted" style="text-align:center;padding:24px 0;">読み込み中…</p>'

  try {
    const [sales, expenses, goal] = await Promise.all([
      fetchSalesByMonth(month),
      fetchExpensesByMonth(month),
      fetchGoal(month),
    ])

    const totalSales = sales.reduce((s, r) => s + (r.amount || 0), 0)
    const totalExpense = expenses.reduce((s, r) => s + (r.amount || 0), 0)
    const profit = totalSales - totalExpense

    // 月次サマリ
    const totalsHtml =
      `<div class="sum-totals">` +
      `<div class="sum-tile income"><span class="st-k">売上</span><span class="st-v">${yen(totalSales)}</span></div>` +
      `<div class="sum-tile expense"><span class="st-k">支出</span><span class="st-v">${yen(totalExpense)}</span></div>` +
      `<div class="sum-tile profit"><span class="st-k">利益</span><span class="st-v">${yen(profit)}</span></div>` +
      `</div>`

    // 目標達成率
    let goalHtml
    if (goal && goal.target > 0) {
      const pct = Math.round((totalSales / goal.target) * 100)
      goalHtml =
        `<div class="goal-head"><span>${pct}%</span><span class="muted">${yen(totalSales)} / ${yen(goal.target)}</span></div>` +
        `<div class="bd-bar lg"><div class="bd-fill ${pct >= 100 ? 'done' : ''}" style="width:${Math.min(100, pct)}%"></div></div>`
    } else {
      goalHtml = '<p class="muted">目標未設定（設定タブで設定できます）</p>'
    }

    // 担当別集計
    const staff = aggregateStaff(sales)
    const staffHtml = staff.length
      ? staff
          .map(
            (s) => `
        <div class="staff-card">
          <div class="sc-head">
            <span class="sc-name">${esc(s.name)}${s.is_free ? ' <span class="badge auto">フリー</span>' : ''}</span>
            <span class="sc-sales">${yen(s.sales)}</span>
          </div>
          <div class="sc-grid">
            <div class="sc-cell"><span class="sc-k">組数</span><span class="sc-v">${s.groups}</span></div>
            <div class="sc-cell"><span class="sc-k">指名ドリンク</span><span class="sc-v">${s.drinks}</span></div>
          </div>
          <div class="sc-ages"><span class="sc-k">客層</span> ${esc(agesText(s.ages))}</div>
        </div>`
          )
          .join('')
      : '<p class="muted">売上記録がありません</p>'

    // 支出カテゴリ別（バック自動計上を含む）
    const catMap = {}
    expenses.forEach((e) => {
      catMap[e.category] = (catMap[e.category] || 0) + (e.amount || 0)
    })
    const catEntries = Object.entries(catMap)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
    const catHtml = catEntries.length ? barRows(catEntries, yen) : '<p class="muted">支出がありません</p>'

    // 客層（年代タグ）集計
    const ageMap = {}
    sales.forEach((r) => (r.ages || []).forEach((t) => (ageMap[t] = (ageMap[t] || 0) + 1)))
    const ageEntries = Object.entries(ageMap)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
    const ageHtml = ageEntries.length
      ? barRows(ageEntries, (v) => `${v}件`)
      : '<p class="muted">客層の記録がありません</p>'

    // 曜日別 売上
    const wd = [0, 0, 0, 0, 0, 0, 0]
    sales.forEach((r) => {
      const d = new Date(r.date + 'T00:00:00')
      wd[d.getDay()] += r.amount || 0
    })
    const wdHtml = barRows(
      wd.map((value, i) => ({ label: WD[i], value })),
      yen
    )

    // 日別 売上
    const dayMap = {}
    sales.forEach((r) => (dayMap[r.date] = (dayMap[r.date] || 0) + (r.amount || 0)))
    const dayEntries = Object.keys(dayMap)
      .sort()
      .map((d) => {
        const dt = new Date(d + 'T00:00:00')
        return { label: `${dt.getMonth() + 1}/${dt.getDate()}（${WD[dt.getDay()]}）`, value: dayMap[d] }
      })
    const dayHtml = dayEntries.length ? barRows(dayEntries, yen) : '<p class="muted">売上記録がありません</p>'

    root.innerHTML =
      totalsHtml +
      `<div class="card"><h2>目標達成率</h2>${goalHtml}</div>` +
      `<div class="card"><h2>担当別集計</h2>${staffHtml}</div>` +
      `<div class="card"><h2>支出カテゴリ別</h2>${catHtml}</div>` +
      `<div class="card"><h2>客層</h2>${ageHtml}</div>` +
      `<div class="card"><h2>曜日別 売上</h2>${wdHtml}</div>` +
      `<div class="card"><h2>日別 売上</h2>${dayHtml}</div>`
  } catch (err) {
    console.error('集計の取得に失敗:', err)
    root.innerHTML = `<p class="form-msg err">読み込みに失敗しました: ${esc(err.message || err)}</p>`
  }
}

export function initSummary() {
  if (inited) return
  inited = true
  $('#sum-prev').addEventListener('click', () => {
    shiftMonth(-1)
    loadSummary()
  })
  $('#sum-next').addEventListener('click', () => {
    shiftMonth(1)
    loadSummary()
  })
}
