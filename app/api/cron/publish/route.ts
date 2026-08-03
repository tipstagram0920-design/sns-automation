import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLiveConnection } from "@/lib/platforms/tokens";
import { publishYouTube, commentYouTube } from "@/lib/platforms/youtube";
import { publishInstagram } from "@/lib/platforms/instagram";
import { publishTikTok } from "@/lib/platforms/tiktok";
import type { PublishInput, PublishResult, PostTarget } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: 발행 처리에 여유

const MAX_ATTEMPTS = 5;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true; // Vercel Cron 방식
  if (new URL(req.url).searchParams.get("secret") === secret) return true; // 수동 호출
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const log: Record<string, unknown>[] = [];

  // ── 0) 멈춘 락 회수: uploading 으로 3분 이상 방치(함수 타임아웃 등) → failed 로 되돌려 재시도 ──
  const staleIso = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data: stale } = await admin
    .from("post_targets")
    .select("id, attempts")
    .eq("status", "uploading")
    .lt("locked_at", staleIso);
  for (const s of stale ?? []) {
    await admin
      .from("post_targets")
      .update({
        status: "failed",
        error_message: "발행 중 시간 초과 — 자동 재시도",
        attempts: ((s as { attempts: number }).attempts ?? 0) + 1,
        locked_at: null,
      })
      .eq("id", (s as { id: string }).id);
    log.push({ id: (s as { id: string }).id, reclaimed: "stale_upload" });
  }

  // ── A) 발행 대상: pending/failed 이고 예약시각 도래, 시도횟수 남음 ──
  const { data: due } = await admin
    .from("post_targets")
    .select("*, posts(storage_path)")
    .in("status", ["pending", "failed"])
    .lte("scheduled_at", nowIso)
    .lt("attempts", MAX_ATTEMPTS)
    .limit(10);

  for (const row of due ?? []) {
    const target = row as unknown as PostTarget & {
      posts: { storage_path: string };
      user_id: string;
    };
    const result = await runOne(admin, target);
    log.push({ id: target.id, platform: target.platform, ...result });
  }

  // ── B) 유튜브 예약 마감 처리: 'scheduled' 이고 시각 지남 → 첫 댓글 + published ──
  const { data: sched } = await admin
    .from("post_targets")
    .select("*, posts(storage_path)")
    .eq("status", "scheduled")
    .eq("platform", "youtube")
    .lte("scheduled_at", nowIso)
    .limit(10);

  for (const row of sched ?? []) {
    const target = row as unknown as PostTarget & {
      posts: { storage_path: string };
      user_id: string;
    };
    const result = await finalizeYouTube(admin, target);
    log.push({ id: target.id, platform: "youtube-finalize", ...result });
  }

  return NextResponse.json({ ran_at: nowIso, processed: log.length, log });
}

// 하나의 타겟을 락 걸고 발행
async function runOne(
  admin: ReturnType<typeof createAdminClient>,
  target: PostTarget & { posts: { storage_path: string }; user_id: string }
): Promise<Record<string, unknown>> {
  // 락: status 를 uploading 으로 (경쟁 방지)
  const { data: locked } = await admin
    .from("post_targets")
    .update({ status: "uploading", locked_at: new Date().toISOString() })
    .eq("id", target.id)
    .in("status", ["pending", "failed"])
    .select("id");
  if (!locked || locked.length === 0) return { skipped: "locked" };

  try {
    // 연결 조회
    const { data: connRow } = await admin
      .from("platform_connections")
      .select("*")
      .eq("user_id", target.user_id)
      .eq("platform", target.platform)
      .single();
    if (!connRow) throw new Error(`${target.platform} 계정이 연결되어 있지 않습니다.`);

    const live = await getLiveConnection(admin, connRow);

    // 서명 URL (IG/TikTok 이 pull, YouTube 는 fetch)
    const { data: signed, error: signErr } = await admin.storage
      .from("videos")
      .createSignedUrl(target.posts.storage_path, 60 * 60);
    if (signErr || !signed) throw new Error("영상 서명 URL 생성 실패");

    const input: PublishInput = {
      target,
      videoUrl: signed.signedUrl,
      connection: {
        accessToken: live.accessToken,
        refreshToken: live.refreshToken,
        externalAccountId: live.externalAccountId,
        meta: live.meta,
      },
    };

    let result: PublishResult;
    if (target.platform === "youtube") result = await publishYouTube(input);
    else if (target.platform === "instagram")
      result = await publishInstagram(input, target.ig_container_id);
    else result = await publishTikTok(input);

    await admin
      .from("post_targets")
      .update({
        status: result.status,
        external_post_id: result.externalPostId,
        ig_container_id: result.containerId ?? target.ig_container_id,
        error_message: null,
        published_at: result.status === "published" ? new Date().toISOString() : null,
        locked_at: null,
      })
      .eq("id", target.id);

    return { ok: true, status: result.status, externalId: result.externalPostId };
  } catch (e) {
    const err = e as Error & { containerId?: string };
    // IG 처리 지연: 컨테이너 저장 후 pending 으로 되돌려 다음 cron 이 이어받음
    if (err.message === "IG_PROCESSING") {
      await admin
        .from("post_targets")
        .update({
          status: "pending",
          ig_container_id: err.containerId ?? null,
          locked_at: null,
        })
        .eq("id", target.id);
      return { retry: "ig_processing" };
    }

    await admin
      .from("post_targets")
      .update({
        status: "failed",
        error_message: err.message?.slice(0, 500),
        attempts: (target.attempts ?? 0) + 1,
        locked_at: null,
      })
      .eq("id", target.id);
    return { error: err.message };
  }
}

// 유튜브 예약 공개가 끝난 뒤 첫 댓글 달고 published 로 마감
async function finalizeYouTube(
  admin: ReturnType<typeof createAdminClient>,
  target: PostTarget & { posts: { storage_path: string }; user_id: string }
): Promise<Record<string, unknown>> {
  try {
    if (target.first_comment && target.external_post_id) {
      const { data: connRow } = await admin
        .from("platform_connections")
        .select("*")
        .eq("user_id", target.user_id)
        .eq("platform", "youtube")
        .single();
      if (connRow) {
        const live = await getLiveConnection(admin, connRow);
        await commentYouTube(
          {
            target,
            videoUrl: "",
            connection: {
              accessToken: live.accessToken,
              refreshToken: live.refreshToken,
              externalAccountId: live.externalAccountId,
              meta: live.meta,
            },
          },
          target.external_post_id
        );
      }
    }
    await admin
      .from("post_targets")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", target.id);
    return { ok: true, commented: !!target.first_comment };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 댓글 실패해도 영상은 이미 공개됨 → published 로 마감하되 메모 남김
    await admin
      .from("post_targets")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        error_message: `댓글 실패: ${msg.slice(0, 300)}`,
      })
      .eq("id", target.id);
    return { ok: true, commentError: msg };
  }
}
