import Nav from "@/components/Nav";
import { requireUser } from "@/lib/auth";
import { type Platform } from "@/lib/types";
import BatchForm from "./BatchForm";
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

  return (
    <>
      <Nav email={user.email} />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>새 게시물</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>
          영상을 올리고(최대 5개), 대본을 붙여 AI 캡션을 만들면 유튜브·인스타·쓰레드에
          자동 발행됩니다.
        </p>

        {connected.size === 0 && (
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
            먼저{" "}
            <Link href="/connections" style={{ textDecoration: "underline" }}>
              계정 연결
            </Link>
            을 해주세요. (유튜브·인스타·쓰레드)
          </div>
        )}

        <BatchForm userId={user.id} connected={Array.from(connected)} />
      </main>
    </>
  );
}
