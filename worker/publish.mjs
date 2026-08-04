// ════════════════════════════════════════════════════════════════
//  발행 워커 — GitHub Actions 등 시간제한 없는 환경에서 실행.
//  Vercel 함수(60초) 대신 이 워커가 큰 영상(1GB+)도 유튜브에 올린다.
//  실행: node worker/publish.mjs   (env 필요: 아래 참고)
//  같은 로직이 app/api/cron/publish/route.ts 에도 있으나, 대용량은 이 워커가 담당.
// ════════════════════════════════════════════════════════════════
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import nodemailer from "nodemailer";

const MAX_ATTEMPTS = 5;
const META_GRAPH_VERSION = "v21.0";
const IG_BASE = `https://graph.instagram.com/${META_GRAPH_VERSION}`;

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`환경변수 ${k} 없음`);
  return v;
};

const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ───────── AES-256-GCM 복호화 (lib/crypto.ts 와 동일) ─────────
function decrypt(payload) {
  const key = Buffer.from(env("TOKEN_ENCRYPTION_KEY"), "hex");
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([d.update(Buffer.from(dataHex, "hex")), d.final()]).toString("utf8");
}
function encrypt(plain) {
  const key = Buffer.from(env("TOKEN_ENCRYPTION_KEY"), "hex");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

// ───────── 토큰: 만료 임박 시 refresh(YT/TikTok) ─────────
async function getLiveConnection(row) {
  let accessToken = decrypt(row.access_token_enc);
  const refreshToken = row.refresh_token_enc ? decrypt(row.refresh_token_enc) : null;
  const expMs = row.token_expires_at ? Date.parse(row.token_expires_at) : null;
  const soon = expMs != null && expMs - Date.now() < 2 * 60 * 1000;

  if (soon && refreshToken && (row.platform === "youtube" || row.platform === "tiktok")) {
    const r = await refreshToken_(row.platform, refreshToken);
    if (r) {
      accessToken = r.accessToken;
      await admin
        .from("platform_connections")
        .update({
          access_token_enc: encrypt(r.accessToken),
          refresh_token_enc: r.refreshToken ? encrypt(r.refreshToken) : row.refresh_token_enc,
          token_expires_at: r.expiresAt ? new Date(r.expiresAt).toISOString() : row.token_expires_at,
        })
        .eq("id", row.id);
    }
  }
  return { accessToken, refreshToken, externalAccountId: row.external_account_id, meta: row.meta ?? {} };
}

async function refreshToken_(platform, refreshToken) {
  if (platform === "youtube") {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const d = await res.json();
    if (!res.ok) return null;
    return { accessToken: d.access_token, refreshToken: null, expiresAt: d.expires_in ? Date.now() + d.expires_in * 1000 : null };
  }
  if (platform === "tiktok") {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env("TIKTOK_CLIENT_KEY"),
        client_secret: env("TIKTOK_CLIENT_SECRET"),
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const d = await res.json();
    if (!res.ok || d.error) return null;
    return { accessToken: d.access_token, refreshToken: d.refresh_token ?? null, expiresAt: d.expires_in ? Date.now() + d.expires_in * 1000 : null };
  }
  return null;
}

// ───────── 유튜브 ─────────
async function publishYouTube(target, videoUrl, conn) {
  const oauth2 = new google.auth.OAuth2(env("GOOGLE_CLIENT_ID"), env("GOOGLE_CLIENT_SECRET"));
  oauth2.setCredentials({ access_token: conn.accessToken, refresh_token: conn.refreshToken ?? undefined });
  const youtube = google.youtube({ version: "v3", auth: oauth2 });

  const res = await fetch(videoUrl);
  if (!res.ok || !res.body) throw new Error(`영상 다운로드 실패 (${res.status})`);
  const nodeStream = Readable.fromWeb(res.body);

  const scheduled = new Date(target.scheduled_at);
  const isFuture = scheduled.getTime() > Date.now();

  const insert = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: target.title || target.caption?.slice(0, 90) || "Shorts",
        description: target.caption || "",
        tags: target.tags?.length ? target.tags : undefined,
      },
      status: {
        privacyStatus: isFuture ? "private" : "public",
        publishAt: isFuture ? scheduled.toISOString() : undefined,
        selfDeclaredMadeForKids: false,
      },
    },
    media: { body: nodeStream },
  });
  const videoId = insert.data.id;
  if (!videoId) throw new Error("유튜브 업로드 응답에 video id 없음");

  if (target.first_comment && !isFuture) {
    await youtube.commentThreads.insert({
      part: ["snippet"],
      requestBody: { snippet: { videoId, topLevelComment: { snippet: { textOriginal: target.first_comment } } } },
    });
  }
  return { externalPostId: videoId, status: isFuture ? "scheduled" : "published" };
}

async function finalizeYouTube(target) {
  try {
    if (target.first_comment && target.external_post_id) {
      const { data: conn } = await admin
        .from("platform_connections").select("*")
        .eq("user_id", target.user_id).eq("platform", "youtube").single();
      if (conn) {
        const live = await getLiveConnection(conn);
        const oauth2 = new google.auth.OAuth2(env("GOOGLE_CLIENT_ID"), env("GOOGLE_CLIENT_SECRET"));
        oauth2.setCredentials({ access_token: live.accessToken, refresh_token: live.refreshToken ?? undefined });
        await google.youtube({ version: "v3", auth: oauth2 }).commentThreads.insert({
          part: ["snippet"],
          requestBody: { snippet: { videoId: target.external_post_id, topLevelComment: { snippet: { textOriginal: target.first_comment } } } },
        });
      }
    }
    await admin.from("post_targets").update({ status: "published", published_at: new Date().toISOString() }).eq("id", target.id);
    return { ok: true };
  } catch (e) {
    await admin.from("post_targets").update({ status: "published", published_at: new Date().toISOString(), error_message: `댓글 실패: ${String(e.message).slice(0, 300)}` }).eq("id", target.id);
    return { ok: true, commentError: String(e.message) };
  }
}

// ───────── 인스타 (시간제한 없어서 최대 5분 폴링) ─────────
async function publishInstagram(target, videoUrl, conn, existingContainerId) {
  const igUserId = conn.externalAccountId;
  const token = conn.accessToken;
  if (!igUserId) throw new Error("IG 사용자 ID 없음");

  let containerId = existingContainerId || undefined;
  if (!containerId) {
    const r = await fetch(`${IG_BASE}/${igUserId}/media`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "REELS", video_url: videoUrl, caption: target.caption || "", access_token: token }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || "컨테이너 생성 실패");
    containerId = d.id;
  }

  const deadline = Date.now() + 5 * 60 * 1000; // 워커는 시간제한 없어 넉넉히
  let finished = false;
  while (Date.now() < deadline) {
    const s = await fetch(`${IG_BASE}/${containerId}?fields=status_code&access_token=${token}`).then((x) => x.json());
    if (s.status_code === "FINISHED") { finished = true; break; }
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`컨테이너 처리 실패: ${s.status_code}`);
    await new Promise((r) => setTimeout(r, 4000));
  }
  if (!finished) { const e = new Error("IG_PROCESSING"); e.containerId = containerId; throw e; }

  const pub = await fetch(`${IG_BASE}/${igUserId}/media_publish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  });
  const pd = await pub.json();
  if (!pub.ok) throw new Error(pd.error?.message || "발행 실패");
  const mediaId = pd.id;

  if (target.first_comment) {
    await fetch(`${IG_BASE}/${mediaId}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: target.first_comment, access_token: token }),
    }).catch(() => {});
  }
  return { externalPostId: mediaId, status: "published", containerId };
}

// ───────── 인스타: API 발행 대신 "메일 수동 발행" ─────────
// 예약 시각에 영상 다운로드 링크 + 캡션을 내 메일로 보냄 → 폰에서 직접 업로드(음원 자유).
async function emailInstagram(target, videoUrl) {
  // 네이버 SMTP (savable card news 프로젝트와 동일 방식)
  const user = env("NAVER_EMAIL");
  const pass = env("NAVER_EMAIL_PASSWORD");
  const to = process.env.NOTIFY_EMAIL || user; // 내 메일로 받기
  const caption = target.caption || "";
  const shortForSubject = caption.replace(/\n/g, " ").slice(0, 40);

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
      <h2>📸 인스타 업로드 예약 도착</h2>
      <p style="color:#666">폰에서 아래 영상을 저장하고, 캡션을 복사해 인스타에 올려주세요. (트렌딩 음원은 앱에서 자유롭게 추가)</p>
      <p><a href="${videoUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">⬇️ 영상 다운로드</a></p>
      <p style="font-size:12px;color:#999">링크는 7일간 유효합니다.</p>
      <h3>캡션 (복사해서 붙여넣기)</h3>
      <pre style="white-space:pre-wrap;background:#f4f4f5;padding:14px;border-radius:10px;font-family:inherit;font-size:14px">${escapeHtml(caption)}</pre>
    </div>`;

  const transport = nodemailer.createTransport({
    host: "smtp.naver.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  const info = await transport.sendMail({
    from: user,
    to,
    subject: `📸 인스타 예약: ${shortForSubject || "영상"}`,
    html,
  });
  return { externalPostId: `email:${info.messageId || "sent"}`, status: "published" };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ───────── 틱톡 (SELF_ONLY) ─────────
async function publishTikTok(target, videoUrl, conn) {
  const r = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: { title: (target.caption || target.title || "").slice(0, 2200), privacy_level: "SELF_ONLY", disable_comment: false, disable_duet: false, disable_stitch: false },
      source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
    }),
  });
  const d = await r.json();
  if (!r.ok || d.error?.code !== "ok") throw new Error(d.error?.message || `TikTok 발행 실패 (${r.status})`);
  return { externalPostId: d.data?.publish_id, status: "published" };
}

// ───────── 하나 처리(락) ─────────
async function runOne(target) {
  const { data: locked } = await admin
    .from("post_targets")
    .update({ status: "uploading", locked_at: new Date().toISOString() })
    .eq("id", target.id).in("status", ["pending", "failed"]).select("id");
  if (!locked || locked.length === 0) return { skipped: "locked" };

  try {
    let result;
    if (target.platform === "instagram") {
      // 메일 수동 발행: 계정 연결 불필요. 7일짜리 다운로드 링크로 메일 발송.
      const { data: signed, error: se } = await admin.storage
        .from("videos")
        .createSignedUrl(target.posts.storage_path, 60 * 60 * 24 * 7, { download: true });
      if (se || !signed) throw new Error("서명 URL 생성 실패");
      result = await emailInstagram(target, signed.signedUrl);
    } else {
      const { data: conn } = await admin
        .from("platform_connections").select("*")
        .eq("user_id", target.user_id).eq("platform", target.platform).single();
      if (!conn) throw new Error(`${target.platform} 계정 미연결`);
      const live = await getLiveConnection(conn);
      const { data: signed, error: se } = await admin.storage.from("videos").createSignedUrl(target.posts.storage_path, 60 * 60);
      if (se || !signed) throw new Error("서명 URL 생성 실패");
      const videoUrl = signed.signedUrl;
      result = target.platform === "youtube"
        ? await publishYouTube(target, videoUrl, live)
        : await publishTikTok(target, videoUrl, live);
    }

    await admin.from("post_targets").update({
      status: result.status,
      external_post_id: result.externalPostId,
      ig_container_id: result.containerId ?? target.ig_container_id,
      error_message: null,
      published_at: result.status === "published" ? new Date().toISOString() : null,
      locked_at: null,
    }).eq("id", target.id);
    return { ok: true, status: result.status, externalId: result.externalPostId };
  } catch (e) {
    if (e.message === "IG_PROCESSING") {
      await admin.from("post_targets").update({ status: "pending", ig_container_id: e.containerId ?? null, locked_at: null }).eq("id", target.id);
      return { retry: "ig_processing" };
    }
    await admin.from("post_targets").update({
      status: "failed", error_message: String(e.message).slice(0, 500), attempts: (target.attempts ?? 0) + 1, locked_at: null,
    }).eq("id", target.id);
    return { error: String(e.message) };
  }
}

// ───────── main ─────────
async function main() {
  const nowIso = new Date().toISOString();
  const log = [];

  // 0) 멈춘 락 회수 (uploading 10분+ 방치 → failed 재시도). 워커는 업로드가 길어서 넉넉히 10분.
  const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: stale } = await admin.from("post_targets").select("id, attempts").eq("status", "uploading").lt("locked_at", staleIso);
  for (const s of stale ?? []) {
    await admin.from("post_targets").update({ status: "failed", error_message: "발행 중 시간 초과 — 자동 재시도", attempts: (s.attempts ?? 0) + 1, locked_at: null }).eq("id", s.id);
    log.push({ id: s.id, reclaimed: true });
  }

  // A) 발행 대상
  const { data: due } = await admin.from("post_targets")
    .select("*, posts(storage_path)")
    .in("status", ["pending", "failed"]).lte("scheduled_at", nowIso).lt("attempts", MAX_ATTEMPTS)
    .order("scheduled_at", { ascending: true }).limit(20);
  for (const t of due ?? []) log.push({ id: t.id, platform: t.platform, ...(await runOne(t)) });

  // B) 유튜브 예약 마감(scheduled + 시각 지남 → 첫 댓글 + published)
  const { data: sched } = await admin.from("post_targets")
    .select("*, posts(storage_path)").eq("status", "scheduled").eq("platform", "youtube").lte("scheduled_at", nowIso).limit(20);
  for (const t of sched ?? []) log.push({ id: t.id, platform: "youtube-finalize", ...(await finalizeYouTube(t)) });

  console.log(JSON.stringify({ ran_at: nowIso, processed: log.length, log }, null, 2));
}

main().catch((e) => { console.error("워커 실패:", e); process.exit(1); });
