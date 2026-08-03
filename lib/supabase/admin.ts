import { createClient } from "@supabase/supabase-js";

// service_role 키를 쓰는 관리자 클라이언트 — RLS 우회.
// ⚠️ 서버(cron/발행 파이프라인)에서만 사용. 절대 클라이언트 번들에 포함 금지.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
