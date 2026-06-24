import { EXPENSE_CATEGORIES, AGE_TAGS } from './constants.js'
import { fetchStaff, fetchSettings, calcBack, addSale, addExpense } from './db.js'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

let inited = false
let staffList = []
let settings = { sales_rate: 0.1, drink_unit: 300 }

const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP')
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

function selectedStaffIsFree() {
  const id = $('#sale-staff').value
  const s = staffList.find((x) => x.id === id)
  return !!(s && s.is_free)
}

function selectedAges() {
  return $$('#sale-ages .chip.active').map((c) => c.dataset.age)
}

// 売上バックのライブプレビュー（§6）
function updateBackPreview() {
  const box = $('#sale-back-preview')
  const amount = Number($('#sale-amount').value || 0)
  const drinks = Number($('#sale-drinks').value || 0)

  if (selectedStaffIsFree()) {
    box.hidden = false
    box.innerHTML = '<div class="bp-row"><span>フリーはバック対象外です</span></div>'
    return
  }
  const b = calcBack(amount, drinks, settings)
  if (b.total <= 0) {
    box.hidden = true
    return
  }
  box.hidden = false
  box.innerHTML =
    `<div class="bp-title">自動計上されるバック</div>` +
    `<div class="bp-row"><span>売上バック（${Math.round(settings.sales_rate * 100)}%）</span><span>${yen(b.salesBack)}</span></div>` +
    `<div class="bp-row"><span>ドリンクバック（${drinks}杯 × ${yen(settings.drink_unit)}）</span><span>${yen(b.drinkBack)}</span></div>` +
    `<div class="bp-total"><span>合計バック</span><span>${yen(b.total)}</span></div>`
}

function renderStaffOptions() {
  const sel = $('#sale-staff')
  sel.innerHTML = staffList
    .map((s) => `<option value="${s.id}">${s.name}${s.is_free ? '（フリー）' : ''}</option>`)
    .join('')
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

function switchTab(which) {
  $$('#input-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.inputTab === which))
  $('#form-sale').hidden = which !== 'sale'
  $('#form-expense').hidden = which !== 'expense'
}

async function handleSaleSubmit(e) {
  e.preventDefault()
  const btn = $('#form-sale button[type=submit]')
  const msg = $('#sale-msg')

  const amount = Number($('#sale-amount').value)
  const staffId = $('#sale-staff').value
  const groups = $('#sale-groups').value

  if (!staffId) return showMsg(msg, '担当スタッフを選択してください', 'err')
  if (!amount || amount <= 0) return showMsg(msg, '金額を入力してください', 'err')
  if (groups === '' || Number(groups) < 0) return showMsg(msg, '組数を入力してください', 'err')

  btn.disabled = true
  showMsg(msg, '登録中…', '')
  try {
    const { back } = await addSale({
      date: $('#sale-date').value || today(),
      staff_member_id: staffId,
      amount,
      groups: Number(groups),
      ages: selectedAges(),
      nominated_drinks: Number($('#sale-drinks').value || 0),
      memo: $('#sale-memo').value,
      isFree: selectedStaffIsFree(),
    })
    const backNote = back ? `（バック ${yen(back.total)} を支出に自動計上）` : ''
    showMsg(msg, `売上を登録しました${backNote}`, 'ok')
    // 入力リセット（日付・担当は残す）
    $('#sale-amount').value = ''
    $('#sale-groups').value = ''
    $('#sale-drinks').value = '0'
    $('#sale-memo').value = ''
    $$('#sale-ages .chip.active').forEach((c) => c.classList.remove('active'))
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

  // バックプレビューの更新トリガ
  $('#sale-amount').addEventListener('input', updateBackPreview)
  $('#sale-drinks').addEventListener('input', updateBackPreview)
  $('#sale-staff').addEventListener('change', updateBackPreview)

  // 送信
  $('#form-sale').addEventListener('submit', handleSaleSubmit)
  $('#form-expense').addEventListener('submit', handleExpenseSubmit)

  // マスタ取得（スキーマ未作成時はメッセージ表示）
  try {
    ;[staffList, settings] = await Promise.all([fetchStaff(), fetchSettings()])
    renderStaffOptions()
    updateBackPreview()
  } catch (err) {
    console.error('マスタ取得に失敗:', err)
    $('#sale-staff').innerHTML = '<option value="">（取得失敗）</option>'
    showMsg(
      $('#sale-msg'),
      'スタッフ/設定の取得に失敗しました。Supabase で app/db/schema.sql を実行済みか確認してください。',
      'err'
    )
  }
}
