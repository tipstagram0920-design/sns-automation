import Link from "next/link";
import Nav from "@/components/Nav";
import { requireUser } from "@/lib/auth";
import {
  PLATFORM_EMOJI,
  PLATFORM_LABEL,
  type Platform,
  type TargetStatus,
} from "@/lib/types";
import { retryTarget, deletePost } from "@/app/actions/targets";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<TargetStatus, { label: string; color: string }> = {
  pending: { label: "예약됨", color: "var(--warn)" },
  uploading: { label: "발행 중", color: "var(--accent)" },
  scheduled: { label: "예약 공개", color: "var(--accent)" },
  published: { label: "완료", color: "var(--ok)" },
  failed: { label: "실패", color: "var(--danger)" },
};

interface Row {
  id: string;
  platform: Platform;
  status: TargetStatus;
  scheduled_at: string;
  caption: string | null;
  title: string | null;
  error_message: string | null;
  external_post_id: string | null;
}

export default async function Dashboard() {
  const { user, supabase } = await requireUser();

  const { data: posts } = await supabase
    .from("posts")
    .select(
      "id, created_at, duration_sec, post_targets(id, platform, status, scheduled_at, caption, title, error_message, external_post_id)"
    )
    .order("created_at", { ascending: false });

  return (
    <>
      <Nav email={user.email} />
      <main style={{ maxWidth: 820, margin: "0 auto", padding: "28px 20px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>대시보드</h1>
          <Link
            href="/new"
            style={{
              marginLeft: "auto",
              background: "var(--accent)",
              borderRadius: 10,
              padding: "9px 16px",
              fontWeight: 600,
            }}
          >
            + 새 게시물
          </Link>
        </div>

        {!posts || posts.length === 0 ? (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 40,
              textAlign: "center",
              color: "var(--muted)",
            }}
          >
            아직 예약한 영상이 없어요.{" "}
            <Link href="/new" style={{ color: "var(--accent)" }}>
              첫 게시물 만들기
            </Link>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {posts.map((post) => {
              const targets = (post.post_targets ?? []) as Row[];
              return (
                <div
                  key={post.id}
                  style={{
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      marginBottom: 12,
                    }}
                  >
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>
                      {new Date(post.created_at).toLocaleString("ko-KR")}
                      {post.duration_sec ? ` · ${post.duration_sec}초` : ""}
                    </span>
                    <form action={deletePost} style={{ marginLeft: "auto" }}>
                      <input type="hidden" name="post_id" value={post.id} />
                      <button
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--muted)",
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        삭제
                      </button>
                    </form>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    {targets.map((t) => {
                      const s = STATUS_STYLE[t.status];
                      // 인스타 'scheduled' 는 "메일 발송됨 · 수동 업로드 대기"
                      const label =
                        t.platform === "instagram" && t.status === "scheduled"
                          ? "📱 업로드 대기"
                          : s.label;
                      return (
                        <div
                          key={t.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            fontSize: 14,
                            padding: "8px 10px",
                            background: "var(--panel-2)",
                            borderRadius: 9,
                          }}
                        >
                          <span>{PLATFORM_EMOJI[t.platform]}</span>
                          <span style={{ width: 120 }}>
                            {PLATFORM_LABEL[t.platform]}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--muted)",
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {t.status === "failed" && t.error_message
                              ? `⚠ ${t.error_message}`
                              : new Date(t.scheduled_at).toLocaleString("ko-KR")}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: s.color,
                              border: `1px solid ${s.color}`,
                              borderRadius: 20,
                              padding: "2px 10px",
                            }}
                          >
                            {label}
                          </span>
                          {t.status === "failed" && (
                            <form action={retryTarget}>
                              <input type="hidden" name="id" value={t.id} />
                              <button
                                style={{
                                  background: "transparent",
                                  border: "1px solid var(--border)",
                                  borderRadius: 7,
                                  padding: "3px 9px",
                                  fontSize: 12,
                                  cursor: "pointer",
                                }}
                              >
                                재시도
                              </button>
                            </form>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
