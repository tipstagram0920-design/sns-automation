# CLAUDE.md — 숏폼 예약 발행 (SNS Automation)

영상 하나를 **인스타그램 Reels · 유튜브 Shorts · 틱톡**에 예약 발행하는 **1인용** 웹앱.
플랫폼마다 캡션을 다르게, 유튜브는 첫 댓글을 자동으로 답니다.

## 아키텍처
- **Next.js 16** (App Router, Turbopack) + TypeScript
- **Supabase**: Postgres(스케줄/토큰) · Storage(영상, `videos` 버킷) · Auth(매직링크)
- **Vercel Cron**: 매분 `/api/cron/publish` 폴링 → 예약 시각 도래분 발행

## 핵심 흐름
1. `/new` — 브라우저에서 영상을 **Supabase Storage 로 직접 업로드**(서버 경유 X) → `createPost` 서버액션이 `posts` + 플랫폼별 `post_targets`(status=`pending`) 생성
2. `/api/cron/publish` — `pending`/`failed` 중 예약시각 지난 것을 락 걸고 어댑터로 발행
3. 어댑터는 `PublishInput → PublishResult` 계약을 따름 ([lib/types.ts](lib/types.ts))

## 데이터 모델 ([supabase/schema.sql](supabase/schema.sql))
- `platform_connections` — 플랫폼별 1계정. 토큰은 **AES-256-GCM 암호화**([lib/crypto.ts](lib/crypto.ts))해 `*_enc` 컬럼에 저장
- `posts` — 원본 영상 1건
- `post_targets` — 플랫폼별 발행 계획(캡션·예약·상태). status: `pending→uploading→(scheduled)→published`/`failed`

## 주요 파일 지도
| 경로 | 역할 |
|---|---|
| [lib/platforms/oauth.ts](lib/platforms/oauth.ts) | 3종 인증 URL 생성 + code→token 교환 |
| [lib/platforms/tokens.ts](lib/platforms/tokens.ts) | 토큰 복호화 + 만료 임박 시 refresh(YT/TikTok) |
| [lib/platforms/youtube.ts](lib/platforms/youtube.ts) | `videos.insert`(publishAt 네이티브 예약) + `commentThreads.insert` |
| [lib/platforms/instagram.ts](lib/platforms/instagram.ts) | 컨테이너 생성→폴링→publish→첫 댓글 |
| [lib/platforms/tiktok.ts](lib/platforms/tiktok.ts) | Content Posting API, PULL_FROM_URL |
| [app/api/cron/publish/route.ts](app/api/cron/publish/route.ts) | 스케줄러(락·재시도·YT 마감) |
| [proxy.ts](proxy.ts) | 세션 갱신 + 인증 가드(Next 16 는 middleware 아님) |

## ⚠️ 반드시 기억할 제약 (하드윈)
1. **유튜브 댓글 "고정(pin)"은 API 미지원.** 자동 댓글 작성만 가능, 고정은 스튜디오에서 수동.
2. **예약**: 유튜브만 `status.publishAt` 네이티브. 인스타·틱톡은 cron 이 예약시각에 대신 발행.
3. **틱톡 미심사 앱**은 `privacy_level: "SELF_ONLY"` 만 허용(비공개). 공개는 심사 후.
4. **틱톡 PULL_FROM_URL** 은 개발자 콘솔에서 **URL prefix(도메인) 소유권 인증** 필요.
5. **Vercel 분단위 Cron 은 Pro 요금제 필요.** 무료는 QStash/외부크론으로 `?secret=CRON_SECRET` 호출.
6. **인스타 영상 처리 지연**: 컨테이너가 `FINISHED` 안 되면 `IG_PROCESSING` 던지고 `pending` 복귀 → 다음 cron 이 `ig_container_id` 로 이어받음(attempts 증가 X).
7. **혼자 쓰는 앱** — 각 플랫폼 **개발 모드 + 내 계정 테스터 등록**으로 심사 없이 동작.
8. **플랫폼 API 버전/스코프는 자주 바뀐다.** 엔드포인트 수정 전 `verify-platform-apis` 스킬로 최신 문서 확인.

## 명령어
```bash
npm run dev            # 로컬 개발
npx tsc --noEmit       # 타입체크
npx next build         # 프로덕션 빌드(타입체크 포함)
# cron 수동 트리거:
curl "http://localhost:3000/api/cron/publish?secret=$CRON_SECRET"
```

## 관례
- 서버 컴포넌트/액션 상단은 `requireUser()`([lib/auth.ts](lib/auth.ts))로 인증+허용이메일 검증
- RLS 우회가 필요한 cron/발행은 `createAdminClient()`([lib/supabase/admin.ts](lib/supabase/admin.ts), service_role) — **클라이언트 번들 유입 절대 금지**
- 새 플랫폼 추가는 `add-platform` 스킬의 체크리스트를 따를 것
- 주석·UI 문구는 한국어

## 환경 변수
[.env.example](.env.example) 참고. `TOKEN_ENCRYPTION_KEY`(hex 64자)·`CRON_SECRET`·`ALLOWED_EMAIL` 필수.
