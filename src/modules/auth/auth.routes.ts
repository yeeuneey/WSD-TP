import { Router } from "express";
import {
  loginUser,
  logoutUser,
  refreshTokens,
  registerUser,
} from "./auth.service";
import { loginWithGoogle } from "./social.service";
import { createError } from "../../utils/errors";

const router = Router();

const extractBearerToken = (header?: string): string | undefined => {
  if (!header) {
    return undefined;
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return undefined;
  }
  return token;
};

router.post("/register", async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      throw createError("email, password, and name are required", {
        statusCode: 400,
        code: "INVALID_PAYLOAD",
      });
    }

    const result = await registerUser(email, password, name);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw createError("email and password are required", {
        statusCode: 400,
        code: "INVALID_PAYLOAD",
      });
    }

    const result = await loginUser(email, password);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw createError("refreshToken is required", {
        statusCode: 400,
        code: "INVALID_PAYLOAD",
      });
    }

    const result = await refreshTokens(refreshToken);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw createError("refreshToken is required", {
        statusCode: 400,
        code: "INVALID_PAYLOAD",
      });
    }

    const accessToken = extractBearerToken(req.headers.authorization);
    await logoutUser(refreshToken, accessToken);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/google", async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      throw createError("idToken is required", {
        statusCode: 400,
        code: "INVALID_PAYLOAD",
      });
    }

    const result = await loginWithGoogle(idToken);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
