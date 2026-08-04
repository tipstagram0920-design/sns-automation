"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";

// 실패한 타겟 재시도: 예약 시각을 지금으로 당기고 pending 으로 되돌림 → 다음 cron 이 집음
export async function retryTarget(formData: FormData) {
  const id = String(formData.get("id"));
  const { user, supabase } = await requireUser();

  await supabase
    .from("post_targets")
    .update({
      status: "pending",
      error_message: null,
      attempts: 0, // 자동 재시도 한도(5) 초기화
      ig_container_id: null, // 만료됐을 수 있는 IG 컨테이너 폐기 후 새로 생성
      scheduled_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "failed");

  revalidatePath("/");
}

// 인스타 뷰어에서 "업로드 완료" 표시 → published 로
export async function markUploaded(formData: FormData) {
  const id = String(formData.get("id"));
  const { user, supabase } = await requireUser();
  await supabase
    .from("post_targets")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("platform", "instagram");
  revalidatePath("/queue");
}

export async function deletePost(formData: FormData) {
  const postId = String(formData.get("post_id"));
  const { user, supabase } = await requireUser();

  await supabase.from("posts").delete().eq("id", postId).eq("user_id", user.id);
  revalidatePath("/");
}
