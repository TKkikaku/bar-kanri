import { fetchSalesRange, calcNetSales } from './db.js'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

let inited = false
let metric = 'sales' // sales | netSales | groups | drinks（並び順・強調数字の指標）
let lastStaff = null // 直近の集計結果（指標タブ切替時は再フェッチせず再描画に使う）

const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP')
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )

// ローカル日付 YYYY-MM-DD
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ダッシュボードは今月固定（§7.2）。呼ぶたびに現在日から算出するので月をまたいでも追従する。
function monthBoundsNow() {
  const now = new Date()
  return {
    start: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
    next: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
  }
}

// 今月のMVP（フリー対象外・同率は id 先勝ち）を描画。実売上MVPは作らない（§7.2）。
function renderMvp(slips) {
  const staff = aggregate(slips).staff.filter((s) => !s.is_free)
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

// 伝票を担当別に集計（2ソース合算・§7.2）：
//   ・売上 / 実売上 / 組数 … 主担当として（1伝票 = 1組）
//   ・ドリンク            … 全伝票横断の明細（他人の席で出した分も加算）
// 客層はダッシュボードでは非表示。
function aggregate(slips) {
  const map = new Map()
  let totalSales = 0
  let totalGroups = 0
  const ensure = (id, name, is_free) => {
    let a = map.get(id)
    if (!a) {
      a = { id, name: name || '(担当不明)', is_free: !!is_free, sales: 0, netSales: 0, groups: 0, drinks: 0 }
      map.set(id, a)
    }
    return a
  }
  slips.forEach((slip) => {
    totalSales += slip.total_amount || 0
    totalGroups += 1
    // 主担当：売上＋実売上＋組数
    const p = ensure(slip.primary_staff_id, slip.primary?.name, slip.primary?.is_free)
    p.sales += slip.total_amount || 0
    p.netSales += calcNetSales(slip)
    p.groups += 1
    // 明細：ドリンク実績（主担当自身の明細行も含む）
    ;(slip.details || []).forEach((d) => {
      const a = ensure(d.staff_member_id, d.staff?.name, d.staff?.is_free)
      a.drinks += d.drinks || 0
    })
  })
  const staff = [...map.values()].sort((x, y) => y.sales - x.sales)
  return { staff, totalSales, totalGroups }
}

// 指標ごとの表示（強調＝main / サブ行＝sub）。並び順キーは同名プロパティ。
const METRICS = {
  sales: { main: (s) => yen(s.sales), sub: (s) => `伝票総額 ${yen(s.sales)}` },
  netSales: { main: (s) => yen(s.netSales) },
  groups: { main: (s) => `${s.groups}組`, sub: (s) => `組数 ${s.groups}` },
  drinks: { main: (s) => `${s.drinks}杯`, sub: (s) => `ドリンク ${s.drinks}` },
}
// サブ行に出す指標。実売上は含めない（実売上タブでのみ強調表示する）。
// 実売上タブでは選択指標を除外しても3つ全部が残る＝「伝票総額 / 組数 / ドリンク」になる。
const SUB_ORDER = ['sales', 'groups', 'drinks']

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
      const subText = SUB_ORDER.filter((k) => k !== m)
        .map((k) => METRICS[k].sub(s))
        .join(' ・ ')
      // 実売上が負（他担当ドリンクが伝票総額を超える＝入力ミスの疑い）は赤字で目立たせる
      const neg = m === 'netSales' && s.netSales < 0 ? ' neg' : ''
      return `
        <div class="rank-row${i < 3 ? ' top' : ''}">
          <div class="rank-badge">${badge}</div>
          <div class="rank-main">
            <div class="rank-name">${esc(s.name)}${s.is_free ? ' <span class="badge auto">フリー</span>' : ''}</div>
            <div class="rank-meta">${subText}</div>
          </div>
          <div class="rank-sales${neg}">${METRICS[m].main(s)}</div>
        </div>`
    })
    .join('')

  staffBox.innerHTML = `<div class="rank-list">${rowsHtml}</div>`
}

export async function loadDashboard() {
  if (!inited) return
  const { start, next } = monthBoundsNow()
  const staffBox = $('#dash-staff')
  const sumBox = $('#dash-summary')
  staffBox.innerHTML = '<p class="muted" style="text-align:center;padding:24px 0;">読み込み中…</p>'
  sumBox.innerHTML = ''

  try {
    // 今月固定なので取得は1回。MVP・総計・ランキングすべて同じ行から集計する。
    const rows = await fetchSalesRange(start, next)
    renderMvp(rows)

    const { staff, totalSales, totalGroups } = aggregate(rows)
    lastStaff = staff

    sumBox.innerHTML =
      `<div class="dash-stat"><div class="ds-k">今月の売上</div><div class="ds-v">${yen(totalSales)}</div></div>` +
      `<div class="dash-stat"><div class="ds-k">今月の組数</div><div class="ds-v">${totalGroups}<span class="ds-u">組</span></div></div>`

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
  // 指標タブ（売上/実売上/組数/ドリンク）は並べ替え用。再フェッチせず並べ替え＋再描画のみ。
  $('#dash-metric').addEventListener('click', (e) => {
    const t = e.target.closest('[data-metric]')
    if (!t) return
    metric = t.dataset.metric
    $$('#dash-metric .tab').forEach((b) => b.classList.toggle('active', b === t))
    renderRanking()
  })
}
