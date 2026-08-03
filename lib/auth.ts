import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// 로그인 + 허용 이메일 검증. 서버 컴포넌트/액션 상단에서 호출.
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (allowed && user.email?.toLowerCase() !== allowed) {
    // 허용되지 않은 계정 — 즉시 로그아웃 후 로그인 화면으로
    await supabase.auth.signOut();
    redirect("/login?error=not-allowed");
  }

  return { user, supabase };
}
