import { EXPENSE_CATEGORIES, AGE_TAGS } from './constants.js'
import { fetchStaff, fetchSettings, calcSlipBack, addSlip, addExpense } from './db.js'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

let inited = false
let staffList = []
let settings = { sales_rate: 0.1, drink_unit: 300 }

// 伝票明細モデル。先頭(index 0)は必ず主担当（staffId は #sale-primary に同期）。
// 以降はヘルパー。各担当は伝票内で一意（重複禁止・判断事項④）。
let details = [{ staffId: '', drinks: 0 }]

const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP')
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )
// ローカル日付 YYYY-MM-DD（ダッシュボードの「今日」と基準を合わせる）
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function showMsg(el, text, kind) {
  el.textContent = text
  el.className = 'form-msg ' + (kind || '')
  el.hidden = false
}

function staffById(id) {
  return staffList.find((x) => x.id === id) || null
}
function isFree(id) {
  const s = staffById(id)
  return !!(s && s.is_free)
}

function selectedAges() {
  return $$('#sale-ages .chip.active').map((c) => c.dataset.age)
}

// 現在の明細を計算用の形へ（先頭=主担当を #sale-primary から同期）
function currentDetails() {
  const primaryId = $('#sale-primary').value
  if (details.length) details[0].staffId = primaryId
  return details.map((r) => {
    const s = staffById(r.staffId)
    return {
      staff_member_id: r.staffId,
      drinks: Number(r.drinks) || 0,
      is_free: !!(s && s.is_free),
      name: s ? s.name : '(不明)',
    }
  })
}

// 主担当セレクト
function renderPrimaryOptions() {
  const sel = $('#sale-primary')
  const cur = sel.value
  sel.innerHTML = staffList
    .map((s) => `<option value="${s.id}">${esc(s.name)}${s.is_free ? '（フリー）' : ''}</option>`)
    .join('')
  // 既存選択を維持。無ければ先頭。
  if (cur && staffList.some((s) => s.id === cur)) sel.value = cur
}

// 明細の動的行を描画。先頭行=主担当（担当は固定表示）、以降=ヘルパー（担当選択可＋削除）。
// 各行の担当セレクトは、他行で使用済みの担当を除外して重複を防ぐ（判断事項④）。
function renderDetails() {
  const primaryId = $('#sale-primary').value
  if (details.length) details[0].staffId = primaryId
  const box = $('#sale-details')

  const usedElsewhere = (idx) =>
    new Set(details.filter((_, i) => i !== idx).map((r) => r.staffId).filter(Boolean))

  box.innerHTML = details
    .map((r, idx) => {
      const drinksInput = `<input type="number" class="d-drinks" inputmode="numeric" min="0" value="${Number(r.drinks) || 0}" data-idx="${idx}" aria-label="ドリンク数">`
      if (idx === 0) {
        // 主担当行：担当は #sale-primary に従う固定表示
        const s = staffById(primaryId)
        const nm = s ? esc(s.name) + (s.is_free ? '（フリー）' : '') : '（主担当を選択）'
        return `
        <div class="detail-row">
          <div class="d-staff d-primary"><span class="d-primary-badge">主</span><span>${nm}</span></div>
          ${drinksInput}
          <span class="d-unit">杯</span>
          <span class="d-remove-placeholder"></span>
        </div>`
      }
      const used = usedElsewhere(idx)
      const opts = staffList
        .filter((s) => s.id === r.staffId || !used.has(s.id))
        .map(
          (s) =>
            `<option value="${s.id}"${s.id === r.staffId ? ' selected' : ''}>${esc(s.name)}${s.is_free ? '（フリー）' : ''}</option>`
        )
        .join('')
      return `
        <div class="detail-row">
          <select class="d-staff d-staff-select" data-idx="${idx}" aria-label="担当">${opts}</select>
          ${drinksInput}
          <span class="d-unit">杯</span>
          <button type="button" class="d-remove" data-idx="${idx}" aria-label="この担当を削除">×</button>
        </div>`
    })
    .join('')

  // 追加できるスタッフが残っていなければ「担当を追加」を無効化
  const usedAll = new Set(details.map((r) => r.staffId).filter(Boolean))
  $('#sale-add-detail').disabled = staffList.every((s) => usedAll.has(s.id))
}

// バックのライブプレビュー（担当別内訳・§6）
function updateBackPreview() {
  const box = $('#sale-back-preview')
  const total = Number($('#sale-total').value || 0)
  const primaryId = $('#sale-primary').value
  const ds = currentDetails()

  if (!primaryId || total <= 0) {
    box.hidden = true
    return
  }

  const { detailBacks, totalBack } = calcSlipBack(total, primaryId, ds, settings)
  const rows = detailBacks
    .map((d) => {
      const tag = d.staff_member_id === primaryId ? '<span class="bp-tag">主</span>' : ''
      const name = esc(d.name) + (d.is_free ? '（フリー）' : '')
      const val = d.is_free ? '対象外' : yen(d.back_amount)
      return `<div class="bp-row"><span>${tag}${name}（${d.drinks}杯）</span><span>${val}</span></div>`
    })
    .join('')

  box.hidden = false
  box.innerHTML =
    `<div class="bp-title">自動計上されるバック</div>` +
    rows +
    `<div class="bp-total"><span>合計バック</span><span>${yen(totalBack)}</span></div>`
}

function renderExpenseCategories() {
  const sel = $('#exp-category')
  sel.innerHTML = EXPENSE_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')
}

function renderAgeChips() {
  const box = $('#sale-ages')
  box.innerHTML = AGE_TAGS.map(
    (a) => `<button type="button" class="chip" data-age="${a}">${a}</button>`
  ).join('')
}

// 明細のリセット（登録後・主担当は維持）
function resetDetails() {
  details = [{ staffId: $('#sale-primary').value, drinks: 0 }]
  renderDetails()
}

// 未使用の先頭スタッフ（新規ヘルパー行の初期値）
function firstUnusedStaffId() {
  const used = new Set(details.map((r) => r.staffId).filter(Boolean))
  const s = staffList.find((x) => !used.has(x.id))
  return s ? s.id : ''
}

function switchTab(which) {
  $$('#input-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.inputTab === which))
  $('#form-sale').hidden = which !== 'sale'
  $('#form-expense').hidden = which !== 'expense'
}

async function handleSaleSubmit(e) {
  e.preventDefault()
  const btn = $('#form-sale button[type=submit]')
  const msg = $('#sale-msg')

  const primaryId = $('#sale-primary').value
  const total = Number($('#sale-total').value)

  if (!primaryId) return showMsg(msg, '主担当を選択してください', 'err')
  if (!total || total <= 0) return showMsg(msg, '伝票総額を入力してください', 'err')

  const ds = currentDetails()
  if (ds.some((d) => !d.staff_member_id)) return showMsg(msg, '明細の担当を選択してください', 'err')
  // 念のため重複チェック（UIで防いでいるが unique index と整合させる）
  const ids = ds.map((d) => d.staff_member_id)
  if (new Set(ids).size !== ids.length)
    return showMsg(msg, '明細に同じ担当が重複しています', 'err')

  btn.disabled = true
  showMsg(msg, '登録中…', '')
  try {
    const { back } = await addSlip({
      date: $('#sale-date').value || today(),
      primary_staff_id: primaryId,
      total_amount: total,
      ages: selectedAges(),
      memo: $('#sale-memo').value,
      details: ds.map((d) => ({
        staff_member_id: d.staff_member_id,
        drinks: d.drinks,
        is_free: d.is_free,
      })),
    })
    const backNote = back ? `（バック ${yen(back.total)} を支出に自動計上）` : ''
    showMsg(msg, `伝票を登録しました${backNote}`, 'ok')
    // 入力リセット（日付・主担当は残す）
    $('#sale-total').value = ''
    $('#sale-memo').value = ''
    $$('#sale-ages .chip.active').forEach((c) => c.classList.remove('active'))
    resetDetails()
    updateBackPreview()
  } catch (err) {
    console.error(err)
    showMsg(msg, '登録に失敗しました: ' + (err.message || err), 'err')
  } finally {
    btn.disabled = false
  }
}

async function handleExpenseSubmit(e) {
  e.preventDefault()
  const btn = $('#form-expense button[type=submit]')
  const msg = $('#exp-msg')
  const amount = Number($('#exp-amount').value)
  const category = $('#exp-category').value

  if (!amount || amount <= 0) return showMsg(msg, '金額を入力してください', 'err')
  if (!category) return showMsg(msg, 'カテゴリを選択してください', 'err')

  btn.disabled = true
  showMsg(msg, '登録中…', '')
  try {
    await addExpense({
      date: $('#exp-date').value || today(),
      amount,
      category,
      memo: $('#exp-memo').value,
    })
    showMsg(msg, '支出を登録しました', 'ok')
    $('#exp-amount').value = ''
    $('#exp-memo').value = ''
  } catch (err) {
    console.error(err)
    showMsg(msg, '登録に失敗しました: ' + (err.message || err), 'err')
  } finally {
    btn.disabled = false
  }
}

// 設定タブでスタッフ/バック設定を変更した後に、入力画面のマスタを再読込
export async function reloadInputMasters() {
  if (!inited) return
  try {
    ;[staffList, settings] = await Promise.all([fetchStaff(), fetchSettings()])
    // 消えたスタッフが明細/主担当に残らないよう掃除
    details = details.filter((r, i) => i === 0 || staffList.some((s) => s.id === r.staffId))
    renderPrimaryOptions()
    renderDetails()
    updateBackPreview()
  } catch (err) {
    console.error('入力マスタの再読込に失敗:', err)
  }
}

export async function initInput() {
  if (inited) return
  inited = true

  // 既定値・選択肢
  $('#sale-date').value = today()
  $('#exp-date').value = today()
  renderExpenseCategories()
  renderAgeChips()

  // タブ切替
  $('#input-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-input-tab]')
    if (t) switchTab(t.dataset.inputTab)
  })

  // 客層チップ
  $('#sale-ages').addEventListener('click', (e) => {
    const c = e.target.closest('.chip')
    if (c) c.classList.toggle('active')
  })

  // 主担当変更 → 先頭明細行に同期。ヘルパーが同じ担当を持っていたら重複解消のため除去。
  $('#sale-primary').addEventListener('change', () => {
    const pid = $('#sale-primary').value
    details = details.filter((r, i) => i === 0 || r.staffId !== pid)
    if (details.length) details[0].staffId = pid
    renderDetails()
    updateBackPreview()
  })

  // 伝票総額
  $('#sale-total').addEventListener('input', updateBackPreview)

  // 明細：担当を追加
  $('#sale-add-detail').addEventListener('click', () => {
    const sid = firstUnusedStaffId()
    if (!sid) return
    details.push({ staffId: sid, drinks: 0 })
    renderDetails()
    updateBackPreview()
  })

  // 明細：担当セレクト変更 / 行削除（委譲）
  $('#sale-details').addEventListener('change', (e) => {
    const sel = e.target.closest('.d-staff-select')
    if (sel) {
      const idx = Number(sel.dataset.idx)
      details[idx].staffId = sel.value
      renderDetails()
      updateBackPreview()
    }
  })
  $('#sale-details').addEventListener('input', (e) => {
    const inp = e.target.closest('.d-drinks')
    if (inp) {
      const idx = Number(inp.dataset.idx)
      details[idx].drinks = Number(inp.value) || 0
      updateBackPreview()
    }
  })
  $('#sale-details').addEventListener('click', (e) => {
    const rm = e.target.closest('.d-remove')
    if (rm) {
      const idx = Number(rm.dataset.idx)
      details.splice(idx, 1)
      renderDetails()
      updateBackPreview()
    }
  })

  // 送信
  $('#form-sale').addEventListener('submit', handleSaleSubmit)
  $('#form-expense').addEventListener('submit', handleExpenseSubmit)

  // マスタ取得（スキーマ未作成時はメッセージ表示）
  try {
    ;[staffList, settings] = await Promise.all([fetchStaff(), fetchSettings()])
    renderPrimaryOptions()
    // 主担当の初期値で先頭明細行を初期化
    details = [{ staffId: $('#sale-primary').value, drinks: 0 }]
    renderDetails()
    updateBackPreview()
  } catch (err) {
    console.error('マスタ取得に失敗:', err)
    $('#sale-primary').innerHTML = '<option value="">（取得失敗）</option>'
    showMsg(
      $('#sale-msg'),
      'スタッフ/設定の取得に失敗しました。Supabase で app/db/schema.sql を実行済みか確認してください。',
      'err'
    )
  }
}
