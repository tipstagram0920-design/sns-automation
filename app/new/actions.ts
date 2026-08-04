"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PLATFORMS, type Platform } from "@/lib/types";
import { sendQueueEmail } from "@/lib/email";

export interface TargetInput {
  platform: Platform;
  title?: string;
  caption?: string;
  tags?: string;
  firstComment?: string;
  scheduledAt: string; // ISO (local datetime-local 을 클라이언트에서 ISO 로 변환해 전달)
}

export interface PostInput {
  storagePath: string;
  durationSec: number | null;
  targets: TargetInput[];
}

async function insertOnePost(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  input: PostInput
) {
  if (!input.storagePath) throw new Error("영상이 업로드되지 않았습니다.");
  const targets = input.targets.filter((t) => PLATFORMS.includes(t.platform));
  if (targets.length === 0) throw new Error("발행할 플랫폼을 하나 이상 선택하세요.");
  for (const t of targets) {
    if (!t.scheduledAt || isNaN(Date.parse(t.scheduledAt))) {
      throw new Error(`${t.platform} 예약 시각이 올바르지 않습니다.`);
    }
  }

  const { data: post, error: postErr } = await supabase
    .from("posts")
    .insert({ user_id: userId, storage_path: input.storagePath, duration_sec: input.durationSec })
    .select("id")
    .single();
  if (postErr || !post) throw new Error(postErr?.message || "게시물 생성 실패");

  const rows = targets.map((t) => ({
    post_id: post.id,
    user_id: userId,
    platform: t.platform,
    title: t.title || null,
    caption: t.caption || null,
    tags: t.tags ? t.tags.split(",").map((s) => s.trim()).filter(Boolean) : [],
    first_comment: t.firstComment || null,
    scheduled_at: new Date(t.scheduledAt).toISOString(),
    status: "pending" as const,
  }));
  const { error: tErr } = await supabase.from("post_targets").insert(rows);
  if (tErr) throw new Error(tErr.message);
}

// 인스타 타겟 개수 세고, 있으면 즉시 뷰어 링크 메일 발송
async function notifyInstagram(inputs: PostInput[]) {
  const igCount = inputs.reduce(
    (n, i) => n + i.targets.filter((t) => t.platform === "instagram").length,
    0
  );
  if (igCount > 0) {
    try {
      await sendQueueEmail(igCount);
    } catch {
      // 메일 실패해도 예약 자체는 성공 처리
    }
  }
}

// 한 개 게시물 생성
export async function createPost(input: PostInput) {
  const { user, supabase } = await requireUser();
  await insertOnePost(supabase, user.id, input);
  await notifyInstagram([input]);
  redirect("/");
}

// 여러 게시물 한꺼번에 생성 (배치 업로드)
export async function createPosts(inputs: PostInput[]) {
  const { user, supabase } = await requireUser();
  const valid = inputs.filter((i) => i.storagePath && i.targets.length > 0);
  if (valid.length === 0) throw new Error("영상을 하나 이상 올리고 플랫폼을 선택하세요.");
  for (const input of valid) {
    await insertOnePost(supabase, user.id, input);
  }
  await notifyInstagram(valid);
  redirect("/");
}
