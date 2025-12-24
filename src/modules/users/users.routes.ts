import { Router } from "express";
import { prisma } from "../../config/db";
import { authenticate } from "../../middlewares/auth";
import { createError } from "../../utils/errors";
import { sanitizeUser } from "../auth/auth.service";
import { hashPassword, verifyPassword } from "../../utils/passwords";

const router = Router();

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
    });

    if (!user) {
      throw createError("User not found", {
        statusCode: 404,
        code: "USER_NOT_FOUND",
      });
    }

    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
});

router.patch("/me", authenticate, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) {
      throw createError("name is required", {
        statusCode: 400,
        code: "INVALID_PAYLOAD",
      });
    }

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { name },
    });

    res.json({ user: sanitizeUser(updated) });
  } catch (error) {
    next(error);
  }
});

router.patch("/me/password", authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw createError("currentPassword and newPassword are required", {
        statusCode: 400,
        code: "INVALID_PAYLOAD",
      });
    }

    if (newPassword.length < 8) {
      throw createError("Password must be at least 8 characters", {
        statusCode: 400,
        code: "PASSWORD_TOO_SHORT",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
    });

    if (!user) {
      throw createError("User not found", {
        statusCode: 404,
        code: "USER_NOT_FOUND",
      });
    }

    const matches = await verifyPassword(currentPassword, user.passwordHash);
    if (!matches) {
      throw createError("Current password is incorrect", {
        statusCode: 400,
        code: "INVALID_PASSWORD",
      });
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get("/me/attendance", authenticate, async (req, res, next) => {
  try {
    const records = await prisma.attendanceRecord.findMany({
      where: { userId: req.user!.id },
      orderBy: { recordedAt: "desc" },
      include: {
        session: {
          include: {
            study: {
              select: { id: true, title: true, status: true, leaderId: true },
            },
          },
        },
      },
    });

    res.json({
      userId: req.user!.id,
      records,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
