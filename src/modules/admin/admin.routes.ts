import { Router } from "express";
import { prisma } from "../../config/db";
import { authenticate } from "../../middlewares/auth";
import { requireAdmin } from "../../middlewares/rbac";
import { createError } from "../../utils/errors";

const router = Router();

const parseId = (raw: string, label: string): number => {
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw createError(`${label} must be a number`, {
      statusCode: 400,
      code: "INVALID_ID",
    });
  }
  return parsed;
};

router.use(authenticate, requireAdmin);

router.get("/users/:id/attendance", async (req, res, next) => {
  try {
    const userId = parseId(req.params.id, "userId");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, status: true },
    });
    if (!user) {
      throw createError("User not found", {
        statusCode: 404,
        code: "USER_NOT_FOUND",
      });
    }

    const records = await prisma.attendanceRecord.findMany({
      where: { userId },
      include: { session: { include: { study: true } } },
      orderBy: { recordedAt: "desc" },
    });

    res.json({ user, records });
  } catch (error) {
    next(error);
  }
});

router.get("/studies", async (req, res, next) => {
  try {
    const status =
      typeof req.query.status === "string" && req.query.status.length > 0
        ? req.query.status
        : undefined;
    const page = Number(
      typeof req.query.page === "string" ? req.query.page : req.query.page?.toString(),
    );
    const size = Number(
      typeof req.query.size === "string" ? req.query.size : req.query.size?.toString(),
    );

    const pageNum = Number.isNaN(page) || page < 1 ? 1 : page;
    const sizeNum = Number.isNaN(size) || size < 1 ? 10 : Math.min(size, 50);

    const where = status ? { status } : {};

    const [total, studies] = await prisma.$transaction([
      prisma.study.count({ where }),
      prisma.study.findMany({
        where,
        skip: (pageNum - 1) * sizeNum,
        take: sizeNum,
        orderBy: { createdAt: "desc" },
        include: {
          leader: { select: { id: true, name: true, email: true } },
          _count: { select: { StudyMembers: true, Sessions: true } },
        },
      }),
    ]);

    res.json({
      items: studies,
      page: pageNum,
      size: sizeNum,
      total,
      totalPages: Math.ceil(total / sizeNum),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/stats/overview", async (_req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      activeUsers,
      admins,
      totalStudies,
      recruitingStudies,
      totalSessions,
      todaySessions,
      attendanceRecords,
      pendingMembers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: "ACTIVE" } }),
      prisma.user.count({ where: { role: "ADMIN" } }),
      prisma.study.count(),
      prisma.study.count({ where: { status: "RECRUITING" } }),
      prisma.attendanceSession.count(),
      prisma.attendanceSession.count({ where: { date: { gte: today } } }),
      prisma.attendanceRecord.count(),
      prisma.studyMember.count({ where: { status: "PENDING" } }),
    ]);

    res.json({
      users: { total: totalUsers, active: activeUsers, admins },
      studies: { total: totalStudies, recruiting: recruitingStudies },
      attendance: {
        sessionsTotal: totalSessions,
        sessionsToday: todaySessions,
        records: attendanceRecords,
        pendingMembers,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
