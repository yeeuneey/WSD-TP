import { OAuth2Client } from "google-auth-library";
import { prisma } from "../../config/db";
import { createError } from "../../utils/errors";
import { issueTokens } from "./auth.service";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

export const loginWithGoogle = async (idToken: string) => {
  if (!googleClient || !googleClientId) {
    throw createError("Google login is not configured", {
      statusCode: 500,
      code: "GOOGLE_AUTH_NOT_CONFIGURED",
    });
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: googleClientId,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.email || !payload.sub) {
    throw createError("Invalid Google token", {
      statusCode: 401,
      code: "INVALID_GOOGLE_TOKEN",
    });
  }

  const email = payload.email.toLowerCase();
  const providerId = payload.sub;

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: payload.name ?? email,
        passwordHash: "",
        provider: "GOOGLE",
        providerId,
        status: "ACTIVE",
      },
    });
  }

  return issueTokens(user);
};
