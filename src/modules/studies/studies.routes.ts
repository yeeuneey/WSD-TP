import { Router } from "express";
import { prisma } from "../../config/db";
import { authenticate } from "../../middlewares/auth";
import { requireStudyLeader } from "../../middlewares/rbac";
import { createError } from "../../utils/errors";

const router = Router();

export const parseId = (value: string | undefined, label: string): number => {
  const id = Number(value);
  if (!value || Number.isNaN(id)) {
    throw createError(`Invalid ${label} id`, {
      statusCode: 400,
      code: "INVALID_ID",
    });
  }
  return id;
};

export const ensureApprovedMember = async (
  studyId: number,
  userId: number,
) => {
  const membership = await prisma.studyMember.findUnique({
    where: {
      studyId_userId: {
        studyId,
        userId,
      },
    },
  });

  if (!membership || membership.status !== "APPROVED") {
    throw createError("You are not a member of this study", {
      statusCode: 403,
      code: "NOT_A_MEMBER",
    });
  }

  return membership;
};

export const getStudyOrThrow = async (studyId: number) => {
  const study = await prisma.study.findUnique({ where: { id: studyId } });
  if (!study) {
    throw createError("Study not found", {
      statusCode: 404,
      code: "STUDY_NOT_FOUND",
    });
  }
  return study;
};

export const parsePagination = (pageParam?: string, sizeParam?: string) => {
  const page = Math.max(1, Number(pageParam) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(sizeParam) || 10));
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip, take: pageSize };
};

export const validateMemberStatus = (status: string) => {
  const allowed = ["APPROVED", "PENDING", "REJECTED"];
  if (!allowed.includes(status)) {
    throw createError("Invalid member status", {
      statusCode: 422,
      code: "INVALID_MEMBER_STATUS",
    });
  }
  return status;
};

router.post("/", authenticate, async (req, res, next) => {
  try {
    const { title, description, category, maxMembers } = req.body;
    if (!title || !description) {
      throw createError("title and description are required", {
        statusCode: 400,
        code: "INVALID_PAYLOAD",
      });
    }

    const parsedMaxMembers =
      maxMembers === undefined || maxMembers === null
        ? null
        : Number(maxMembers);
    if (parsedMaxMembers !== null && Number.isNaN(parsedMaxMembers)) {
      throw createError("maxMembers must be a number", {
        statusCode: 400,
        code: "INVALID_PAYLOAD",
      });
    }

    const study = await prisma.$transaction(async (tx) => {
      const created = await tx.study.create({
        data: {
          title,
          description,
          category: category ?? null,
          maxMembers: parsedMaxMembers,
          leaderId: req.user!.id,
        },
      });

      await tx.studyMember.create({
        data: {
          studyId: created.id,
          userId: req.user!.id,
          memberRole: "LEADER",
          status: "APPROVED",
        },
      });

      return created;
    });

    res.status(201).json({ study });
  } catch (error) {
    next(error);
  }
});

router.get("/", authenticate, async (req, res, next) => {
  try {
    const { q, category, status, page, pageSize } = req.query;
    const pagination = parsePagination(
      String(page ?? ""),
      String(pageSize ?? ""),
    );

    const where: any = {};
    if (q) {
      where.OR = [
        { title: { contains: String(q), mode: "insensitive" } },
        { description: { contains: String(q), mode: "insensitive" } },
      ];
    }
    if (category) {
      where.category = String(category);
    }
    if (status) {
      where.status = String(status);
    }

    const [items, total] = await Promise.all([
      prisma.study.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          _count: { select: { StudyMembers: true, Sessions: true } },
          leader: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.study.count({ where }),
    ]);

    res.json({
      data: items,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:studyId", authenticate, async (req, res, next) => {
  try {
    const studyId = parseId(req.params.studyId, "study");
    const study = await prisma.study.findUnique({
      where: { id: studyId },
      include: {
        leader: { select: { id: true, name: true, email: true } },
        _count: { select: { StudyMembers: true, Sessions: true } },
      },
    });

    if (!study) {
      throw createError("Study not found", {
        statusCode: 404,
        code: "STUDY_NOT_FOUND",
      });
    }

    res.json({ study });
  } catch (error) {
    next(error);
  }
});

router.post("/:studyId/join", authenticate, async (req, res, next) => {
  try {
    const studyId = parseId(req.params.studyId, "study");

    const study = await getStudyOrThrow(studyId);

    const existing = await prisma.studyMember.findUnique({
      where: {
        studyId_userId: {
          studyId,
          userId: req.user!.id,
        },
      },
    });

    if (existing) {
      throw createError("Already joined this study", {
        statusCode: 409,
        code: "ALREADY_JOINED",
      });
    }

    if (study.maxMembers) {
      const count = await prisma.studyMember.count({
        where: { studyId, status: "APPROVED" },
      });
      if (count >= study.maxMembers) {
        throw createError("Study is full", {
          statusCode: 409,
          code: "STUDY_FULL",
        });
      }
    }

    const membership = await prisma.studyMember.create({
      data: {
        studyId,
        userId: req.user!.id,
        memberRole: "MEMBER",
        status: "PENDING",
      },
    });

    res.status(201).json({ membership });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/:studyId/sessions",
  authenticate,
  requireStudyLeader("studyId"),
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      const { title, date } = req.body;

      if (!title || !date) {
        throw createError("title and date are required", {
          statusCode: 400,
          code: "INVALID_PAYLOAD",
        });
      }

      const sessionDate = new Date(date);
      if (Number.isNaN(sessionDate.getTime())) {
        throw createError("date must be a valid ISO string", {
          statusCode: 400,
          code: "INVALID_DATE",
        });
      }

      const session = await prisma.attendanceSession.create({
        data: {
          studyId,
          title,
          date: sessionDate,
        },
      });

      res.status(201).json({ session });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/:studyId/sessions/:sessionId/attendance",
  authenticate,
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      const sessionId = parseId(req.params.sessionId, "session");
      const { status } = req.body;

      if (!status || !["PRESENT", "LATE", "ABSENT"].includes(status)) {
        throw createError("status must be PRESENT, LATE, or ABSENT", {
          statusCode: 400,
          code: "INVALID_STATUS",
        });
      }

      await ensureApprovedMember(studyId, req.user!.id);

      const session = await prisma.attendanceSession.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.studyId !== studyId) {
        throw createError("Attendance session not found", {
          statusCode: 404,
          code: "SESSION_NOT_FOUND",
        });
      }

      const existing = await prisma.attendanceRecord.findFirst({
        where: {
          sessionId,
          userId: req.user!.id,
        },
      });

      const record = existing
        ? await prisma.attendanceRecord.update({
            where: { id: existing.id },
            data: { status },
          })
        : await prisma.attendanceRecord.create({
            data: {
              sessionId,
              userId: req.user!.id,
              status,
            },
          });

      res.status(201).json({ record });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/:studyId/attendance/summary",
  authenticate,
  requireStudyLeader("studyId"),
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");

      const grouped = await prisma.attendanceRecord.groupBy({
        by: ["status"],
        where: {
          session: {
            studyId,
          },
        },
        _count: {
          _all: true,
        },
      });

      const summary = grouped.reduce(
        (acc, item) => {
          acc[item.status] = item._count._all;
          acc.total += item._count._all;
          return acc;
        },
        { total: 0 } as Record<string, number>,
      );

      res.json({ studyId, summary });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/:studyId/sessions",
  authenticate,
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      await ensureApprovedMember(studyId, req.user!.id);

      const sessions = await prisma.attendanceSession.findMany({
        where: { studyId },
        orderBy: { date: "desc" },
      });

      res.json({ sessions });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/:studyId/sessions/:sessionId",
  authenticate,
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      const sessionId = parseId(req.params.sessionId, "session");

      await ensureApprovedMember(studyId, req.user!.id);

      const session = await prisma.attendanceSession.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.studyId !== studyId) {
        throw createError("Attendance session not found", {
          statusCode: 404,
          code: "SESSION_NOT_FOUND",
        });
      }

      res.json({ session });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/:studyId/sessions/:sessionId/attendance",
  authenticate,
  requireStudyLeader("studyId"),
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      const sessionId = parseId(req.params.sessionId, "session");

      const session = await prisma.attendanceSession.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.studyId !== studyId) {
        throw createError("Attendance session not found", {
          statusCode: 404,
          code: "SESSION_NOT_FOUND",
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
  },
);

router.get(
  "/:studyId/attendance/users/:userId",
  authenticate,
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      const userId = parseId(req.params.userId, "user");

      const study = await getStudyOrThrow(studyId);

      const membership = await prisma.studyMember.findUnique({
        where: { studyId_userId: { studyId, userId } },
      });

      if (!membership || membership.status !== "APPROVED") {
        throw createError("User is not a member of this study", {
          statusCode: 404,
          code: "MEMBER_NOT_FOUND",
        });
      }

      if (
        req.user!.id !== userId &&
        study.leaderId !== req.user!.id
      ) {
        throw createError("You do not have permission to view this member", {
          statusCode: 403,
          code: "FORBIDDEN",
        });
      }

      const grouped = await prisma.attendanceRecord.groupBy({
        by: ["status"],
        where: {
          userId,
          session: { studyId },
        },
        _count: { _all: true },
      });

      const totalSessions = await prisma.attendanceSession.count({
        where: { studyId },
      });

      const summary = grouped.reduce(
        (acc, item) => {
          acc[item.status] = item._count._all;
          acc.total += item._count._all;
          return acc;
        },
        { total: 0 } as Record<string, number>,
      );

      res.json({ studyId, userId, totalSessions, summary });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/:studyId/members",
  authenticate,
  requireStudyLeader("studyId"),
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      const { status } = req.query;
      const where: any = { studyId };
      if (status) {
        where.status = String(status);
      }

      const members = await prisma.studyMember.findMany({
        where,
        orderBy: { joinedAt: "asc" },
        include: {
          user: {
            select: { id: true, email: true, name: true, role: true, status: true },
          },
        },
      });

      res.json({ members });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/:studyId/members/:userId/status",
  authenticate,
  requireStudyLeader("studyId"),
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      const userId = parseId(req.params.userId, "user");
      const { status } = req.body;

      if (!status) {
        throw createError("status is required", {
          statusCode: 400,
          code: "INVALID_PAYLOAD",
        });
      }

      const normalizedStatus = validateMemberStatus(String(status));
      const study = await getStudyOrThrow(studyId);

      const membership = await prisma.studyMember.findUnique({
        where: { studyId_userId: { studyId, userId } },
      });

      if (!membership) {
        throw createError("Membership not found", {
          statusCode: 404,
          code: "MEMBERSHIP_NOT_FOUND",
        });
      }

      if (membership.memberRole === "LEADER") {
        throw createError("Cannot change status for study leader", {
          statusCode: 400,
          code: "INVALID_OPERATION",
        });
      }

      if (normalizedStatus === "APPROVED" && study.maxMembers) {
        const approvedCount = await prisma.studyMember.count({
          where: {
            studyId,
            status: "APPROVED",
            NOT: { userId },
          },
        });
        if (approvedCount >= study.maxMembers) {
          throw createError("Study is full", {
            statusCode: 409,
            code: "STUDY_FULL",
          });
        }
      }

      const updated = await prisma.studyMember.update({
        where: { studyId_userId: { studyId, userId } },
        data: { status: normalizedStatus },
      });

      res.json({ membership: updated });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/:studyId/members/:userId",
  authenticate,
  requireStudyLeader("studyId"),
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      const userId = parseId(req.params.userId, "user");

      const membership = await prisma.studyMember.findUnique({
        where: { studyId_userId: { studyId, userId } },
      });

      if (!membership) {
        throw createError("Membership not found", {
          statusCode: 404,
          code: "MEMBERSHIP_NOT_FOUND",
        });
      }

      if (membership.memberRole === "LEADER") {
        throw createError("Cannot remove study leader", {
          statusCode: 400,
          code: "INVALID_OPERATION",
        });
      }

      await prisma.studyMember.delete({
        where: { studyId_userId: { studyId, userId } },
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/:studyId/members/leave",
  authenticate,
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      const membership = await prisma.studyMember.findUnique({
        where: { studyId_userId: { studyId, userId: req.user!.id } },
      });

      if (!membership) {
        throw createError("Membership not found", {
          statusCode: 404,
          code: "MEMBERSHIP_NOT_FOUND",
        });
      }

      if (membership.memberRole === "LEADER") {
        throw createError("Study leader cannot leave the study", {
          statusCode: 400,
          code: "INVALID_OPERATION",
        });
      }

      await prisma.studyMember.delete({
        where: { studyId_userId: { studyId, userId: req.user!.id } },
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
