import type { PublishInput, PublishResult } from "@/lib/types";

// TikTok Content Posting API — PULL_FROM_URL 방식으로 발행.
// ⚠️ 미심사(Unaudited) 앱은 privacy_level 이 SELF_ONLY(비공개) 로 제한됨.
//    심사 통과 후 PUBLIC_TO_EVERYONE 등으로 확장 가능.
// ⚠️ PULL_FROM_URL 을 쓰려면 TikTok 개발자 콘솔에서 해당 도메인(URL prefix)
//    소유권 인증이 되어 있어야 한다. (Supabase Storage 도메인 인증 필요)

const BASE = "https://open.tiktokapis.com/v2";

export async function publishTikTok(input: PublishInput): Promise<PublishResult> {
  const { target, videoUrl, connection } = input;
  const token = connection.accessToken;

  const res = await fetch(`${BASE}/post/publish/video/init/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: (target.caption || target.title || "").slice(0, 2200),
        privacy_level: "SELF_ONLY", // 미심사 앱 제약
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error?.code !== "ok") {
    throw new Error(
      data.error?.message || `TikTok 발행 실패 (${res.status})`
    );
  }

  // publish_id 로 상태 조회 가능하지만, MVP 는 init 성공을 발행 성공으로 간주
  const publishId = data.data?.publish_id as string;
  return { externalPostId: publishId, status: "published" };
}
