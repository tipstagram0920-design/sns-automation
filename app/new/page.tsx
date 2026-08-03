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

  return (
    <>
      <Nav email={user.email} />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>새 게시물</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>
          영상 하나를 올리고, 플랫폼마다 캡션·예약 시각을 다르게 설정하세요.
        </p>

        {connected.size === 0 ? (
          <div
            style={{
              border: "1px solid var(--warn)",
              color: "var(--warn)",
              borderRadius: 12,
              padding: 16,
              fontSize: 14,
            }}
          >
            아직 연결된 플랫폼이 없어요. 먼저{" "}
            <Link href="/connections" style={{ textDecoration: "underline" }}>
              계정 연결
            </Link>{" "}
            을 해주세요.
          </div>
        ) : (
          <NewPostForm
            userId={user.id}
            connected={Array.from(connected)}
          />
        )}
      </main>
    </>
  );
}
