import crypto from "crypto";

// 플랫폼 access/refresh 토큰을 DB에 저장하기 전 AES-256-GCM으로 암호화한다.
// TOKEN_ENCRYPTION_KEY = 32바이트 hex (64자). 생성: openssl rand -hex 32

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY 가 없거나 64자(hex 32바이트)가 아닙니다. `openssl rand -hex 32` 로 생성하세요."
    );
  }
  return Buffer.from(hex, "hex");
}

// 결과 포맷: iv(hex):authTag(hex):ciphertext(hex)
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("암호화된 토큰 형식이 올바르지 않습니다.");
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
