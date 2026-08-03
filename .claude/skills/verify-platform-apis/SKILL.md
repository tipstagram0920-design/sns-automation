---
name: verify-platform-apis
description: Verify the app's platform API endpoints, versions, and OAuth scopes against the CURRENT official developer docs (YouTube / Instagram / TikTok). Use before shipping, when a publish starts failing with auth/deprecation errors, or periodically since these APIs drift. Reports a diff of what's stale.
---

# 플랫폼 API 최신성 점검

이 앱의 외부 API 호출은 시간이 지나면 **버전·스코프·엔드포인트가 바뀌어** 깨진다.
이 스킬은 코드의 현재 값과 **공식 문서의 현재 값**을 대조해 무엇이 낡았는지 보고한다.

## 절차

### 1. 코드에서 현재 값 수집
아래를 Grep/Read 로 뽑는다:
- **버전 상수**: `META_GRAPH_VERSION`, instagram.ts 의 `V`, oauth.ts 의 각 authorize/token URL
- **스코프**: `buildAuthUrl` 의 각 `scope`
- **엔드포인트**: 각 어댑터의 fetch URL (media, media_publish, videos.insert, post/publish/video/init 등)

### 2. 공식 문서와 대조 (WebFetch/WebSearch)
| 플랫폼 | 확인할 공식 문서 |
|---|---|
| YouTube | developers.google.com/youtube/v3/docs/videos/insert, commentThreads/insert, OAuth 스코프 목록 |
| Instagram | developers.facebook.com/docs/instagram-platform/content-publishing (Instagram Login), 현재 Graph 버전, 스코프(`instagram_business_*`) |
| TikTok | developers.tiktok.com/doc/content-posting-api-reference — video/init, privacy_level 규칙, 미심사 제약 |

각 항목에 대해: 현재 최신 API 버전은? 우리가 쓰는 스코프가 아직 유효/미deprecated? 요청 바디 형식 동일?

### 3. 보고 (diff 형식)
```
[YouTube] ✅ v3 최신 · 스코프 유효
[Instagram] ⚠️ Graph 버전 v21.0 → 문서 최신 vXX.0, 업그레이드 권장 (lib/platforms/instagram.ts:9)
[TikTok] ❌ privacy_level 규칙 변경됨 — 문서: ... (lib/platforms/tiktok.ts:24)
```
낡은 항목마다 **정확한 파일:라인**과 **출처 URL**, **권장 수정**을 제시한다.
수정 적용이 필요하면 `platform-integrator` 에이전트에 넘기거나 사용자 승인 후 편집한다.

## 주의
- 버전만 올리면 되는지, 요청 형식까지 바뀌었는지 구분할 것.
- 실제 호출 테스트가 필요하면 `curl "$APP_URL/api/cron/publish?secret=$CRON_SECRET"` 응답 로그로 재현.
