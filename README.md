# 숏폼 예약 발행 (SNS Automation)

영상 하나를 올리면 **인스타그램 Reels · 유튜브 Shorts · 틱톡**에 원하는 시각에 예약 발행하는 개인용 웹앱.
플랫폼마다 캡션을 다르게 설정하고, 유튜브에는 첫 댓글을 자동으로 답니다.

> **혼자 쓰는 앱**이라 각 플랫폼을 "개발(Development) 모드 + 내 계정을 테스터로 등록" 방식으로 연결합니다.
> 정식 앱 심사(2~6주)는 필요 없습니다.

## 기술 스택
- Next.js 16 (App Router) + TypeScript
- Supabase (Postgres · Storage · Auth)
- Vercel 배포 + Vercel Cron (예약 발행 폴링)

---

## 빠른 시작

### 1. 의존성
```bash
npm install
```

### 2. Supabase 준비
1. [supabase.com](https://supabase.com) 프로젝트 생성
2. **SQL Editor** 에서 [`supabase/schema.sql`](supabase/schema.sql) 전체를 실행 (테이블·RLS·Storage 버킷 생성)
3. **Authentication > Providers > Email** 켜기 (매직링크 로그인)
4. **Project Settings > API** 에서 URL / anon key / service_role key 복사

### 3. 환경 변수
`.env.example` 를 `.env.local` 로 복사 후 채웁니다.
```bash
cp .env.example .env.local
# 암호화 키 생성:
openssl rand -hex 32   # → TOKEN_ENCRYPTION_KEY
# cron 시크릿 아무 랜덤 문자열:
openssl rand -hex 24   # → CRON_SECRET
```

### 4. 로컬 실행
```bash
npm run dev
# http://localhost:3000 → 내 이메일(ALLOWED_EMAIL)로 로그인
```

---

## 플랫폼 연결 설정 (각각 1회)

각 플랫폼 개발자 콘솔에서 OAuth 앱을 만들고, **리다이렉트 URI** 를 등록해야 합니다.
로컬은 `http://localhost:3000`, 배포는 실제 도메인 기준.

### ▶️ YouTube (Google Cloud)
1. [Google Cloud Console](https://console.cloud.google.com) → 프로젝트 생성
2. **YouTube Data API v3** 사용 설정
3. **OAuth 동의 화면** 구성 → 테스트 사용자에 **내 Google 계정 추가**
4. **사용자 인증 정보 > OAuth 클라이언트 ID(웹)** 생성
   - 승인된 리디렉션 URI: `{APP_URL}/api/oauth/youtube/callback`
5. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 입력
   - 쿼터: 업로드 1회당 1,600 units, 기본 일 10,000 (≈하루 6건). 더 필요하면 증량 신청.

### 📸 Instagram (Meta, 개발 모드)
1. [developers.facebook.com](https://developers.facebook.com) → 앱 생성
2. **Instagram** 제품 추가 (Instagram API with Instagram Login)
3. 내 Instagram 계정을 **프로페셔널(비즈니스/크리에이터)** 로 전환하고 **테스터로 추가**
4. 유효한 OAuth 리디렉션 URI: `{APP_URL}/api/oauth/instagram/callback`
5. `META_APP_ID`, `META_APP_SECRET` 입력
   - 스코프: `instagram_business_basic`, `instagram_business_content_publish`
   - 한도: 콘텐츠 게시 하루 25건.

### 🎵 TikTok (TikTok for Developers)
1. [developers.tiktok.com](https://developers.tiktok.com) → 앱 생성, **Content Posting API** 추가
2. 로그인 리디렉션 URI: `{APP_URL}/api/oauth/tiktok/callback`
3. `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` 입력
4. **PULL_FROM_URL** 을 쓰려면 앱 설정에서 **URL Prefix(Supabase Storage 도메인) 소유권 인증** 필요
   - ⚠️ 미심사 앱은 `SELF_ONLY`(비공개)로만 발행됩니다. 공개 자동발행은 심사 통과 후 [`lib/platforms/tiktok.ts`](lib/platforms/tiktok.ts) 의 `privacy_level` 변경.

---

## 배포 (Vercel)
1. GitHub 에 푸시 후 Vercel 로 import
2. Vercel **Environment Variables** 에 `.env.local` 값 모두 등록 (`NEXT_PUBLIC_APP_URL` 은 배포 도메인)
3. 각 플랫폼 콘솔의 리다이렉트 URI 를 배포 도메인으로도 추가
4. [`vercel.json`](vercel.json) 의 Cron 이 매분 `/api/cron/publish` 호출
   - ⚠️ **분 단위 Cron 은 Vercel Pro 필요.** 무료로 하려면 [Upstash QStash](https://upstash.com/docs/qstash) 나 외부 크론에서
     `GET {APP_URL}/api/cron/publish?secret={CRON_SECRET}` 을 매분 호출하도록 설정.

---

## 동작 방식 요약
- **유튜브**: 업로드 시 `publishAt` 으로 유튜브가 네이티브 예약 공개 → 예약 시각 후 cron 이 첫 댓글 작성.
  (⚠️ 댓글 **고정(pin)** 은 YouTube API 미지원 → 스튜디오에서 수동 고정)
- **인스타/틱톡**: 예약 시각에 cron 이 대신 발행. IG 는 컨테이너 처리 완료까지 폴링(다음 cron 이 이어받음).
- 실패 시 대시보드에서 **재시도** 버튼(자동 재시도는 최대 5회).

## 주요 파일
| 경로 | 역할 |
|---|---|
| [`supabase/schema.sql`](supabase/schema.sql) | DB 스키마 · RLS · Storage |
| [`lib/platforms/oauth.ts`](lib/platforms/oauth.ts) | 3종 OAuth 인증 URL · 토큰 교환 |
| [`lib/platforms/youtube.ts`](lib/platforms/youtube.ts) · [`instagram.ts`](lib/platforms/instagram.ts) · [`tiktok.ts`](lib/platforms/tiktok.ts) | 플랫폼 발행 어댑터 |
| [`app/api/cron/publish/route.ts`](app/api/cron/publish/route.ts) | 예약 발행 스케줄러 |
| [`app/new/NewPostForm.tsx`](app/new/NewPostForm.tsx) | 업로드 · 플랫폼별 캡션/예약 입력 |
