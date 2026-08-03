---
name: add-platform
description: Add a new social platform (e.g. Facebook, X/Twitter, LinkedIn, Threads) end-to-end to the SNS automation app — types, OAuth config, publish adapter, cron dispatch, and UI. Use when the user asks to support posting to another platform.
---

# 새 플랫폼 추가 체크리스트

새 플랫폼 `NEW`(예: `threads`)를 추가할 때 아래 6곳을 **모두** 수정해야 발행까지 동작한다.
하나라도 빠지면 UI엔 뜨는데 발행이 안 되거나, 타입 에러가 난다.

## 0. 먼저 공식 문서 확인
플랫폼의 OAuth 엔드포인트·스코프·발행 API 형식을 공식 개발자 문서에서 확인한다(WebFetch). 추측 금지. 예약을 네이티브로 지원하는지(YouTube처럼)도 확인.

## 1. 타입 — [lib/types.ts](../../../lib/types.ts)
- `Platform` 유니온에 `"new"` 추가
- `PLATFORMS` 배열, `PLATFORM_LABEL`, `PLATFORM_EMOJI` 에 항목 추가

## 2. DB — [supabase/schema.sql](../../../supabase/schema.sql)
- `platform` enum 에 값 추가:
  ```sql
  alter type platform add value if not exists 'new';
  ```
  (사용자에게 Supabase SQL Editor 에서 실행하도록 안내)

## 3. OAuth — [lib/platforms/oauth.ts](../../../lib/platforms/oauth.ts)
- `buildAuthUrl` 의 `switch` 에 `case "new"` — 인증 URL 조립
- `exchangeCode` 의 `switch` 에 `case "new"` → `exchangeNew(code)` 구현
  - 반환 `ExchangedToken`: accessToken, refreshToken, expiresAt, externalAccountId, accountName, meta
- 환경변수는 [.env.example](../../../.env.example) 에 `NEW_CLIENT_ID/SECRET` 추가

## 4. 토큰 refresh(필요 시) — [lib/platforms/tokens.ts](../../../lib/platforms/tokens.ts)
- refresh_token 을 쓰는 플랫폼이면 `getLiveConnection` 의 조건과 `refreshAccessToken` 의 `switch` 에 `new` 추가

## 5. 발행 어댑터 — `lib/platforms/new.ts` (신규)
- `export async function publishNew(input: PublishInput): Promise<PublishResult>`
- `input.videoUrl`(서명 URL)로 발행, `{ externalPostId, status }` 반환
- 기존 [tiktok.ts](../../../lib/platforms/tiktok.ts)를 템플릿으로 참고

## 6. 스케줄러 디스패치 — [app/api/cron/publish/route.ts](../../../app/api/cron/publish/route.ts)
- `runOne` 안 `if/else` 체인에 `else if (target.platform === "new") result = await publishNew(input)` 추가
- 네이티브 예약을 쓰면 YouTube 처럼 `scheduled` 마감 처리 로직도 고려

## 7. UI (선택이지만 권장) — [app/new/NewPostForm.tsx](../../../app/new/NewPostForm.tsx)
- 플랫폼별 특수 필드(제목/태그 등)가 있으면 `p === "new"` 분기 추가
- 나머지(토글·캡션·예약)는 `connected` 배열로 자동 렌더됨

## 8. 검증
```bash
npx tsc --noEmit && npx next build
```
그리고 사용자에게 안내할 것: 개발자 콘솔 앱 생성, 리다이렉트 URI `{APP_URL}/api/oauth/new/callback` 등록, 내 계정 테스터 등록, 심사 필요 여부.
