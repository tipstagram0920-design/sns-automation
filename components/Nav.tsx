import Link from "next/link";
import { logout } from "@/app/actions/auth";

export default function Nav({ email }: { email?: string }) {
  return (
    <header
      style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--panel)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        <Link href="/" style={{ fontWeight: 700 }}>
          🎬 예약 발행
        </Link>
        <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
          <Link href="/" style={{ color: "var(--muted)" }}>
            대시보드
          </Link>
          <Link href="/new" style={{ color: "var(--muted)" }}>
            새 게시물
          </Link>
          <Link href="/connections" style={{ color: "var(--muted)" }}>
            계정 연결
          </Link>
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {email && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{email}</span>
          )}
          <form action={logout}>
            <button
              type="submit"
              style={{
                fontSize: 13,
                color: "var(--muted)",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "5px 10px",
                cursor: "pointer",
              }}
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
