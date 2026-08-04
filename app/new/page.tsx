import Nav from "@/components/Nav";
import { requireUser } from "@/lib/auth";
import { type Platform } from "@/lib/types";
import NewPostForm from "./NewPostForm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewPostPage() {
  const { user, supabase } = await requireUser();

  const { data: connections } = await supabase
    .from("platform_connections")
    .select("platform");
  const connected = new Set(
    (connections ?? []).map((c) => c.platform as Platform)
  );
  // 인스타는 "메일 수동 발행"이라 API 연결 없이도 항상 사용 가능
  connected.add("instagram");

  return (
    <>
      <Nav email={user.email} />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>새 게시물</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>
          영상을 올리고, 플랫폼마다 캡션·예약 시각을 설정하세요. 유튜브는 자동 발행,
          인스타는 예약 시각에 메일로 받아 폰에서 직접 올립니다.
        </p>

        {!connected.has("youtube") && (
          <div
            style={{
              border: "1px solid var(--warn)",
              color: "var(--warn)",
              borderRadius: 12,
              padding: 12,
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            유튜브 자동 발행을 쓰려면{" "}
            <Link href="/connections" style={{ textDecoration: "underline" }}>
              계정 연결
            </Link>
            이 필요해요. (인스타는 메일 방식이라 연결 없이 사용 가능)
          </div>
        )}

        <NewPostForm userId={user.id} connected={Array.from(connected)} />
      </main>
    </>
  );
}
