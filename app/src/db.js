import { supabase } from './supabase.js'
import { getStore } from './store.js'
import { AUTO_BACK_CATEGORY } from './constants.js'

// スタッフ一覧（フリーを先頭、その後 sort_order / 作成順）
export async function fetchStaff() {
  const { data, error } = await supabase
    .from('staff_members')
    .select('*')
    .order('is_free', { ascending: false })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

// バック設定（単一行）
export async function fetchSettings() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .single()
  if (error) throw error
  return data
}

// 伝票バックの自動計算（§6・伝票単位）。
// details = [{ staff_member_id, drinks, is_free }]。主担当も1行含める（drinks=0可）。
//   有償ドリンク（フリー以外）合計 → 売上按分 → 各明細の back_amount を確定。
//   ・主担当（フリー以外）バック = salesPortion + 自分のdrinks × drinkUnit
//   ・他スタッフ（フリー以外）バック = drinks × drinkUnit
//   ・フリーは対象外（back_amount = 0）。主担当がフリーでも salesPortion は誰にも計上しない。
export function calcSlipBack(totalAmount, primaryStaffId, details, settings) {
  const drinkUnit = Number(settings.drink_unit)
  const rate = Number(settings.sales_rate)

  // フリー以外の明細ドリンクだけを合計（フリーの杯数は含めない・判断事項③）
  const paidDrinks = details.reduce((s, d) => s + (d.is_free ? 0 : Number(d.drinks) || 0), 0)
  const paidDrinkBack = paidDrinks * drinkUnit
  const salesPortion = Math.floor(Math.max(0, Number(totalAmount) - paidDrinkBack) * rate)

  const detailBacks = details.map((d) => {
    if (d.is_free) return { ...d, back_amount: 0 }
    let back = (Number(d.drinks) || 0) * drinkUnit
    // 主担当（フリー以外）だけ売上按分を加算。主担当がフリーなら salesPortion は計上されない。
    if (d.staff_member_id === primaryStaffId) back += salesPortion
    return { ...d, back_amount: back }
  })
  const totalBack = detailBacks.reduce((s, d) => s + d.back_amount, 0)
  return { detailBacks, totalBack, salesPortion, paidDrinkBack }
}

// 伝票を登録（§7.1）：ヘッダー ＋ 明細（back_amountスナップショット）＋ 集約バック行（§6）。
// slip = { date, primary_staff_id, total_amount, ages, memo, details:[{staff_member_id,drinks,is_free}] }
export async function addSlip(slip) {
  const store = getStore()
  const settings = await fetchSettings()
  const { detailBacks, totalBack } = calcSlipBack(
    slip.total_amount,
    slip.primary_staff_id,
    slip.details,
    settings
  )

  // 1) 伝票ヘッダー
  const { data: header, error: hErr } = await supabase
    .from('sales_slips')
    .insert({
      store,
      date: slip.date,
      primary_staff_id: slip.primary_staff_id,
      total_amount: slip.total_amount,
      ages: slip.ages && slip.ages.length ? slip.ages : null,
      memo: slip.memo || null,
    })
    .select()
    .single()
  if (hErr) throw hErr

  // 2) 明細（担当×ドリンク数 ＋ 確定バックのスナップショット）
  const detailRows = detailBacks.map((d) => ({
    slip_id: header.id,
    staff_member_id: d.staff_member_id,
    drinks: Number(d.drinks) || 0,
    back_amount: d.back_amount,
  }))
  const { error: dErr } = await supabase.from('sales_slip_details').insert(detailRows)
  if (dErr) throw dErr

  // 3) 集約バック行（合計 > 0 のとき daily_expenses に1本だけ計上）
  let back = null
  if (totalBack > 0) {
    const { error: bErr } = await supabase.from('daily_expenses').insert({
      store,
      date: slip.date,
      amount: totalBack,
      category: AUTO_BACK_CATEGORY,
      is_auto_back: true,
      related_slip_id: header.id,
      memo: null,
    })
    if (bErr) throw bErr
    back = { total: totalBack, detailBacks }
  }

  return { slip: header, detailBacks, back }
}

// 月の範囲（YYYY-MM → [start, next)）
function monthBounds(month) {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const next = `${ny}-${String(nm).padStart(2, '0')}-01`
  return { start, next }
}

// PostgREST の1000件上限対策（§12）。order 付きクエリをページングで全件取得。
async function paginate(queryFn, pageSize = 1000) {
  const all = []
  let from = 0
  // 上限ガード（暴走防止）
  for (let page = 0; page < 1000; page++) {
    const { data, error } = await queryFn(from, from + pageSize - 1)
    if (error) throw error
    all.push(...data)
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return all
}

// 指定範囲 [start, next) ・現在店舗の伝票（主担当名＋明細＋明細担当名をネスト埋め込み）。
// 返り値: sales_slips 行に primary（主担当）と details（[{drinks,back_amount,staff:{name,is_free}}]）が付く。
export async function fetchSalesRange(start, next) {
  const store = getStore()
  return paginate((from, to) =>
    supabase
      .from('sales_slips')
      .select(
        '*, primary:staff_members!primary_staff_id(name, is_free), details:sales_slip_details(*, staff:staff_members(name, is_free))'
      )
      .eq('store', store)
      .gte('date', start)
      .lt('date', next)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to)
  )
}

// 指定月・現在店舗の伝票（主担当名＋明細を埋め込み）
export async function fetchSalesByMonth(month) {
  const { start, next } = monthBounds(month)
  return fetchSalesRange(start, next)
}

// 指定月・現在店舗の支出（バック自動計上行を含む）
export async function fetchExpensesByMonth(month) {
  const store = getStore()
  const { start, next } = monthBounds(month)
  return paginate((from, to) =>
    supabase
      .from('daily_expenses')
      .select('*')
      .eq('store', store)
      .gte('date', start)
      .lt('date', next)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to)
  )
}

// スタッフ追加（手入力は常に非フリー）
export async function addStaff(name) {
  const { data, error } = await supabase
    .from('staff_members')
    .insert({ name, is_free: false })
    .select()
    .single()
  if (error) throw error
  return data
}

// スタッフ名の更新
export async function updateStaff(id, name) {
  const { error } = await supabase.from('staff_members').update({ name }).eq('id', id)
  if (error) throw error
}

// スタッフ削除（フリーはフロントでガード。売上参照があるとFKでエラー）
export async function deleteStaff(id) {
  const { error } = await supabase.from('staff_members').delete().eq('id', id)
  if (error) throw error
}

// バック設定の更新（単一行 id=1）
export async function updateSettings({ sales_rate, drink_unit }) {
  const { error } = await supabase
    .from('app_settings')
    .update({ sales_rate, drink_unit })
    .eq('id', 1)
  if (error) throw error
}

// 月次目標の登録/更新（store+month で upsert）
export async function upsertGoal(month, target) {
  const store = getStore()
  const { error } = await supabase
    .from('monthly_goals')
    .upsert({ store, month, target }, { onConflict: 'store,month' })
  if (error) throw error
}

// 月次目標（現在店舗・指定月）。未設定なら null。
export async function fetchGoal(month) {
  const store = getStore()
  const { data, error } = await supabase
    .from('monthly_goals')
    .select('*')
    .eq('store', store)
    .eq('month', month)
    .maybeSingle()
  if (error) throw error
  return data
}

// 支出を登録（§7.2）
export async function addExpense(exp) {
  const store = getStore()
  const { error } = await supabase.from('daily_expenses').insert({
    store,
    date: exp.date,
    amount: exp.amount,
    category: exp.category,
    is_auto_back: false,
    memo: exp.memo || null,
  })
  if (error) throw error
}
