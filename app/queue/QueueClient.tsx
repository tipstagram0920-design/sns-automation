"use client";

import { useState } from "react";
import { markUploaded } from "@/app/actions/targets";

export interface QueueItem {
  id: string;
  caption: string;
  scheduledAt: string;
  videoUrl: string;
}

export default function QueueClient({ items }: { items: QueueItem[] }) {
  if (items.length === 0) {
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 40,
          textAlign: "center",
          color: "var(--muted)",
        }}
      >
        예약 시각이 된 인스타 영상이 없어요. 🎉
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {items.map((it) => (
        <Card key={it.id} item={it} />
      ))}
    </div>
  );
}

function Card({ item }: { item: QueueItem }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function saveVideo() {
    setSaving(true);
    try {
      // 폰에서: 파일을 공유시트로 저장 (사진앱 저장 가능). 안 되면 다운로드 링크로.
      const res = await fetch(item.videoUrl);
      const blob = await res.blob();
      const file = new File([blob], `reels-${item.id}.mp4`, {
        type: blob.type || "video/mp4",
      });
      const nav = navigator as Navigator & {
        canShare?: (d: { files: File[] }) => boolean;
        share?: (d: { files: File[]; title?: string }) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: "인스타 릴스" });
      } else {
        const a = document.createElement("a");
        a.href = item.videoUrl;
        a.download = `reels-${item.id}.mp4`;
        a.click();
      }
    } catch {
      window.open(item.videoUrl, "_blank");
    } finally {
      setSaving(false);
    }
  }

  async function copyCaption() {
    await navigator.clipboard.writeText(item.caption);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function openInstagram() {
    window.location.href = "instagram://camera";
    setTimeout(() => window.open("https://www.instagram.com", "_blank"), 1200);
  }

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: 16,
        opacity: done ? 0.5 : 1,
      }}
    >
      <video
        src={item.videoUrl}
        controls
        playsInline
        style={{ width: "100%", borderRadius: 12, background: "#000", maxHeight: 420 }}
      />
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0" }}>
        예약: {new Date(item.scheduledAt).toLocaleString("ko-KR")}
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          background: "var(--panel-2)",
          padding: 12,
          borderRadius: 10,
          fontFamily: "inherit",
          fontSize: 14,
          margin: "0 0 12px",
        }}
      >
        {item.caption}
      </pre>

      <div style={{ display: "grid", gap: 8 }}>
        <button onClick={saveVideo} disabled={saving} style={btn("#3b82f6")}>
          {saving ? "저장 중…" : "📥 영상 저장하기"}
        </button>
        <button onClick={copyCaption} style={btn("#6366f1")}>
          {copied ? "✅ 복사 완료!" : "📋 캡션 복사하기"}
        </button>
        <button onClick={openInstagram} style={btn("#ec4899")}>
          📸 인스타그램 열기
        </button>
        <form action={markUploaded} onSubmit={() => setDone(true)}>
          <input type="hidden" name="id" value={item.id} />
          <button type="submit" style={{ ...btn("transparent"), border: "1px solid var(--border)", color: "var(--ok)" }}>
            ✅ 업로드 완료 (목록에서 제거)
          </button>
        </form>
      </div>
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    width: "100%",
    padding: "13px",
    borderRadius: 12,
    background: bg,
    color: bg === "transparent" ? undefined : "#fff",
    fontWeight: 700,
    fontSize: 15,
    border: "none",
    cursor: "pointer",
  };
}
