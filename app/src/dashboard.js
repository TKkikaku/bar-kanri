import { fetchSalesRange } from './db.js'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

let inited = false
let period = 'today' // today | month
let metric = 'sales' // sales | groups | drinks（並び順・強調数字の指標。期間タブとは独立）
let lastStaff = null // 直近の集計結果（指標タブ切替時は再フェッチせず再描画に使う）

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
        <div class="mvp-ic">${c.icon}</div>
        <div class="mvp-label">${c.label}</div>
        <div class="mvp-name">${has ? esc(w.name) : '—'}</div>
        <div class="mvp-value">${has ? c.fmt(w[c.metric]) : '—'}</div>
      </div>`
    })
    .join('')
}

// 売上を担当別に集計（売上 / 組数 / 指名ドリンク数。客層はダッシュボードでは非表示）
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
      }
      map.set(id, a)
    }
    a.sales += r.amount || 0
    a.groups += r.groups || 0
    a.drinks += r.nominated_drinks || 0
  })
  const staff = [...map.values()].sort((x, y) => y.sales - x.sales)
  return { staff, totalSales, totalGroups }
}

// 指標ごとの表示（強調＝main / サブ行＝sub）。並び順キーは同名プロパティ。
const METRICS = {
  sales: { main: (s) => yen(s.sales), sub: (s) => yen(s.sales) },
  groups: { main: (s) => `${s.groups}組`, sub: (s) => `組数 ${s.groups}` },
  drinks: { main: (s) => `${s.drinks}杯`, sub: (s) => `ドリンク ${s.drinks}` },
}
const METRIC_ORDER = ['sales', 'groups', 'drinks']

// スタッフ別実績ランキングを描画（lastStaff × 選択中の指標）。
// 選択指標の降順で並べ、1〜3位はメダル絵文字・4位以降は「N位」。
// 右の強調数字は選択指標、サブ行は残り2指標。フリーも順位付けに含める。
function renderRanking() {
  const staffBox = $('#dash-staff')
  if (!lastStaff) return
  if (!lastStaff.length) {
    staffBox.innerHTML = '<div class="card"><p class="muted">この期間の売上記録はありません</p></div>'
    return
  }

  const m = metric
  const sorted = [...lastStaff].sort((a, b) => b[m] - a[m])
  const MEDALS = ['🥇', '🥈', '🥉']

  const rowsHtml = sorted
    .map((s, i) => {
      const badge =
        i < 3
          ? `<span class="rank-medal">${MEDALS[i]}</span>`
          : `<span class="rank-num">${i + 1}位</span>`
      const subText = METRIC_ORDER.filter((k) => k !== m)
        .map((k) => METRICS[k].sub(s))
        .join(' ・ ')
      return `
        <div class="rank-row${i < 3 ? ' top' : ''}">
          <div class="rank-badge">${badge}</div>
          <div class="rank-main">
            <div class="rank-name">${esc(s.name)}${s.is_free ? ' <span class="badge auto">フリー</span>' : ''}</div>
            <div class="rank-meta">${subText}</div>
          </div>
          <div class="rank-sales">${METRICS[m].main(s)}</div>
        </div>`
    })
    .join('')

  staffBox.innerHTML = `<div class="rank-list">${rowsHtml}</div>`
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
    lastStaff = staff

    sumBox.innerHTML =
      `<div class="dash-stat"><div class="ds-k">${label}の売上</div><div class="ds-v">${yen(totalSales)}</div></div>` +
      `<div class="dash-stat"><div class="ds-k">組数</div><div class="ds-v">${totalGroups}<span class="ds-u">組</span></div></div>`

    // スタッフ別実績ランキング（選択中の指標で並べ替え・強調）
    renderRanking()
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
  // 指標タブ（売上/組数/ドリンク）は期間タブと独立。再フェッチせず並べ替え＋再描画のみ。
  $('#dash-metric').addEventListener('click', (e) => {
    const t = e.target.closest('[data-metric]')
    if (!t) return
    metric = t.dataset.metric
    $$('#dash-metric .tab').forEach((b) => b.classList.toggle('active', b === t))
    renderRanking()
  })
}
