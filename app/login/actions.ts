"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 이메일+비밀번호 로그인. 허용된 이메일만 통과.
export async function signIn(
  _prev: { message: string },
  formData: FormData
): Promise<{ message: string }> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();

  if (!email || !password) return { message: "이메일과 비밀번호를 입력하세요." };
  if (allowed && email !== allowed) {
    return { message: "이 앱에 허용된 이메일이 아닙니다." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { message: `로그인 실패: ${error.message}` };

  redirect("/");
}

// 첫 사용: 내가 직접 비밀번호를 정한다. (허용 이메일 1개만, 이메일 확인 절차 없이 바로 사용 가능)
export async function setupAccount(
  _prev: { message: string },
  formData: FormData
): Promise<{ message: string }> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();

  if (allowed && email !== allowed) {
    return { message: "이 앱에 허용된 이메일이 아닙니다." };
  }
  if (password.length < 8) return { message: "비밀번호는 8자 이상으로 정하세요." };
  if (password !== confirm) return { message: "비밀번호가 서로 다릅니다." };

  const admin = createAdminClient();

  // 이미 있으면 비밀번호 갱신, 없으면 새로 생성 (둘 다 email_confirm 처리)
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email);

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) return { message: `설정 실패: ${error.message}` };
  } else {
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) return { message: `생성 실패: ${error.message}` };
  }

  // 바로 로그인시켜 대시보드로
  const supabase = await createClient();
  const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signErr) return { message: `설정은 됐지만 로그인 실패: ${signErr.message}` };

  redirect("/");
}
