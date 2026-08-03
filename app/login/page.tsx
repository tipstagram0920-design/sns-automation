"use client";

import { useActionState, useState } from "react";
import { signIn, setupAccount } from "./actions";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "setup">("login");

  return (
    <main
      style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 28,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>숏폼 예약 발행</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>
          영상 하나로 인스타·유튜브·틱톡 예약 발행
        </p>

        {mode === "login" ? <LoginForm /> : <SetupForm />}

        <button
          onClick={() => setMode(mode === "login" ? "setup" : "login")}
          style={{
            marginTop: 16,
            background: "transparent",
            border: "none",
            color: "var(--accent)",
            fontSize: 13,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {mode === "login"
            ? "처음이신가요? 비밀번호 직접 설정하기 →"
            : "← 이미 비밀번호가 있어요 (로그인)"}
        </button>
      </div>
    </main>
  );
}

function LoginForm() {
  const [state, action, pending] = useActionState(signIn, { message: "" });
  return (
    <form action={action}>
      <Label>이메일</Label>
      <input type="email" name="email" required autoComplete="username" placeholder="you@example.com" style={inputStyle} />
      <Label>비밀번호</Label>
      <input type="password" name="password" required autoComplete="current-password" placeholder="••••••••" style={inputStyle} />
      <Submit pending={pending}>{pending ? "로그인 중…" : "로그인"}</Submit>
      <Err msg={state.message} />
    </form>
  );
}

function SetupForm() {
  const [state, action, pending] = useActionState(setupAccount, { message: "" });
  return (
    <form action={action}>
      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        허용된 이메일에 대해 사용할 비밀번호를 직접 정하세요. (이메일 확인 없이 바로 사용)
      </p>
      <Label>이메일</Label>
      <input type="email" name="email" required autoComplete="username" placeholder="you@example.com" style={inputStyle} />
      <Label>비밀번호 (8자 이상)</Label>
      <input type="password" name="password" required autoComplete="new-password" placeholder="새 비밀번호" style={inputStyle} />
      <Label>비밀번호 확인</Label>
      <input type="password" name="confirm" required autoComplete="new-password" placeholder="한 번 더" style={inputStyle} />
      <Submit pending={pending}>{pending ? "설정 중…" : "비밀번호 설정하고 시작"}</Submit>
      <Err msg={state.message} />
    </form>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label style={{ fontSize: 13, color: "var(--muted)" }}>{children}</label>;
}
function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        width: "100%",
        marginTop: 6,
        padding: "11px 12px",
        background: "var(--accent)",
        border: "none",
        borderRadius: 10,
        fontWeight: 600,
        cursor: pending ? "default" : "pointer",
        opacity: pending ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}
function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p style={{ marginTop: 14, fontSize: 13, color: "var(--danger)" }}>{msg}</p>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  marginBottom: 14,
  padding: "10px 12px",
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  outline: "none",
};
