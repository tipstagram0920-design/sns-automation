import "server-only";
import nodemailer from "nodemailer";

// 인스타 업로드 뷰어(/queue) 링크 메일 — 배치 예약 즉시 발송.
// savable card news 프로젝트와 동일한 네이버 SMTP 방식.
export async function sendQueueEmail(count: number): Promise<void> {
  const user = process.env.NAVER_EMAIL;
  const pass = process.env.NAVER_EMAIL_PASSWORD;
  if (!user || !pass) return; // 메일 설정 없으면 조용히 스킵(예약 자체는 성공)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://sns-automation-rust.vercel.app";
  const viewerUrl = `${appUrl}/queue`;

  const transport = nodemailer.createTransport({
    host: "smtp.naver.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  await transport.sendMail({
    from: user,
    to: process.env.NOTIFY_EMAIL || user,
    subject: `📸 인스타 업로드 ${count}개 예약됨`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <h2>📸 인스타 업로드 ${count}개가 준비됐어요</h2>
        <p style="color:#666">아래 버튼을 누르면 <b>영상 저장 · 캡션 복사 · 인스타 열기</b>를 한 페이지에서 할 수 있어요. 예약한 순서대로 정리돼 있어요.</p>
        <p><a href="${viewerUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">📱 인스타 올리러 가기</a></p>
        <p style="font-size:12px;color:#999">${viewerUrl}</p>
      </div>`,
  });
}
