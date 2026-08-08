import Nav from "@/components/Nav";
import { requireUser } from "@/lib/auth";
import { PLATFORMS, PLATFORM_LABEL, PLATFORM_EMOJI, type Platform } from "@/lib/types";
import { disconnect } from "./actions";

export const dynamic = "force-dynamic";

const HELP: Record<Platform, string> = {
  youtube: "Google Cloud Console에서 OAuth 클라이언트 생성 후 내 채널로 로그인",
  instagram: "Meta 앱(개발 모드) + 내 IG 비즈니스 계정을 테스터로 등록",
  tiktok: "TikTok for Developers 앱 + 내 계정으로 로그인 (미심사는 비공개 발행)",
  threads: "Meta 앱에 Threads 제품 추가 + 내 쓰레드 계정 연결 (대본을 글로 자동 게시)",
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { user, supabase } = await requireUser();
  const sp = await searchParams;

  const { data: connections } = await supabase
    .from("platform_connections")
    .select("platform, account_name, token_expires_at, created_at");

  const byPlatform = new Map(
    (connections ?? []).map((c) => [c.platform as Platform, c])
  );

  return (
    <>
      <Nav email={user.email} />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>계정 연결</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>
          내 계정을 각 플랫폼에 연결합니다. 혼자 쓰는 앱이라 개발 모드/테스터
          등록만으로 동작해요.
        </p>

        {sp.ok && (
          <Banner color="var(--ok)">
            {PLATFORM_LABEL[sp.ok as Platform] ?? sp.ok} 연결 완료!
          </Banner>
        )}
        {sp.error && <Banner color="var(--danger)">연결 실패: {sp.error}</Banner>}

        <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
          {PLATFORMS.map((p) => {
            const conn = byPlatform.get(p);
            return (
              <div
                key={p}
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  padding: 18,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <span style={{ fontSize: 26 }}>{PLATFORM_EMOJI[p]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{PLATFORM_LABEL[p]}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                    {conn
                      ? `연결됨: ${conn.account_name ?? "내 계정"}`
                      : HELP[p]}
                  </div>
                </div>
                {conn ? (
                  <form action={disconnect}>
                    <input type="hidden" name="platform" value={p} />
                    <button
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        color: "var(--danger)",
                        borderRadius: 9,
                        padding: "8px 14px",
                        cursor: "pointer",
                      }}
                    >
                      연결 해제
                    </button>
                  </form>
                ) : (
                  <a
                    href={`/api/oauth/${p}/start`}
                    style={{
                      background: "var(--accent)",
                      borderRadius: 9,
                      padding: "8px 16px",
                      fontWeight: 600,
                    }}
                  >
                    연결
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}

function Banner({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${color}`,
        color,
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 14,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}
