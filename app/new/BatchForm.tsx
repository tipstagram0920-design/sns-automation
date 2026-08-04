"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Platform } from "@/lib/types";
import { createPosts, type PostInput, type TargetInput } from "./actions";

const MAX_CARDS = 5;

interface Card {
  key: number;
  file: File | null;
  previewUrl: string;
  duration: number | null;
  base: string; // 원본 대본
  aiBusy: boolean;
  aiError: string;
  ytOn: boolean;
  igOn: boolean;
  title: string; // 유튜브 제목
  ytCaption: string; // 유튜브 설명
  tags: string; // 유튜브 태그
  igCaption: string; // 인스타 캡션
  scheduledAt: string;
}

function defaultLocal(offsetMin = 60): string {
  const d = new Date(Date.now() + offsetMin * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let keySeq = 1;
function newCard(offsetMin: number): Card {
  return {
    key: keySeq++,
    file: null,
    previewUrl: "",
    duration: null,
    base: "",
    aiBusy: false,
    aiError: "",
    ytOn: true,
    igOn: true,
    title: "",
    ytCaption: "",
    tags: "",
    igCaption: "",
    scheduledAt: defaultLocal(offsetMin),
  };
}

export default function BatchForm({
  userId,
  connected,
}: {
  userId: string;
  connected: Platform[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const ytConnected = connected.includes("youtube");

  const [cards, setCards] = useState<Card[]>([newCard(60)]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  // 전체 공통 고정값
  const [firstComment, setFirstComment] = useState("");
  const [igTail, setIgTail] = useState("");
  const [savedFC, setSavedFC] = useState("");
  const [savedTail, setSavedTail] = useState("");
  useEffect(() => {
    const fc = localStorage.getItem("fixedFirstComment") || "";
    const tail = localStorage.getItem("fixedIgTail") || "";
    setFirstComment(fc);
    setSavedFC(fc);
    setIgTail(tail);
    setSavedTail(tail);
  }, []);

  function patch(key: number, p: Partial<Card>) {
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...p } : c)));
  }

  function addCard() {
    if (cards.length >= MAX_CARDS) return;
    // 다음 카드는 예약시각을 1시간씩 뒤로
    setCards((prev) => [...prev, newCard(60 * (prev.length + 1))]);
  }
  function removeCard(key: number) {
    setCards((prev) => (prev.length === 1 ? prev : prev.filter((c) => c.key !== key)));
  }

  function onPickFile(key: number, f: File | null) {
    if (!f) return;
    const url = URL.createObjectURL(f);
    patch(key, { file: f, previewUrl: url });
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => patch(key, { duration: Math.round(v.duration) });
    v.src = url;
  }

  async function aiGenerate(card: Card) {
    if (!card.base.trim()) return patch(card.key, { aiError: "원본 대본을 입력하세요." });
    const platforms: Platform[] = [];
    if (card.ytOn && ytConnected) platforms.push("youtube");
    if (card.igOn) platforms.push("instagram");
    if (platforms.length === 0) return patch(card.key, { aiError: "플랫폼을 켜세요." });

    patch(card.key, { aiBusy: true, aiError: "" });
    try {
      const res = await fetch("/api/ai/adapt-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseCaption: card.base, platforms }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");
      const p: Partial<Card> = {};
      if (platforms.includes("youtube") && data.youtube) {
        p.title = data.youtube.title ?? card.title;
        p.ytCaption = data.youtube.description ?? card.ytCaption;
        p.tags = Array.isArray(data.youtube.tags) ? data.youtube.tags.slice(0, 5).join(", ") : card.tags;
      }
      if (platforms.includes("instagram") && data.instagram) {
        p.igCaption = data.instagram.caption ?? card.igCaption;
      }
      patch(card.key, p);
    } catch (e) {
      patch(card.key, { aiError: e instanceof Error ? e.message : "생성 실패" });
    } finally {
      patch(card.key, { aiBusy: false });
    }
  }

  async function submit() {
    setError("");
    const active = cards.filter((c) => c.file && (c.ytOn || c.igOn));
    if (active.length === 0) return setError("영상을 하나 이상 올리고 플랫폼을 켜세요.");

    setBusy(true);
    try {
      const posts: PostInput[] = [];
      let i = 0;
      for (const c of active) {
        i++;
        setProgress(`${i}/${active.length} 업로드 중…`);
        const ext = c.file!.name.split(".").pop() || "mp4";
        const path = `${userId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("videos")
          .upload(path, c.file!, { contentType: c.file!.type, upsert: false });
        if (upErr) throw new Error(`업로드 실패: ${upErr.message}`);

        const targets: TargetInput[] = [];
        const iso = new Date(c.scheduledAt).toISOString();
        if (c.ytOn && ytConnected) {
          targets.push({
            platform: "youtube",
            title: c.title,
            caption: c.ytCaption,
            tags: c.tags,
            firstComment: firstComment.trim() || undefined,
            scheduledAt: iso,
          });
        }
        if (c.igOn) {
          const cap = igTail.trim() ? `${c.igCaption}\n\n${igTail.trim()}`.trim() : c.igCaption;
          targets.push({ platform: "instagram", caption: cap, scheduledAt: iso });
        }
        posts.push({ storagePath: path, durationSec: c.duration, targets });
      }
      setProgress("예약 저장 중…");
      await createPosts(posts); // 성공 시 "/" 로 redirect
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("NEXT_REDIRECT")) return;
      setError(msg);
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* 전체 공통 고정 문구 */}
      <section style={panel}>
        <h2 style={h2}>공통 고정 문구 (모든 영상에 적용)</h2>
        <Field label="유튜브 첫 댓글 (고정)" right={<SaveBtn on={() => { localStorage.setItem("fixedFirstComment", firstComment.trim()); setSavedFC(firstComment.trim()); }} saved={!!savedFC && savedFC === firstComment} />}>
          <input style={input} value={firstComment} onChange={(e) => setFirstComment(e.target.value)} placeholder="예) 구독과 좋아요 부탁드려요! 🔔" />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="인스타 캡션 끝 고정 문구 (여러 줄 가능)" right={<SaveBtn on={() => { localStorage.setItem("fixedIgTail", igTail.trim()); setSavedTail(igTail.trim()); }} saved={!!savedTail && savedTail === igTail} />}>
          <textarea style={{ ...input, minHeight: 90, resize: "vertical" }} value={igTail} onChange={(e) => setIgTail(e.target.value)} placeholder={"예)\n📌 더 많은 꿀팁은 프로필 링크에서 확인하세요!\n\n💬 궁금한 점은 댓글로 남겨주세요\n👉 팔로우하고 매일 꿀팁 받아보기"} />
        </Field>
      </section>

      {cards.map((c, idx) => (
        <section key={c.key} style={panel}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ ...h2, margin: 0 }}>영상 {idx + 1}</h2>
            {cards.length > 1 && (
              <button onClick={() => removeCard(c.key)} style={{ ...linkBtn, marginLeft: "auto", color: "var(--danger)" }}>
                삭제
              </button>
            )}
          </div>

          {/* 파일 */}
          {c.previewUrl ? (
            <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              <video src={c.previewUrl} controls style={{ width: 130, borderRadius: 10, background: "#000" }} />
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                <div>{c.file?.name}</div>
                {c.duration != null && <div>{c.duration}초</div>}
                <button onClick={() => patch(c.key, { file: null, previewUrl: "", duration: null })} style={{ ...linkBtn, marginTop: 6 }}>
                  다시 선택
                </button>
              </div>
            </div>
          ) : (
            <label style={dropzone}>
              <input type="file" accept="video/*" hidden onChange={(e) => onPickFile(c.key, e.target.files?.[0] ?? null)} />
              📤 영상 선택
            </label>
          )}

          {/* 원본 대본 + AI */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>원본 대본 / 캡션</div>
            <textarea style={{ ...input, minHeight: 64, resize: "vertical" }} value={c.base} onChange={(e) => patch(c.key, { base: e.target.value })} placeholder="영상 대본이나 핵심 내용을 붙여넣으세요" />
            <button onClick={() => aiGenerate(c)} disabled={c.aiBusy} style={{ marginTop: 8, ...smallBtn }}>
              {c.aiBusy ? "AI 생성 중…" : "✨ AI로 캡션 자동 생성"}
            </button>
            {c.aiError && <span style={{ marginLeft: 10, fontSize: 12, color: "var(--danger)" }}>{c.aiError}</span>}
          </div>

          {/* 플랫폼 */}
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <label style={toggle}>
              <input type="checkbox" checked={c.ytOn} disabled={!ytConnected} onChange={(e) => patch(c.key, { ytOn: e.target.checked })} />
              ▶️ YouTube Shorts {ytConnected ? "· 자동 발행" : "· (연결 필요)"}
            </label>
            {c.ytOn && ytConnected && (
              <div style={{ display: "grid", gap: 8, paddingLeft: 6 }}>
                <input style={input} value={c.title} onChange={(e) => patch(c.key, { title: e.target.value })} placeholder="유튜브 제목" />
                <textarea style={{ ...input, minHeight: 56, resize: "vertical" }} value={c.ytCaption} onChange={(e) => patch(c.key, { ytCaption: e.target.value })} placeholder="유튜브 설명 (AI가 채움)" />
                <input style={input} value={c.tags} onChange={(e) => patch(c.key, { tags: e.target.value })} placeholder="태그 5개 (쉼표)" />
              </div>
            )}
            <label style={toggle}>
              <input type="checkbox" checked={c.igOn} onChange={(e) => patch(c.key, { igOn: e.target.checked })} />
              📸 Instagram · 메일로 받아 폰에서 업로드
            </label>
            {c.igOn && (
              <textarea style={{ ...input, minHeight: 56, resize: "vertical", marginLeft: 6 }} value={c.igCaption} onChange={(e) => patch(c.key, { igCaption: e.target.value })} placeholder="인스타 캡션 (AI가 채움, 해시태그 없이)" />
            )}
          </div>

          {/* 예약 시각 */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>예약 시각</div>
            <input type="datetime-local" style={input} value={c.scheduledAt} onChange={(e) => patch(c.key, { scheduledAt: e.target.value })} />
          </div>
        </section>
      ))}

      {cards.length < MAX_CARDS && (
        <button onClick={addCard} style={{ ...smallBtn, padding: "12px", borderStyle: "dashed" }}>
          + 영상 추가 ({cards.length}/{MAX_CARDS})
        </button>
      )}

      {error && <div style={{ color: "var(--danger)", fontSize: 14 }}>{error}</div>}

      <button onClick={submit} disabled={busy} style={submitBtn(busy)}>
        {busy ? progress || "처리 중…" : `예약하기 (${cards.filter((c) => c.file).length}개)`}
      </button>
    </div>
  );
}

function Field({ label, right, children }: { label: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}
function SaveBtn({ on, saved }: { on: () => void; saved: boolean }) {
  return (
    <button type="button" onClick={on} style={linkBtn}>
      {saved ? "✓ 저장됨" : "기본값으로 저장"}
    </button>
  );
}

const panel: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 };
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, marginBottom: 12 };
const input: React.CSSProperties = { width: "100%", padding: "9px 11px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 9, outline: "none" };
const linkBtn: React.CSSProperties = { background: "transparent", border: "none", color: "var(--accent)", fontSize: 12, cursor: "pointer", padding: 0 };
const smallBtn: React.CSSProperties = { background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, color: "var(--text)", width: "100%" };
const toggle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14 };
const dropzone: React.CSSProperties = { display: "grid", placeItems: "center", border: "1px dashed var(--border)", borderRadius: 12, padding: 20, cursor: "pointer", color: "var(--muted)" };
function submitBtn(busy: boolean): React.CSSProperties {
  return { padding: "14px", background: "var(--accent)", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 };
}
