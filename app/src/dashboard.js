import { fetchSalesRange } from './db.js'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

let inited = false
let period = 'today' // today | month

const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP')
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )

// ローカル日付 YYYY-MM-DD
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function monthBoundsNow() {
  const now = new Date()
  return {
    start: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
    next: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
  }
}

function bounds() {
  const now = new Date()
  if (period === 'today') {
    const start = ymd(now)
    const next = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
    return { start, next }
  }
  return monthBoundsNow()
}

// 今月のMVP（フリー対象外・同率は id 先勝ち）を描画
function renderMvp(monthRows) {
  const staff = aggregate(monthRows).staff.filter((s) => !s.is_free)
  // id 昇順で安定化 → 同率時は先頭（小さい id）が勝つ
  const byId = [...staff].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const pick = (metric) =>
    byId.reduce((best, s) => (best === null || s[metric] > best[metric] ? s : best), null)

  const cards = [
    { icon: '💰', label: '売上MVP', metric: 'sales', fmt: (v) => yen(v) },
    { icon: '👥', label: '組数MVP', metric: 'groups', fmt: (v) => `${v}組` },
    { icon: '🍹', label: 'ドリンクMVP', metric: 'drinks', fmt: (v) => `${v}杯` },
  ]

  $('#dash-mvp').innerHTML = cards
    .map((c) => {
      const w = pick(c.metric)
      const has = w && w[c.metric] > 0
      return `
      <div class="mvp-card">
        <div class="mvp-label">${c.icon} ${c.label}</div>
        <div class="mvp-name">${has ? esc(w.name) : '—'}</div>
        <div class="mvp-value">${has ? c.fmt(w[c.metric]) : '—'}</div>
      </div>`
    })
    .join('')
}

// 売上を担当別に集計（§9: 売上 / 組数 / 客層 / 指名ドリンク数）
function aggregate(rows) {
  const map = new Map()
  let totalSales = 0
  let totalGroups = 0
  rows.forEach((r) => {
    totalSales += r.amount || 0
    totalGroups += r.groups || 0
    const id = r.staff_member_id
    let a = map.get(id)
    if (!a) {
      a = {
        id,
        name: r.staff?.name || '(担当不明)',
        is_free: !!r.staff?.is_free,
        sales: 0,
        groups: 0,
        drinks: 0,
        ages: {},
      }
      map.set(id, a)
    }
    a.sales += r.amount || 0
    a.groups += r.groups || 0
    a.drinks += r.nominated_drinks || 0
    ;(r.ages || []).forEach((t) => {
      a.ages[t] = (a.ages[t] || 0) + 1
    })
  })
  const staff = [...map.values()].sort((x, y) => y.sales - x.sales)
  return { staff, totalSales, totalGroups }
}

function agesText(ages) {
  const ent = Object.entries(ages).sort((a, b) => b[1] - a[1])
  if (!ent.length) return '—'
  return ent.map(([t, c]) => `${t}${c > 1 ? '×' + c : ''}`).join(' / ')
}

export async function loadDashboard() {
  if (!inited) return
  const label = period === 'today' ? '今日' : '今月'
  const { start, next } = bounds()
  const staffBox = $('#dash-staff')
  const sumBox = $('#dash-summary')
  staffBox.innerHTML = '<p class="muted" style="text-align:center;padding:24px 0;">読み込み中…</p>'
  sumBox.innerHTML = ''

  try {
    const mb = monthBoundsNow()
    const rows = await fetchSalesRange(start, next)
    // MVP は常に「今月」固定（期間タブと独立）
    const monthRows = period === 'month' ? rows : await fetchSalesRange(mb.start, mb.next)
    renderMvp(monthRows)

    const { staff, totalSales, totalGroups } = aggregate(rows)

    sumBox.innerHTML =
      `<div class="dash-stat"><div class="ds-k">${label}の売上</div><div class="ds-v">${yen(totalSales)}</div></div>` +
      `<div class="dash-stat"><div class="ds-k">組数</div><div class="ds-v">${totalGroups}<span class="ds-u">組</span></div></div>`

    if (!staff.length) {
      staffBox.innerHTML = '<div class="card"><p class="muted">この期間の売上記録はありません</p></div>'
      return
    }

    staffBox.innerHTML = staff
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
  } catch (err) {
    console.error('ダッシュボードの取得に失敗:', err)
    staffBox.innerHTML = `<p class="form-msg err">読み込みに失敗しました: ${esc(err.message || err)}</p>`
  }
}

export function initDashboard() {
  if (inited) return
  inited = true
  $('#dash-period').addEventListener('click', (e) => {
    const t = e.target.closest('[data-period]')
    if (!t) return
    period = t.dataset.period
    $$('#dash-period .tab').forEach((b) => b.classList.toggle('active', b === t))
    loadDashboard()
  })
}
