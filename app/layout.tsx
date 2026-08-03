import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "숏폼 예약 발행",
  description: "영상 하나를 인스타·유튜브·틱톡에 예약 발행",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
