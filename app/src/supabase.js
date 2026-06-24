import { createClient } from '@supabase/supabase-js'

// 接続情報は環境変数（ビルド時に Vite が埋め込む / §14）
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Supabase の環境変数が未設定です。app/.env.local に ' +
      'VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定してください。'
  )
}

// 認証は使わない（§3/§4）。DB ストレージとしてのみ利用。
export const supabase = createClient(url, anonKey)
