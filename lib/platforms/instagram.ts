import type { PublishInput, PublishResult } from "@/lib/types";

// Instagram Reels 발행: 컨테이너 생성 → 처리완료 폴링 → publish → (선택)첫 댓글
// 예약은 IG API 미지원이므로 cron 이 예약 시각에 이 함수를 호출한다.
// 컨테이너 생성은 되었지만 처리가 안 끝났으면 ig_container_id 를 저장해 다음 cron 이 이어받는다.

const V = "v21.0";
const BASE = `https://graph.instagram.com/${V}`;

export async function publishInstagram(
  input: PublishInput,
  existingContainerId?: string | null
): Promise<PublishResult> {
  const { target, videoUrl, connection } = input;
  const igUserId = connection.externalAccountId;
  const token = connection.accessToken;
  if (!igUserId) throw new Error("IG 사용자 ID 가 없습니다. 계정을 다시 연결하세요.");

  // 1) 컨테이너 생성 (이미 있으면 재사용)
  let containerId = existingContainerId || undefined;
  if (!containerId) {
    const createRes = await fetch(`${BASE}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        video_url: videoUrl,
        caption: target.caption || "",
        access_token: token,
      }),
    });
    const created = await createRes.json();
    if (!createRes.ok) throw new Error(created.error?.message || "컨테이너 생성 실패");
    containerId = created.id;
  }

  // 2) 처리 상태 폴링 (한 번의 cron 내에서 최대 ~25초만 대기)
  const finished = await pollContainer(containerId!, token);
  if (!finished) {
    // 아직 처리 중 → 컨테이너 ID 를 넘겨 다음 cron 이 이어받게 함(재시도 신호)
    const err = new Error("IG_PROCESSING") as Error & { containerId?: string };
    err.containerId = containerId;
    throw err;
  }

  // 3) 발행
  const pubRes = await fetch(`${BASE}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  });
  const published = await pubRes.json();
  if (!pubRes.ok) throw new Error(published.error?.message || "발행 실패");
  const mediaId = published.id as string;

  // 4) 첫 댓글(선택)
  if (target.first_comment) {
    await fetch(`${BASE}/${mediaId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: target.first_comment, access_token: token }),
    }).catch(() => {
      /* 댓글 실패는 발행 성공을 되돌리지 않음 */
    });
  }

  return { externalPostId: mediaId, status: "published", containerId };
}

async function pollContainer(containerId: string, token: string): Promise<boolean> {
  // 함수 시간제한(Vercel 60s) 여유를 위해 한 번의 cron 에서 최대 ~15초만 폴링
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${BASE}/${containerId}?fields=status_code&access_token=${token}`
    );
    const data = await res.json();
    const status = data.status_code;
    if (status === "FINISHED") return true;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`컨테이너 처리 실패: ${status}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false; // IN_PROGRESS 상태로 시간 초과
}
