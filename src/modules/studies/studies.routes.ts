import { Router } from "express";
import { prisma } from "../../config/db";
import { authenticate } from "../../middlewares/auth";
import { requireStudyLeader } from "../../middlewares/rbac";
import { createError } from "../../utils/errors";
import { parsePagination, parseSortParam } from "../../utils/pagination";

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
    const { q, keyword, category, status, page, pageSize, size, sort } = req.query;
    const pagination = parsePagination({
      page: typeof page === "string" ? page : undefined,
      size: typeof pageSize === "string"
        ? pageSize
        : typeof size === "string"
          ? size
          : undefined,
    });
    const { orderBy, sortString } = parseSortParam(
      typeof sort === "string" ? sort : undefined,
      ["createdAt", "title", "status"],
      "createdAt",
    );

    const where: any = {};
    const keywordQuery = (q ?? keyword) as string | undefined;
    if (keywordQuery) {
      const value = String(keywordQuery);
      where.OR = [
        { title: { contains: value, mode: "insensitive" } },
        { description: { contains: value, mode: "insensitive" } },
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
          orderBy,
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
      content: items,
      page: pagination.page,
      size: pagination.size,
      totalElements: total,
      totalPages: Math.ceil(total / pagination.size),
      sort: sortString,
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:studyId", authenticate, requireStudyLeader("studyId"), async (req, res, next) => {
  try {
    const studyId = parseId(req.params.studyId, "study");
    const { title, description, category, maxMembers } = req.body;

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (category !== undefined) data.category = category;
    if (maxMembers !== undefined) {
      const parsed = maxMembers === null ? null : Number(maxMembers);
      if (parsed !== null && Number.isNaN(parsed)) {
        throw createError("maxMembers must be a number", {
          statusCode: 400,
          code: "INVALID_PAYLOAD",
        });
      }
      data.maxMembers = parsed;
    }

    if (!Object.keys(data).length) {
      throw createError("At least one field is required to update", {
        statusCode: 400,
        code: "INVALID_PAYLOAD",
      });
    }

    const updated = await prisma.study.update({
      where: { id: studyId },
      data,
    });

    res.json({ study: updated });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:studyId/status",
  authenticate,
  requireStudyLeader("studyId"),
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      const { status } = req.body;
      const allowed = ["RECRUITING", "CLOSED"];
      if (!status || !allowed.includes(status)) {
        throw createError("status must be RECRUITING or CLOSED", {
          statusCode: 422,
          code: "INVALID_STATUS",
        });
      }

      const updated = await prisma.study.update({
        where: { id: studyId },
        data: { status },
      });

      res.json({ study: updated });
    } catch (error) {
      next(error);
    }
  },
);

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const role = req.query.role ? String(req.query.role) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const allowedRoles = ["LEADER", "MEMBER"];
    if (role && !allowedRoles.includes(role)) {
      throw createError("role must be LEADER or MEMBER", {
        statusCode: 400,
        code: "INVALID_ROLE",
      });
    }
    const allowedStatuses = ["RECRUITING", "CLOSED"];
    if (status && !allowedStatuses.includes(status)) {
      throw createError("status must be RECRUITING or CLOSED", {
        statusCode: 400,
        code: "INVALID_STATUS",
      });
    }

    const memberships = await prisma.studyMember.findMany({
      where: {
        userId: req.user!.id,
        status: "APPROVED",
        ...(role ? { memberRole: role } : {}),
      },
      include: {
        study: {
          include: {
            leader: { select: { id: true, name: true, email: true } },
            _count: { select: { StudyMembers: true, Sessions: true } },
          },
        },
      },
    });

    const filtered = memberships
      .map((m) => ({ ...m.study, memberRole: m.memberRole }))
      .filter((item) => !status || item.status === status);

    res.json({ studies: filtered });
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

router.delete("/:studyId", authenticate, requireStudyLeader("studyId"), async (req, res, next) => {
  try {
    const studyId = parseId(req.params.studyId, "study");

    await prisma.$transaction(async (tx) => {
      const sessions = await tx.attendanceSession.findMany({
        where: { studyId },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);

      if (sessionIds.length) {
        await tx.attendanceRecord.deleteMany({
          where: { sessionId: { in: sessionIds } },
        });
      }

      await tx.attendanceSession.deleteMany({ where: { studyId } });
      await tx.studyMember.deleteMany({ where: { studyId } });
      await tx.study.delete({ where: { id: studyId } });
    });

    res.status(204).send();
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

router.patch(
  "/:studyId/sessions/:sessionId",
  authenticate,
  requireStudyLeader("studyId"),
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "study");
      const sessionId = parseId(req.params.sessionId, "session");
      const { title, date } = req.body;

      if (title === undefined && date === undefined) {
        throw createError("title or date is required", {
          statusCode: 400,
          code: "INVALID_PAYLOAD",
        });
      }

      const session = await prisma.attendanceSession.findUnique({
        where: { id: sessionId },
      });
      if (!session || session.studyId !== studyId) {
        throw createError("Attendance session not found", {
          statusCode: 404,
          code: "SESSION_NOT_FOUND",
        });
      }

      const updateData: Record<string, unknown> = {};
      if (title !== undefined) updateData.title = title;
      if (date !== undefined) {
        const parsed = new Date(date);
        if (Number.isNaN(parsed.getTime())) {
          throw createError("date must be a valid ISO string", {
            statusCode: 400,
            code: "INVALID_DATE",
          });
        }
        updateData.date = parsed;
      }

      const updated = await prisma.attendanceSession.update({
        where: { id: sessionId },
        data: updateData,
      });

      res.json({ session: updated });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/:studyId/sessions/:sessionId",
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

      await prisma.attendanceSession.delete({ where: { id: sessionId } });
      res.status(204).send();
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

      const from = req.query.from ? new Date(String(req.query.from)) : undefined;
      const to = req.query.to ? new Date(String(req.query.to)) : undefined;
      if (from && Number.isNaN(from.getTime())) {
        throw createError("from must be a valid date", {
          statusCode: 400,
          code: "INVALID_DATE",
        });
      }
      if (to && Number.isNaN(to.getTime())) {
        throw createError("to must be a valid date", {
          statusCode: 400,
          code: "INVALID_DATE",
        });
      }

      const grouped = await prisma.attendanceRecord.groupBy({
        by: ["status"],
        where: {
          session: {
            studyId,
            ...(from || to
              ? {
                  date: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                  },
                }
              : {}),
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
      const { page, size, skip, take } = parsePagination({
        page: typeof req.query.page === "string" ? req.query.page : undefined,
        size:
          typeof req.query.pageSize === "string"
            ? req.query.pageSize
            : typeof req.query.size === "string"
              ? req.query.size
              : undefined,
      });
      const where: any = { studyId };
      const keyword = (req.query.q ?? req.query.keyword) as string | undefined;
      if (keyword) {
        const value = String(keyword);
        where.OR = [
          { user: { email: { contains: value, mode: "insensitive" } } },
          { user: { name: { contains: value, mode: "insensitive" } } },
        ];
      }
      if (status) {
        where.status = String(status);
      }

      const { orderBy, sortString } = parseSortParam(
        typeof req.query.sort === "string" ? req.query.sort : undefined,
        ["joinedAt", "email", "name", "status"],
        "joinedAt",
        "asc",
      );

      const members = await prisma.studyMember.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          user: {
            select: { id: true, email: true, name: true, role: true, status: true },
          },
        },
      });

      const total = await prisma.studyMember.count({ where });

      res.json({
        content: members,
        page,
        size,
        totalElements: total,
        totalPages: Math.ceil(total / size),
        sort: sortString,
      });
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

      res.status(204).send();
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

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
