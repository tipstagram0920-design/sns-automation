import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/crypto";
import type { Platform } from "@/lib/types";

export interface LiveConnection {
  accessToken: string;
  refreshToken: string | null;
  externalAccountId: string | null;
  meta: Record<string, unknown>;
}

interface ConnRow {
  id: string;
  platform: Platform;
  access_token_enc: string;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  external_account_id: string | null;
  meta: Record<string, unknown>;
}

// 만료 임박(2분 이내)이면 refresh. youtube/tiktok 은 refresh_token 지원.
export async function getLiveConnection(
  admin: SupabaseClient,
  row: ConnRow
): Promise<LiveConnection> {
  let accessToken = decrypt(row.access_token_enc);
  const refreshToken = row.refresh_token_enc ? decrypt(row.refresh_token_enc) : null;

  const expMs = row.token_expires_at ? Date.parse(row.token_expires_at) : null;
  const soon = expMs != null && expMs - Date.now() < 2 * 60 * 1000;

  if (soon && refreshToken && (row.platform === "youtube" || row.platform === "tiktok")) {
    const refreshed = await refreshAccessToken(row.platform, refreshToken);
    if (refreshed) {
      accessToken = refreshed.accessToken;
      await admin
        .from("platform_connections")
        .update({
          access_token_enc: encrypt(refreshed.accessToken),
          refresh_token_enc: refreshed.refreshToken
            ? encrypt(refreshed.refreshToken)
            : row.refresh_token_enc,
          token_expires_at: refreshed.expiresAt
            ? new Date(refreshed.expiresAt).toISOString()
            : row.token_expires_at,
        })
        .eq("id", row.id);
    }
  }

  return {
    accessToken,
    refreshToken,
    externalAccountId: row.external_account_id,
    meta: row.meta ?? {},
  };
}

async function refreshAccessToken(
  platform: Platform,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: number | null } | null> {
  if (platform === "youtube") {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const d = await res.json();
    if (!res.ok) return null;
    return {
      accessToken: d.access_token,
      refreshToken: null, // Google 은 보통 refresh_token 재발급 안 함
      expiresAt: d.expires_in ? Date.now() + d.expires_in * 1000 : null,
    };
  }

  if (platform === "tiktok") {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const d = await res.json();
    if (!res.ok || d.error) return null;
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token ?? null,
      expiresAt: d.expires_in ? Date.now() + d.expires_in * 1000 : null,
    };
  }

  return null;
}
