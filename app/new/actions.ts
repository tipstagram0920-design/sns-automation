"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PLATFORMS, type Platform } from "@/lib/types";

export interface TargetInput {
  platform: Platform;
  title?: string;
  caption?: string;
  tags?: string;
  firstComment?: string;
  scheduledAt: string; // ISO (local datetime-local 을 클라이언트에서 ISO 로 변환해 전달)
}

// 클라이언트가 Storage 업로드를 끝낸 뒤 호출: posts + post_targets 생성
export async function createPost(input: {
  storagePath: string;
  durationSec: number | null;
  targets: TargetInput[];
}) {
  const { user, supabase } = await requireUser();

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
    .insert({
      user_id: user.id,
      storage_path: input.storagePath,
      duration_sec: input.durationSec,
    })
    .select("id")
    .single();
  if (postErr || !post) throw new Error(postErr?.message || "게시물 생성 실패");

  const rows = targets.map((t) => ({
    post_id: post.id,
    user_id: user.id,
    platform: t.platform,
    title: t.title || null,
    caption: t.caption || null,
    tags: t.tags
      ? t.tags.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    first_comment: t.firstComment || null,
    scheduled_at: new Date(t.scheduledAt).toISOString(),
    status: "pending" as const,
  }));

  const { error: tErr } = await supabase.from("post_targets").insert(rows);
  if (tErr) throw new Error(tErr.message);

  redirect("/");
}
