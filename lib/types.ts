export type Platform = "youtube" | "instagram" | "tiktok";

export type TargetStatus =
  | "pending"
  | "uploading"
  | "scheduled"
  | "published"
  | "failed";

export const PLATFORMS: Platform[] = ["youtube", "instagram", "tiktok"];

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube Shorts",
  instagram: "Instagram Reels",
  tiktok: "TikTok",
};

export const PLATFORM_EMOJI: Record<Platform, string> = {
  youtube: "▶️",
  instagram: "📸",
  tiktok: "🎵",
};

export interface PlatformConnection {
  id: string;
  platform: Platform;
  external_account_id: string | null;
  account_name: string | null;
  token_expires_at: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface Post {
  id: string;
  storage_path: string;
  thumbnail_path: string | null;
  duration_sec: number | null;
  created_at: string;
}

export interface PostTarget {
  id: string;
  post_id: string;
  platform: Platform;
  title: string | null;
  caption: string | null;
  tags: string[];
  first_comment: string | null;
  scheduled_at: string;
  status: TargetStatus;
  external_post_id: string | null;
  ig_container_id: string | null;
  error_message: string | null;
  attempts: number;
  published_at: string | null;
  created_at: string;
}

// 발행 어댑터가 받는 입력
export interface PublishInput {
  target: PostTarget;
  // IG/TikTok 가 pull 해갈 수 있는 영상 공개(서명) URL
  videoUrl: string;
  connection: {
    accessToken: string;
    refreshToken: string | null;
    externalAccountId: string | null;
    meta: Record<string, unknown>;
  };
}

// 발행 어댑터의 반환
export interface PublishResult {
  externalPostId: string;
  // 유튜브처럼 즉시 published가 아니라 '예약됨' 상태면 scheduled
  status: "published" | "scheduled";
  containerId?: string;
}
