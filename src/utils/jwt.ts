import jwt, { JwtPayload, Secret } from "jsonwebtoken";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { AppError } from "./errors";

const parseSeconds = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const ACCESS_TOKEN_TTL_SECONDS = parseSeconds(
  process.env.ACCESS_TOKEN_TTL ?? process.env.ACCESS_TOKEN_TTL_SECONDS,
  60 * 15,
);
export const REFRESH_TOKEN_TTL_SECONDS = parseSeconds(
  process.env.REFRESH_TOKEN_TTL ?? process.env.REFRESH_TOKEN_TTL_SECONDS,
  60 * 60 * 24 * 7,
);

export interface TokenPayload extends Record<string, unknown> {
  sub: number;
  role: string;
  type: "access" | "refresh";
  sessionId?: string;
  jti?: string;
  iat?: number;
  exp?: number;
}

const accessSecret: Secret = env.JWT_ACCESS_SECRET;
const refreshSecret: Secret = env.JWT_REFRESH_SECRET;

interface TokenSubject {
  id: number;
  role: string;
}

export const signAccessToken = (user: TokenSubject): string => {
  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    type: "access",
    jti: randomUUID(),
  };

  return jwt.sign(payload, accessSecret, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
};

export const signRefreshToken = (
  user: TokenSubject,
  sessionId = randomUUID(),
): { token: string; sessionId: string } => {
  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    type: "refresh",
    sessionId,
  };

  const token = jwt.sign(payload, refreshSecret, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });

  return { token, sessionId };
};

const normalizePayload = (payload: JwtPayload): TokenPayload => {
  const userId = Number(payload.sub);
  if (Number.isNaN(userId)) {
    throw new AppError("Token is missing subject claim", {
      statusCode: 401,
      code: "INVALID_TOKEN",
    });
  }

  if (typeof payload.role !== "string") {
    throw new AppError("Token is missing role claim", {
      statusCode: 401,
      code: "INVALID_TOKEN",
    });
  }

  if (typeof payload.type !== "string") {
    throw new AppError("Token is missing type claim", {
      statusCode: 401,
      code: "INVALID_TOKEN",
    });
  }

  return {
    ...payload,
    sub: userId,
    role: payload.role,
    type: payload.type as "access" | "refresh",
    sessionId: payload.sessionId as string | undefined,
  };
};

const verifyToken = (token: string, secret: Secret): TokenPayload => {
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === "string") {
      throw new Error("Malformed token payload");
    }
    return normalizePayload(decoded);
  } catch (error) {
    throw new AppError("Invalid or expired token", {
      statusCode: 401,
      code: "INVALID_TOKEN",
    });
  }
};

export const verifyAccessToken = (token: string): TokenPayload => {
  const payload = verifyToken(token, accessSecret);
  if (payload.type !== "access") {
    throw new AppError("Invalid access token", {
      statusCode: 401,
      code: "INVALID_TOKEN",
    });
  }
  return payload;
};

export const verifyRefreshToken = (
  token: string,
): TokenPayload & { sessionId: string } => {
  const payload = verifyToken(token, refreshSecret);
  if (payload.type !== "refresh" || !payload.sessionId) {
    throw new AppError("Invalid refresh token", {
      statusCode: 401,
      code: "INVALID_TOKEN",
    });
  }
  return payload as TokenPayload & { sessionId: string };
};
