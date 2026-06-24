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

// バック自動計算（§6）。フリーは対象外。
export function calcBack(amount, nominatedDrinks, settings) {
  const salesBack = Math.floor(Number(amount) * Number(settings.sales_rate))
  const drinkBack = Number(nominatedDrinks) * Number(settings.drink_unit)
  return { salesBack, drinkBack, total: salesBack + drinkBack }
}

// 売上を登録（§7.1）＋ バック自動計上を daily_expenses に記録（§6）
export async function addSale(sale) {
  const store = getStore()

  const { data: inserted, error } = await supabase
    .from('daily_sales')
    .insert({
      store,
      date: sale.date,
      staff_member_id: sale.staff_member_id,
      amount: sale.amount,
      groups: sale.groups,
      ages: sale.ages && sale.ages.length ? sale.ages : null,
      nominated_drinks: sale.nominated_drinks,
      memo: sale.memo || null,
    })
    .select()
    .single()
  if (error) throw error

  // フリー以外なら自動バックを支出に計上
  let back = null
  if (!sale.isFree) {
    const settings = await fetchSettings()
    const b = calcBack(sale.amount, sale.nominated_drinks, settings)
    if (b.total > 0) {
      const { error: backErr } = await supabase.from('daily_expenses').insert({
        store,
        date: sale.date,
        amount: b.total,
        category: AUTO_BACK_CATEGORY,
        is_auto_back: true,
        related_sale_id: inserted.id,
        memo: null,
      })
      if (backErr) throw backErr
      back = b
    }
  }

  return { sale: inserted, back }
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

// 指定範囲 [start, next) ・現在店舗の売上（担当名を埋め込み）
export async function fetchSalesRange(start, next) {
  const store = getStore()
  return paginate((from, to) =>
    supabase
      .from('daily_sales')
      .select('*, staff:staff_members(name, is_free)')
      .eq('store', store)
      .gte('date', start)
      .lt('date', next)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to)
  )
}

// 指定月・現在店舗の売上（担当名を埋め込み）
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
