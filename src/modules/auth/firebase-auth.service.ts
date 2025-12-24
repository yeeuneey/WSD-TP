import crypto from "crypto";
import { prisma } from "../../config/db";

type FirebaseUserPayload = {
  uid: string;
  email?: string | null;
  name?: string | null;
};

/**
 * Firebase ID 토큰 정보로 로컬 사용자와 매핑하거나 없으면 생성한다.
 * - 매핑 키는 이메일(고유) 기반.
 * - 소셜 로그인 계정에는 로그인용 비밀번호가 없으므로 더미 해시를 저장한다.
 * - 기본 role/status는 스키마 기본값(USER/ACTIVE)을 그대로 사용.
 */
export const findOrCreateUserByFirebase = async ({
  uid,
  email,
  name,
}: FirebaseUserPayload) => {
  if (!email) {
    const error = new Error("Firebase user does not contain email") as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const displayName = name?.trim() || email.split("@")[0];
  // Firebase UID 기반 더미 해시(로컬 패스워드 로그인에는 사용되지 않음)
  const passwordHash = crypto
    .createHash("sha256")
    .update(`firebase:${uid}`)
    .digest("hex");

  return prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: displayName,
      passwordHash,
      // role/status는 Prisma 스키마 기본값 사용(USER/ACTIVE)
    },
  });
};
