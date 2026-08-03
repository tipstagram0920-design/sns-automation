import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 영상은 브라우저에서 Supabase Storage 로 직접 업로드하므로 서버 본문 제한 불필요.
  // cloudflared 터널 도메인에서 개발 서버 리소스(_next 등) 요청을 허용
  allowedDevOrigins: ["adaptation-moderate-announce-dat.trycloudflare.com"],
  experimental: {
    // cloudflared 터널(https) 도메인에서 Server Action(로그인 등)이 동작하도록 허용
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "adaptation-moderate-announce-dat.trycloudflare.com",
      ],
    },
  },
};

export default nextConfig;
