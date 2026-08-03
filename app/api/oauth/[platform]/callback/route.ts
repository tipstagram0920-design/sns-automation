import { type NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/platforms/oauth";
import { encrypt } from "@/lib/crypto";
import { createClient } from "@/lib/supabase/server";
import { PLATFORMS, type Platform } from "@/lib/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const fail = (msg: string) =>
    NextResponse.redirect(`${appUrl}/connections?error=${encodeURIComponent(msg)}`);

  if (!PLATFORMS.includes(platform as Platform)) return fail("알 수 없는 플랫폼");

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error_description") || searchParams.get("error");

  if (oauthError) return fail(oauthError);
  if (!code) return fail("인증 코드 없음");

  // state 검증
  const cookieState = req.cookies.get(`oauth_state_${platform}`)?.value;
  if (!cookieState || cookieState !== state) return fail("state 불일치(재시도)");

  // 로그인 사용자 확인
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${appUrl}/login`);

  try {
    const token = await exchangeCode(platform as Platform, code);

    const { error } = await supabase.from("platform_connections").upsert(
      {
        user_id: user.id,
        platform,
        access_token_enc: encrypt(token.accessToken),
        refresh_token_enc: token.refreshToken ? encrypt(token.refreshToken) : null,
        token_expires_at: token.expiresAt
          ? new Date(token.expiresAt).toISOString()
          : null,
        external_account_id: token.externalAccountId,
        account_name: token.accountName,
        meta: token.meta,
      },
      { onConflict: "user_id,platform" }
    );
    if (error) return fail(error.message);

    const res = NextResponse.redirect(`${appUrl}/connections?ok=${platform}`);
    res.cookies.delete(`oauth_state_${platform}`);
    return res;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "토큰 교환 실패");
  }
}
