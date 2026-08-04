"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PLATFORM_LABEL,
  PLATFORM_EMOJI,
  type Platform,
} from "@/lib/types";
import { createPost, type TargetInput } from "./actions";

interface Fields {
  enabled: boolean;
  title: string;
  caption: string;
  tags: string;
  firstComment: string;
  scheduledAt: string; // datetime-local 값
}

function emptyFields(enabled: boolean): Fields {
  return { enabled, title: "", caption: "", tags: "", firstComment: "", scheduledAt: "" };
}

// 로컬 datetime-local 기본값 = 지금+1시간
function defaultLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function NewPostForm({
  userId,
  connected,
}: {
  userId: string;
  connected: Platform[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [duration, setDuration] = useState<number | null>(null);

  const [fields, setFields] = useState<Record<Platform, Fields>>(() => {
    const init = {} as Record<Platform, Fields>;
    (["youtube", "instagram", "tiktok"] as Platform[]).forEach((p) => {
      init[p] = emptyFields(connected.includes(p));
      init[p].scheduledAt = defaultLocal();
    });
    return init;
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 원본 캡션 → AI 자동 생성
  const [baseCaption, setBaseCaption] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  // 유튜브 고정 첫 댓글 (localStorage 에 저장 → 다음에도 자동 채움)
  const [savedComment, setSavedComment] = useState("");
  useEffect(() => {
    const saved = localStorage.getItem("fixedFirstComment") || "";
    if (saved) {
      setSavedComment(saved);
      setFields((prev) => ({
        ...prev,
        youtube: { ...prev.youtube, firstComment: saved },
      }));
    }
  }, []);

  function saveFixedComment() {
    const val = fields.youtube.firstComment.trim();
    localStorage.setItem("fixedFirstComment", val);
    setSavedComment(val);
  }

  // 인스타 캡션 맨 끝 고정 문구 (localStorage 저장 → 발행 시 자동 append)
  const [igTail, setIgTail] = useState("");
  const [savedIgTail, setSavedIgTail] = useState("");
  useEffect(() => {
    const saved = localStorage.getItem("fixedIgTail") || "";
    setIgTail(saved);
    setSavedIgTail(saved);
  }, []);
  function saveIgTail() {
    const val = igTail.trim();
    localStorage.setItem("fixedIgTail", val);
    setSavedIgTail(val);
  }

  function update(p: Platform, patch: Partial<Fields>) {
    setFields((prev) => ({ ...prev, [p]: { ...prev[p], ...patch } }));
  }

  async function generateWithAI() {
    setAiError("");
    if (!baseCaption.trim()) return setAiError("원본 캡션을 입력하세요.");
    const active = connected.filter((p) => fields[p].enabled);
    if (active.length === 0) return setAiError("플랫폼을 하나 이상 켜세요.");

    setAiBusy(true);
    try {
      const res = await fetch("/api/ai/adapt-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseCaption, platforms: active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");

      // 켜져 있는 플랫폼 칸을 자동으로 채움
      setFields((prev) => {
        const next = { ...prev };
        if (active.includes("youtube") && data.youtube) {
          next.youtube = {
            ...next.youtube,
            title: data.youtube.title ?? next.youtube.title,
            caption: data.youtube.description ?? next.youtube.caption,
            // 태그는 정확히 5개까지만
            tags: Array.isArray(data.youtube.tags)
              ? data.youtube.tags.slice(0, 5).join(", ")
              : next.youtube.tags,
            // 첫 댓글은 AI가 건드리지 않음 — 내가 설정한 고정 문구 유지
          };
        }
        if (active.includes("instagram") && data.instagram) {
          next.instagram = { ...next.instagram, caption: data.instagram.caption ?? next.instagram.caption };
        }
        if (active.includes("tiktok") && data.tiktok) {
          next.tiktok = { ...next.tiktok, caption: data.tiktok.caption ?? next.tiktok.caption };
        }
        return next;
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setAiBusy(false);
    }
  }

  function onPickFile(f: File | null) {
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
    // 길이 측정
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => setDuration(Math.round(v.duration));
    v.src = url;
  }

  function copyCaptionToAll(from: Platform) {
    const src = fields[from].caption;
    setFields((prev) => {
      const next = { ...prev };
      connected.forEach((p) => {
        next[p] = { ...next[p], caption: src };
      });
      return next;
    });
  }

  async function submit() {
    setError("");
    if (!file) return setError("영상 파일을 선택하세요.");
    const active = connected.filter((p) => fields[p].enabled);
    if (active.length === 0) return setError("발행할 플랫폼을 하나 이상 켜세요.");

    setBusy(true);
    try {
      // 1) Storage 업로드
      const ext = file.name.split(".").pop() || "mp4";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("videos")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(`업로드 실패: ${upErr.message}`);

      // 2) 타겟 구성
      const tail = igTail.trim();
      const targets: TargetInput[] = active.map((p) => ({
        platform: p,
        title: fields[p].title,
        // 인스타는 캡션 맨 끝에 고정 문구 자동 추가
        caption:
          p === "instagram" && tail
            ? `${fields[p].caption}\n\n${tail}`.trim()
            : fields[p].caption,
        tags: fields[p].tags,
        firstComment: fields[p].firstComment,
        // datetime-local(로컬시간) → ISO(UTC) 변환
        scheduledAt: new Date(fields[p].scheduledAt).toISOString(),
      }));

      // 3) DB 기록 (성공 시 서버에서 "/" 로 redirect)
      await createPost({ storagePath: path, durationSec: duration, targets });
    } catch (e) {
      // redirect() 는 예외를 던지므로, 실제 에러 메시지만 표시
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("NEXT_REDIRECT")) return;
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* 업로드 */}
      <section style={panel}>
        <h2 style={h2}>1. 영상 업로드</h2>
        {previewUrl ? (
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <video
              src={previewUrl}
              controls
              style={{ width: 160, borderRadius: 10, background: "#000" }}
            />
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              <div>{file?.name}</div>
              {duration != null && <div>길이: {duration}초</div>}
              <button
                onClick={() => {
                  setFile(null);
                  setPreviewUrl("");
                  setDuration(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                style={{ ...ghostBtn, marginTop: 8 }}
              >
                다시 선택
              </button>
            </div>
          </div>
        ) : (
          <label
            style={{
              display: "grid",
              placeItems: "center",
              border: "1px dashed var(--border)",
              borderRadius: 12,
              padding: 28,
              cursor: "pointer",
              color: "var(--muted)",
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            📤 클릭해서 세로 숏폼 영상 선택 (mp4 권장)
          </label>
        )}
      </section>

      {/* 원본 캡션 → AI 자동 생성 */}
      <section style={panel}>
        <h2 style={h2}>2. 원본 캡션 → AI로 플랫폼별 자동 생성 ✨</h2>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          캡션을 하나만 쓰고 버튼을 누르면, 켜둔 플랫폼의 제목·설명·캡션·태그·첫 댓글을
          각 플랫폼에 맞게 자동으로 채워줍니다. (아래에서 수정 가능)
        </p>
        <textarea
          style={{ ...input, minHeight: 80, resize: "vertical" }}
          value={baseCaption}
          onChange={(e) => setBaseCaption(e.target.value)}
          placeholder="예) 아침 10분 스트레칭 루틴 공개! 뻐근한 몸이 확 풀려요. 따라 해보세요 :)"
        />
        <button
          type="button"
          onClick={generateWithAI}
          disabled={aiBusy}
          style={{
            marginTop: 10,
            padding: "10px 16px",
            background: aiBusy ? "var(--panel-2)" : "var(--accent)",
            border: "none",
            borderRadius: 10,
            fontWeight: 600,
            cursor: aiBusy ? "default" : "pointer",
          }}
        >
          {aiBusy ? "AI 생성 중… (약 5초)" : "✨ AI로 플랫폼별 자동 생성"}
        </button>
        {aiError && (
          <p style={{ marginTop: 10, fontSize: 13, color: "var(--danger)" }}>{aiError}</p>
        )}
      </section>

      {/* 플랫폼별 설정 */}
      <section style={panel}>
        <h2 style={h2}>3. 플랫폼별 캡션 · 예약 (자동 생성 결과 확인·수정)</h2>
        <div style={{ display: "grid", gap: 14 }}>
          {connected.map((p) => {
            const f = fields[p];
            return (
              <div
                key={p}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 14,
                  opacity: f.enabled ? 1 : 0.5,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontWeight: 600,
                    marginBottom: f.enabled ? 12 : 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    onChange={(e) => update(p, { enabled: e.target.checked })}
                  />
                  {PLATFORM_EMOJI[p]} {PLATFORM_LABEL[p]}
                  {p === "instagram" && (
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}>
                      · 메일로 받아 폰에서 직접 업로드
                    </span>
                  )}
                  {p === "youtube" && (
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}>
                      · 자동 발행
                    </span>
                  )}
                </label>

                {f.enabled && (
                  <div style={{ display: "grid", gap: 10 }}>
                    {p === "youtube" && (
                      <Field label="제목 (유튜브)">
                        <input
                          style={input}
                          value={f.title}
                          onChange={(e) => update(p, { title: e.target.value })}
                          placeholder="Shorts 제목"
                        />
                      </Field>
                    )}

                    <Field
                      label={p === "youtube" ? "설명 / 캡션" : "캡션"}
                      right={
                        <button
                          type="button"
                          onClick={() => copyCaptionToAll(p)}
                          style={linkBtn}
                        >
                          이 캡션 전체 복사
                        </button>
                      }
                    >
                      <textarea
                        style={{ ...input, minHeight: 70, resize: "vertical" }}
                        value={f.caption}
                        onChange={(e) => update(p, { caption: e.target.value })}
                        placeholder={
                          p === "instagram"
                            ? "인스타 캡션 (해시태그 없이 · 끝에 아래 고정 문구 자동 추가)"
                            : `${PLATFORM_LABEL[p]}용 캡션`
                        }
                      />
                    </Field>

                    {p === "instagram" && (
                      <Field
                        label="고정 문구 (캡션 맨 끝에 자동 추가)"
                        right={
                          <button type="button" onClick={saveIgTail} style={linkBtn}>
                            {savedIgTail && savedIgTail === igTail
                              ? "✓ 기본값으로 저장됨"
                              : "기본값으로 저장"}
                          </button>
                        }
                      >
                        <textarea
                          style={{ ...input, minHeight: 50, resize: "vertical" }}
                          value={igTail}
                          onChange={(e) => setIgTail(e.target.value)}
                          placeholder="예) 더 많은 꿀팁은 프로필 링크에서! 🔗 #꿀팁 #일상 (여기에 해시태그 넣어도 됨)"
                        />
                      </Field>
                    )}

                    {p === "youtube" && (
                      <>
                        <Field label="태그 (쉼표로 구분)">
                          <input
                            style={input}
                            value={f.tags}
                            onChange={(e) => update(p, { tags: e.target.value })}
                            placeholder="shorts, 브이로그, 꿀팁"
                          />
                        </Field>
                        <Field
                          label="첫 댓글 (고정 문구 · 발행 후 자동 작성)"
                          right={
                            <button
                              type="button"
                              onClick={saveFixedComment}
                              style={linkBtn}
                            >
                              {savedComment && savedComment === f.firstComment
                                ? "✓ 기본값으로 저장됨"
                                : "기본값으로 저장"}
                            </button>
                          }
                        >
                          <input
                            style={input}
                            value={f.firstComment}
                            onChange={(e) =>
                              update(p, { firstComment: e.target.value })
                            }
                            placeholder="예) 구독과 좋아요 부탁드려요! 🔔 (한 번 저장하면 다음에도 자동 입력)"
                          />
                        </Field>
                      </>
                    )}

                    <Field label="예약 시각">
                      <input
                        type="datetime-local"
                        style={input}
                        value={f.scheduledAt}
                        onChange={(e) =>
                          update(p, { scheduledAt: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 14 }}>{error}</div>
      )}

      <button
        onClick={submit}
        disabled={busy}
        style={{
          padding: "13px",
          background: "var(--accent)",
          border: "none",
          borderRadius: 12,
          fontWeight: 700,
          fontSize: 15,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? "업로드 · 예약 중…" : "예약하기"}
      </button>
    </div>
  );
}

function Field({
  label,
  right,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 18,
};
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, marginBottom: 14 };
const input: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 9,
  outline: "none",
};
const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "5px 10px",
  cursor: "pointer",
  color: "var(--muted)",
};
const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--accent)",
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};
