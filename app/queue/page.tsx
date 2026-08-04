import Nav from "@/components/Nav";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import QueueClient, { type QueueItem } from "./QueueClient";

export const dynamic = "force-dynamic";

// 인스타 수동 업로드 뷰어 — 예약 시각이 된 인스타 영상들을 폰에서 한 페이지에 처리
export default async function QueuePage() {
  const { user, supabase } = await requireUser();
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: rows } = await supabase
    .from("post_targets")
    .select("id, caption, scheduled_at, posts(storage_path)")
    .eq("platform", "instagram")
    .in("status", ["pending", "scheduled", "uploading"])
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true });

  const items: QueueItem[] = [];
  for (const r of rows ?? []) {
    const posts = (r as unknown as {
      posts: { storage_path: string } | { storage_path: string }[] | null;
    }).posts;
    const path = Array.isArray(posts) ? posts[0]?.storage_path : posts?.storage_path;
    if (!path) continue;
    const { data: signed } = await admin.storage
      .from("videos")
      .createSignedUrl(path, 60 * 60 * 24 * 7, { download: `reels-${r.id}.mp4` });
    if (!signed) continue;
    items.push({
      id: r.id as string,
      caption: (r.caption as string) || "",
      scheduledAt: r.scheduled_at as string,
      videoUrl: signed.signedUrl,
    });
  }

  return (
    <>
      <Nav email={user.email} />
      <main style={{ maxWidth: 520, margin: "0 auto", padding: "20px 16px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          📸 인스타 업로드
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18 }}>
          예약 시각이 된 인스타 영상이에요. 영상 저장 → 캡션 복사 → 인스타 열기 → 올린
          뒤 완료를 누르세요. (트렌딩 음원은 인스타에서 자유롭게)
        </p>
        <QueueClient items={items} />
      </main>
    </>
  );
}
