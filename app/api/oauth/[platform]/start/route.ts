import { type NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { buildAuthUrl } from "@/lib/platforms/oauth";
import { PLATFORMS, type Platform } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  if (!PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: "unknown platform" }, { status: 400 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const url = buildAuthUrl(platform as Platform, state);

  const res = NextResponse.redirect(url);
  // CSRF 방지용 state 쿠키 (10분)
  res.cookies.set(`oauth_state_${platform}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
