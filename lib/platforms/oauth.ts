import type { Platform } from "@/lib/types";

// ⚠️ 각 플랫폼 API 버전/스코프는 시간이 지나면 바뀝니다.
// 배포 전 각 개발자 콘솔의 최신 문서로 버전과 스코프를 한 번 확인하세요.
const META_GRAPH_VERSION = "v21.0";

export interface ExchangedToken {
  accessToken: string;
  refreshToken: string | null;
  // epoch ms 또는 null
  expiresAt: number | null;
  externalAccountId: string | null;
  accountName: string | null;
  meta: Record<string, unknown>;
}

export function redirectUri(platform: Platform): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}/api/oauth/${platform}/callback`;
}

// ───────── 1) 인증(동의) URL 만들기 ─────────
export function buildAuthUrl(platform: Platform, state: string): string {
  const ru = encodeURIComponent(redirectUri(platform));

  switch (platform) {
    case "youtube": {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        redirect_uri: redirectUri(platform),
        response_type: "code",
        scope: [
          "https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.force-ssl",
        ].join(" "),
        access_type: "offline", // refresh_token 발급
        prompt: "consent",
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    }

    case "instagram": {
      // Instagram API with Instagram Login (2025~ 신 스코프)
      const params = new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        redirect_uri: redirectUri(platform),
        response_type: "code",
        scope: "instagram_business_basic,instagram_business_content_publish",
        state,
      });
      return `https://www.instagram.com/oauth/authorize?${params}`;
    }

    case "tiktok": {
      const params = new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        redirect_uri: redirectUri(platform),
        response_type: "code",
        scope: "user.info.basic,video.publish,video.upload",
        state,
      });
      return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
    }

    case "threads": {
      const params = new URLSearchParams({
        client_id: process.env.THREADS_APP_ID!,
        redirect_uri: redirectUri(platform),
        response_type: "code",
        scope: "threads_basic,threads_content_publish",
        state,
      });
      return `https://threads.net/oauth/authorize?${params}`;
    }
  }
  // eslint 안전용
  throw new Error(`unknown platform ${ru}`);
}

// ───────── 2) code → token 교환 ─────────
export async function exchangeCode(
  platform: Platform,
  code: string
): Promise<ExchangedToken> {
  switch (platform) {
    case "youtube":
      return exchangeYouTube(code);
    case "instagram":
      return exchangeInstagram(code);
    case "tiktok":
      return exchangeTikTok(code);
    case "threads":
      return exchangeThreads(code);
  }
}

async function exchangeThreads(code: string): Promise<ExchangedToken> {
  // (1) 단기 토큰
  const shortRes = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.THREADS_APP_ID!,
      client_secret: process.env.THREADS_APP_SECRET!,
      grant_type: "authorization_code",
      redirect_uri: redirectUri("threads"),
      code,
    }),
  });
  const short = await shortRes.json();
  if (!shortRes.ok) throw new Error(short.error_message || JSON.stringify(short));
  const userId = String(short.user_id ?? "");
  const shortToken = short.access_token;

  // (2) 장기 토큰(약 60일)
  const longRes = await fetch(
    `https://graph.threads.net/access_token?${new URLSearchParams({
      grant_type: "th_exchange_token",
      client_secret: process.env.THREADS_APP_SECRET!,
      access_token: shortToken,
    })}`
  );
  const long = await longRes.json();
  const accessToken = long.access_token || shortToken;
  const expiresAt = long.expires_in ? Date.now() + long.expires_in * 1000 : null;

  let accountName: string | null = null;
  try {
    const me = await fetch(
      `https://graph.threads.net/v1.0/me?fields=username&access_token=${accessToken}`
    ).then((r) => r.json());
    accountName = me.username ?? null;
  } catch {
    /* noop */
  }

  return { accessToken, refreshToken: null, expiresAt, externalAccountId: userId, accountName, meta: {} };
}

async function exchangeYouTube(code: string): Promise<ExchangedToken> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri("youtube"),
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || JSON.stringify(data));

  // 채널 이름 조회(선택)
  let accountName: string | null = null;
  let channelId: string | null = null;
  try {
    const ch = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    ).then((r) => r.json());
    const item = ch.items?.[0];
    channelId = item?.id ?? null;
    accountName = item?.snippet?.title ?? null;
  } catch {
    /* 이름 조회 실패는 치명적이지 않음 */
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    externalAccountId: channelId,
    accountName,
    meta: { scope: data.scope },
  };
}

async function exchangeInstagram(code: string): Promise<ExchangedToken> {
  // (1) 단기 토큰
  const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.META_APP_ID!,
      client_secret: process.env.META_APP_SECRET!,
      grant_type: "authorization_code",
      redirect_uri: redirectUri("instagram"),
      code,
    }),
  });
  const short = await shortRes.json();
  if (!shortRes.ok) throw new Error(short.error_message || JSON.stringify(short));

  const igUserId = String(short.user_id ?? short.data?.[0]?.user_id ?? "");
  const shortToken = short.access_token;

  // (2) 장기 토큰(약 60일)으로 교환
  const longRes = await fetch(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: process.env.META_APP_SECRET!,
      access_token: shortToken,
    })}`
  );
  const long = await longRes.json();
  const accessToken = long.access_token || shortToken;
  const expiresAt = long.expires_in ? Date.now() + long.expires_in * 1000 : null;

  // 계정 이름(username) 조회
  let accountName: string | null = null;
  try {
    const me = await fetch(
      `https://graph.instagram.com/${META_GRAPH_VERSION}/me?fields=username&access_token=${accessToken}`
    ).then((r) => r.json());
    accountName = me.username ?? null;
  } catch {
    /* noop */
  }

  return {
    accessToken,
    refreshToken: null, // IG 장기 토큰은 refresh 대신 갱신 엔드포인트로 연장
    expiresAt,
    externalAccountId: igUserId,
    accountName,
    meta: {},
  };
}

async function exchangeTikTok(code: string): Promise<ExchangedToken> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri("tiktok"),
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || JSON.stringify(data));
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    externalAccountId: data.open_id ?? null,
    accountName: null,
    meta: { scope: data.scope },
  };
}
