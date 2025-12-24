import { Router } from "express";
import { prisma } from "../../config/db";
import { authenticate } from "../../middlewares/auth";
import { createError } from "../../utils/errors";

const router = Router();

const parseId = (value: string | undefined, label: string): number => {
  const id = Number(value);
  if (!value || Number.isNaN(id)) {
    throw createError(`Invalid ${label} id`, {
      statusCode: 400,
      code: "INVALID_ID",
    });
  }
  return id;
};

router.get("/:sessionId/attendance", authenticate, async (req, res, next) => {
  try {
    const sessionId = parseId(req.params.sessionId, "session");

    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw createError("Attendance session not found", {
        statusCode: 404,
        code: "SESSION_NOT_FOUND",
      });
    }

    const study = await prisma.study.findUnique({ where: { id: session.studyId } });
    if (!study || study.leaderId !== req.user!.id) {
      throw createError("Only study leaders can perform this action for the given study", {
        statusCode: 403,
        code: "FORBIDDEN",
      });
    }

    const records = await prisma.attendanceRecord.findMany({
      where: { sessionId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { recordedAt: "desc" },
    });

    res.json({ sessionId, records });
  } catch (error) {
    next(error);
  }
});

export default router;
