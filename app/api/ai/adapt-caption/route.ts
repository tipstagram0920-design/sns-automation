import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/auth";
import { PLATFORMS, type Platform } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 원본 캡션 1개 → 플랫폼별 제목/설명/캡션/태그/첫 댓글 자동 생성
const SYSTEM = `너는 숏폼 영상 SNS 마케팅 카피라이터야. 사용자가 준 "원본 캡션" 하나를 각 플랫폼에 최적화된 형태로 다시 써준다. 반드시 한국어로, 원본의 핵심 메시지·톤을 유지하되 플랫폼 문법에 맞게 변형한다.

플랫폼별 규칙:
- YouTube Shorts: title(제목, 핵심 키워드를 앞쪽에, 60자 내외, 클릭 유도), description(설명, 2~4문장 + 해시태그 3~5개 + #Shorts 포함), tags(검색 키워드 반드시 정확히 5개, # 없이)
- Instagram Reels: caption — **약 1000자 분량(900~1100자)** 으로 풍부하고 몰입감 있게 작성.
  · 첫 줄은 스크롤을 멈추게 하는 강한 훅.
  · 핸드폰에서 읽기 편하게 **2~3문장마다 빈 줄로 문단을 나눠라**(줄바꿈 \n\n 사용).
  · 각 문단에 어울리는 **이모지를 자연스럽게** 넣어 시각적으로 편하게.
  · 마지막은 저장/공유/팔로우를 부드럽게 유도.
  · ⚠️ 해시태그는 절대 넣지 마 — # 기호 자체를 쓰지 마라.
- TikTok: caption(짧고 강렬하게, 트렌디하게, 해시태그 3~6개, #fyp 등 포함)

과장·거짓 정보는 넣지 말고, 원본에 없는 사실을 지어내지 마.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["youtube", "instagram", "tiktok"],
  properties: {
    youtube: {
      type: "object",
      additionalProperties: false,
      required: ["title", "description", "tags"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
    instagram: {
      type: "object",
      additionalProperties: false,
      required: ["caption"],
      properties: { caption: { type: "string" } },
    },
    tiktok: {
      type: "object",
      additionalProperties: false,
      required: ["caption"],
      properties: { caption: { type: "string" } },
    },
  },
} as const;

export async function POST(req: NextRequest) {
  await requireUser(); // 로그인 사용자만

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY 가 설정되지 않았습니다. .env.local 에 키를 넣어주세요." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const baseCaption = String(body?.baseCaption || "").trim();
  const platforms: Platform[] = Array.isArray(body?.platforms)
    ? body.platforms.filter((p: string) => PLATFORMS.includes(p as Platform))
    : PLATFORMS;

  if (!baseCaption) {
    return NextResponse.json({ error: "원본 캡션이 비어 있습니다." }, { status: 400 });
  }

  const client = new Anthropic(); // ANTHROPIC_API_KEY 환경변수 사용

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000, // 인스타 1000자 캡션 + 유튜브까지 여유
      system: SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: `발행할 플랫폼: ${platforms.join(", ")}\n\n원본 캡션:\n"""\n${baseCaption}\n"""\n\n각 플랫폼용으로 다시 써줘.`,
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "AI 응답이 비어 있습니다." }, { status: 502 });
    }
    const parsed = JSON.parse(textBlock.text);
    return NextResponse.json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI 호출 실패";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
