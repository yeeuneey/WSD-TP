import { NextFunction, Request, Response } from "express";
import { AuthErrorCodes } from "firebase-admin/auth";
import { firebaseAuth } from "../config/firebase";

const extractBearerToken = (header?: string): string | null => {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
};

export const verifyFirebaseToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ success: false, message: "Missing bearer token" });
    return;
  }

  try {
    const decoded = await firebaseAuth.verifyIdToken(token, true);
    req.firebaseUser = decoded;
    next();
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error && "code" in error
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (error as any).code
        : undefined;

    const statusCode =
      code === AuthErrorCodes.ID_TOKEN_REVOKED ||
      code === AuthErrorCodes.SESSION_COOKIE_REVOKED
        ? 403
        : 401;

    const message =
      code === AuthErrorCodes.ID_TOKEN_EXPIRED
        ? "Firebase token expired"
        : "Invalid Firebase token";

    res.status(statusCode).json({ success: false, message });
  }
};
