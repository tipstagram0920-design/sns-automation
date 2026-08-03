import { google } from "googleapis";
import { Readable } from "stream";
import type { PublishInput, PublishResult } from "@/lib/types";

// 유튜브: videos.insert 로 업로드하면서 status.publishAt 으로 "네이티브 예약 공개".
// 예약 시각이 미래면 유튜브가 알아서 그 시각에 공개하므로, cron 은 업로드만 하면 된다.
// 첫 댓글은 영상이 공개된 뒤에야 달 수 있어, 예약 시각이 지났을 때만 시도한다.
export async function publishYouTube(input: PublishInput): Promise<PublishResult> {
  const { target, videoUrl, connection } = input;

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken ?? undefined,
  });
  const youtube = google.youtube({ version: "v3", auth: oauth2 });

  // Supabase 서명 URL 에서 영상 스트림 가져오기
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok || !videoRes.body) {
    throw new Error(`영상 다운로드 실패 (${videoRes.status})`);
  }
  const nodeStream = Readable.fromWeb(videoRes.body as never);

  const scheduled = new Date(target.scheduled_at);
  const isFuture = scheduled.getTime() > Date.now();

  const insertRes = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: target.title || target.caption?.slice(0, 90) || "Shorts",
        description: target.caption || "",
        tags: target.tags?.length ? target.tags : undefined,
      },
      status: {
        // 미래면 private + publishAt → 예약 공개 / 이미 지난 시각이면 즉시 공개
        privacyStatus: isFuture ? "private" : "public",
        publishAt: isFuture ? scheduled.toISOString() : undefined,
        selfDeclaredMadeForKids: false,
      },
    },
    media: { body: nodeStream },
  });

  const videoId = insertRes.data.id;
  if (!videoId) throw new Error("유튜브 업로드 응답에 video id 가 없습니다.");

  // 첫 댓글: 영상이 이미 공개된 경우에만 (예약 상태에선 댓글 불가)
  if (target.first_comment && !isFuture) {
    await addFirstComment(youtube, videoId, target.first_comment);
  }

  return {
    externalPostId: videoId,
    status: isFuture ? "scheduled" : "published",
  };
}

// 예약 공개된 영상에 첫 댓글을 다는 후속 작업(예약 시각 이후 cron 이 호출)
export async function commentYouTube(
  input: PublishInput,
  videoId: string
): Promise<void> {
  if (!input.target.first_comment) return;
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({
    access_token: input.connection.accessToken,
    refresh_token: input.connection.refreshToken ?? undefined,
  });
  const youtube = google.youtube({ version: "v3", auth: oauth2 });
  await addFirstComment(youtube, videoId, input.target.first_comment);
}

async function addFirstComment(
  youtube: ReturnType<typeof google.youtube>,
  videoId: string,
  text: string
) {
  // ⚠️ API 로 댓글 작성은 가능하지만 "고정(pin)"은 YouTube API 미지원 → 수동 고정 필요
  await youtube.commentThreads.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        videoId,
        topLevelComment: { snippet: { textOriginal: text } },
      },
    },
  });
}
