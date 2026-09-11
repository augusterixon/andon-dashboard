import { randomBytes, randomInt } from "crypto";

const INVITE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += INVITE_CHARS[randomInt(INVITE_CHARS.length)];
  }
  return code;
}

export function generateAuthToken(): string {
  return randomBytes(32).toString("hex");
}

export function generateMemberName(): string {
  return `Member-${randomInt(1000, 10000)}`;
}

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
