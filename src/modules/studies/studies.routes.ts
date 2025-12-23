import { Router } from "express";
import type {
  Prisma,
  Study,
  StudyMember,
  User,
} from "@prisma/client";
import { prisma } from "../../config/db";
import { requireAuth } from "../../middlewares/firebase-auth";
import { createHttpError } from "../../utils/http-error";
import {
  arrayOf,
  optionalEnum,
  optionalNumber,
  optionalString,
  requiredDateString,
  requiredEnum,
  requiredNumber,
  requiredString,
  validateObject,
} from "../../utils/validation";

const router = Router();

const parseId = (raw: string, label: string): number => {
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw createHttpError(400, `${label} must be a number`);
  }
  return parsed;
};

const isAdmin = (user: User) => user.role === "ADMIN";
const isLeader = (study: Study, user: User) => study.leaderId === user.id;

const ensureLeaderOrAdmin = (study: Study, user: User): void => {
  if (isAdmin(user) || isLeader(study, user)) return;
  throw createHttpError(403, "Only the study leader or admin can perform this action");
};

const findMembership = async (
  studyId: number,
  userId: number,
): Promise<StudyMember | null> =>
  prisma.studyMember.findUnique({
    where: { studyId_userId: { studyId, userId } },
  });

const ensureMembership = async (
  studyId: number,
  user: User,
  {
    statuses = ["APPROVED"],
    allowLeader = true,
  }: { statuses?: string[]; allowLeader?: boolean } = {},
) => {
  if (isAdmin(user)) return null;

  const membership = await findMembership(studyId, user.id);
  if (!membership) {
    throw createHttpError(403, "Membership required for this study");
  }

  if (allowLeader && membership.memberRole === "LEADER") return membership;
  if (statuses.includes(membership.status)) return membership;

  throw createHttpError(403, "Insufficient membership status for this action");
};

const ensureApprovedMember = async (studyId: number, user: User) =>
  ensureMembership(studyId, user, { statuses: ["APPROVED"], allowLeader: true });

router.post("/studies", ...requireAuth, async (req, res, next) => {
  try {
    const { title, description, category, maxMembers } = validateObject(
      {
        title: requiredString("title"),
        description: requiredString("description"),
        category: optionalString("category"),
        maxMembers: optionalNumber("maxMembers", { min: 1 }),
      },
      req.body,
    );

    const leaderId = req.authUser!.id;

    const study = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdStudy = await tx.study.create({
        data: {
          title: title.trim(),
          description: description.trim(),
          category: category?.trim(),
          maxMembers: typeof maxMembers === "number" ? maxMembers : undefined,
          leaderId,
        },
      });

      await tx.studyMember.create({
        data: {
          studyId: createdStudy.id,
          userId: leaderId,
          memberRole: "LEADER",
          status: "APPROVED",
        },
      });

      return createdStudy;
    });

    const studyWithLeader = await prisma.study.findUnique({
      where: { id: study.id },
      include: {
        leader: { select: { id: true, name: true, email: true } },
        _count: { select: { StudyMembers: true, Sessions: true } },
      },
    });

    res.status(201).json(studyWithLeader ?? study);
  } catch (error) {
    next(error);
  }
});

router.get("/studies/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id, "studyId");
    const study = await prisma.study.findUnique({
      where: { id },
      include: {
        leader: { select: { id: true, name: true, email: true } },
        StudyMembers: {
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        },
        _count: { select: { StudyMembers: true, Sessions: true } },
      },
    });

    if (!study) throw createHttpError(404, "Study not found");

    res.json(study);
  } catch (error) {
    next(error);
  }
});

router.get("/studies", async (req, res, next) => {
  try {
    const keyword =
      typeof req.query.keyword === "string" ? req.query.keyword.trim() : undefined;
    const category =
      typeof req.query.category === "string" ? req.query.category.trim() : undefined;
    const page = Number(
      typeof req.query.page === "string" ? req.query.page : req.query.page?.toString(),
    );
    const size = Number(
      typeof req.query.size === "string" ? req.query.size : req.query.size?.toString(),
    );
    const sort = typeof req.query.sort === "string" ? req.query.sort : "newest";

    const pageNum = Number.isNaN(page) || page < 1 ? 1 : page;
    const sizeNum = Number.isNaN(size) || size < 1 ? 10 : Math.min(size, 50);

    const where: Prisma.StudyWhereInput = {};
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: "insensitive" } },
        { description: { contains: keyword, mode: "insensitive" } },
      ];
    }
    if (category) {
      where.category = { equals: category, mode: "insensitive" };
    }

    const orderBy =
      sort === "oldest"
        ? { createdAt: "asc" as const }
        : sort === "title"
          ? { title: "asc" as const }
          : { createdAt: "desc" as const };

    const [total, studies] = await prisma.$transaction([
      prisma.study.count({ where }),
      prisma.study.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * sizeNum,
        take: sizeNum,
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

router.patch("/studies/:id", ...requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id, "studyId");
    const study = await prisma.study.findUnique({ where: { id } });
    if (!study) throw createHttpError(404, "Study not found");

    ensureLeaderOrAdmin(study, req.authUser!);

    const { title, description, category, maxMembers, status } = validateObject(
      {
        title: optionalString("title"),
        description: optionalString("description"),
        category: optionalString("category"),
        maxMembers: optionalNumber("maxMembers", { min: 1 }),
        status: optionalEnum("status", [
          "RECRUITING",
          "CLOSED",
          "INACTIVE",
          "ARCHIVED",
        ]),
      },
      req.body,
    );

    const data: Prisma.StudyUpdateInput = {};
    if (title) data.title = title.trim();
    if (description) data.description = description.trim();
    if (category !== undefined) data.category = category?.trim() ?? null;
    if (typeof maxMembers === "number") data.maxMembers = maxMembers;
    if (status) data.status = status;

    const updated = await prisma.study.update({
      where: { id },
      data,
      include: {
        leader: { select: { id: true, name: true, email: true } },
        _count: { select: { StudyMembers: true, Sessions: true } },
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/studies/:id", ...requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id, "studyId");
    const study = await prisma.study.findUnique({ where: { id } });
    if (!study) throw createHttpError(404, "Study not found");

    ensureLeaderOrAdmin(study, req.authUser!);

    await prisma.$transaction([
      prisma.attendanceRecord.deleteMany({
        where: { session: { studyId: id } },
      }),
      prisma.attendanceSession.deleteMany({ where: { studyId: id } }),
      prisma.studyMember.deleteMany({ where: { studyId: id } }),
      prisma.study.delete({ where: { id } }),
    ]);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post("/studies/:id/join", ...requireAuth, async (req, res, next) => {
  try {
    const studyId = parseId(req.params.id, "studyId");
    const study = await prisma.study.findUnique({ where: { id: studyId } });
    if (!study) throw createHttpError(404, "Study not found");

    const existing = await prisma.studyMember.findUnique({
      where: { studyId_userId: { studyId, userId: req.authUser!.id } },
    });

    if (existing?.memberRole === "LEADER") {
      throw createHttpError(400, "Leader is already part of the study");
    }

    if (existing?.status === "APPROVED") {
      throw createHttpError(400, "Already an approved member of this study");
    }

    const membership = existing
      ? await prisma.studyMember.update({
          where: { id: existing.id },
          data: { status: "PENDING" },
        })
      : await prisma.studyMember.create({
          data: { studyId, userId: req.authUser!.id, status: "PENDING" },
        });

    res.status(201).json(membership);
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/studies/:id/members/:memberId/approve",
  ...requireAuth,
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.id, "studyId");
      const memberId = parseId(req.params.memberId, "memberId");

      const member = await prisma.studyMember.findUnique({
        where: { id: memberId },
        include: { study: true },
      });

      if (!member || member.studyId !== studyId) {
        throw createHttpError(404, "Study member not found");
      }

      ensureLeaderOrAdmin(member.study, req.authUser!);

      if (member.study.maxMembers) {
        const approvedCount = await prisma.studyMember.count({
          where: { studyId, status: "APPROVED" },
        });
        if (approvedCount >= member.study.maxMembers) {
          throw createHttpError(400, "Study capacity is already full");
        }
      }

      const updated = await prisma.studyMember.update({
        where: { id: memberId },
        data: { status: "APPROVED" },
        include: { user: { select: { id: true, name: true, email: true } } },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/studies/:id/members/:memberId/reject",
  ...requireAuth,
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.id, "studyId");
      const memberId = parseId(req.params.memberId, "memberId");

      const member = await prisma.studyMember.findUnique({
        where: { id: memberId },
        include: { study: true },
      });

      if (!member || member.studyId !== studyId) {
        throw createHttpError(404, "Study member not found");
      }

      ensureLeaderOrAdmin(member.study, req.authUser!);

      const updated = await prisma.studyMember.update({
        where: { id: memberId },
        data: { status: "REJECTED" },
        include: { user: { select: { id: true, name: true, email: true } } },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

router.get("/studies/:id/members", ...requireAuth, async (req, res, next) => {
  try {
    const studyId = parseId(req.params.id, "studyId");

    const study = await prisma.study.findUnique({
      where: { id: studyId },
      select: { id: true, leaderId: true },
    });
    if (!study) throw createHttpError(404, "Study not found");

    await ensureMembership(studyId, req.authUser!, {
      statuses: ["APPROVED"],
      allowLeader: true,
    });

    const members = await prisma.studyMember.findMany({
      where: { studyId },
      orderBy: { joinedAt: "asc" },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    res.json(members);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/studies/:studyId/sessions",
  ...requireAuth,
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "studyId");
      const study = await prisma.study.findUnique({ where: { id: studyId } });
      if (!study) throw createHttpError(404, "Study not found");

      ensureLeaderOrAdmin(study, req.authUser!);

      const { title, date } = validateObject(
        {
          title: requiredString("title"),
          date: requiredDateString("date"),
        },
        req.body,
      );

      const session = await prisma.attendanceSession.create({
        data: {
          title,
          date,
          studyId,
        },
      });

      res.status(201).json(session);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/studies/:studyId/sessions",
  ...requireAuth,
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "studyId");
      const study = await prisma.study.findUnique({ where: { id: studyId } });
      if (!study) throw createHttpError(404, "Study not found");

      await ensureApprovedMember(studyId, req.authUser!);

      const sessions = await prisma.attendanceSession.findMany({
        where: { studyId },
        orderBy: { date: "desc" },
      });

      res.json(sessions);
    } catch (error) {
      next(error);
    }
  },
);

router.patch("/sessions/:sessionId", ...requireAuth, async (req, res, next) => {
  try {
    const sessionId = parseId(req.params.sessionId, "sessionId");
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { study: true },
    });
    if (!session) throw createHttpError(404, "Session not found");

    ensureLeaderOrAdmin(session.study, req.authUser!);

    const { title, date } = validateObject(
      {
        title: optionalString("title"),
        date: optionalString("date"),
      },
      req.body,
    );
    const data: Prisma.AttendanceSessionUpdateInput = {};
    if (title) data.title = title.trim();
    if (date) {
      const parsed = new Date(date);
      if (Number.isNaN(parsed.getTime())) throw createHttpError(400, "Invalid date");
      data.date = parsed;
    }

    const updated = await prisma.attendanceSession.update({
      where: { id: sessionId },
      data,
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/sessions/:sessionId/attendance",
  ...requireAuth,
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const session = await prisma.attendanceSession.findUnique({
        where: { id: sessionId },
        include: { study: true },
      });
      if (!session) throw createHttpError(404, "Session not found");

      ensureLeaderOrAdmin(session.study, req.authUser!);

      const payload = Array.isArray((req.body as { records?: unknown }).records)
        ? (req.body as { records: unknown }).records
        : req.body;

      const records = validateObject(
        {
          records: arrayOf(
            "records",
            (value) => {
              const { userId, status } = validateObject(
                {
                  userId: requiredNumber("userId", { min: 1 }),
                  status: requiredEnum("status", ["PRESENT", "LATE", "ABSENT"]),
                },
                value,
              );
              return { userId, status };
            },
            { minLength: 1 },
          ),
        },
        { records: payload },
      ).records;

      const userIds = Array.from(new Set(records.map((r) => r.userId)));
      const approvedMembers = await prisma.studyMember.findMany({
        where: {
          studyId: session.studyId,
          userId: { in: userIds },
          status: "APPROVED",
        },
        select: { userId: true },
      });

      if (approvedMembers.length !== userIds.length) {
        throw createHttpError(400, "All users must be approved members of the study");
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const record of records) {
          await tx.attendanceRecord.deleteMany({
            where: { sessionId, userId: record.userId },
          });
          await tx.attendanceRecord.create({
            data: {
              sessionId,
              userId: record.userId,
              status: record.status,
            },
          });
        }
      });

      const saved = await prisma.attendanceRecord.findMany({
        where: { sessionId },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      res.status(201).json({ sessionId, records: saved });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/sessions/:sessionId/attendance",
  ...requireAuth,
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const session = await prisma.attendanceSession.findUnique({
        where: { id: sessionId },
        include: { study: true },
      });
      if (!session) throw createHttpError(404, "Session not found");

      await ensureApprovedMember(session.studyId, req.authUser!);

      const records = await prisma.attendanceRecord.findMany({
        where: { sessionId },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      res.json({ sessionId, studyId: session.studyId, records });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/studies/:studyId/attendance/summary",
  ...requireAuth,
  async (req, res, next) => {
    try {
      const studyId = parseId(req.params.studyId, "studyId");
      const study = await prisma.study.findUnique({ where: { id: studyId } });
      if (!study) throw createHttpError(404, "Study not found");

      await ensureApprovedMember(studyId, req.authUser!);

      const totalSessions = await prisma.attendanceSession.count({
        where: { studyId },
      });

      const grouped = await prisma.attendanceRecord.groupBy({
        by: ["userId", "status"],
        _count: { _all: true },
        where: { session: { studyId } },
      });

      type GroupedRecord = (typeof grouped)[number];

      const userIds = Array.from(
        new Set(grouped.map((g: GroupedRecord) => g.userId)),
      );

      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      });

      const summary = users.map((user) => {
        const userStats = grouped.filter(
          (g: GroupedRecord) => g.userId === user.id,
        );
        const present =
          userStats.find((g: GroupedRecord) => g.status === "PRESENT")?._count
            ._all ?? 0;
        const late =
          userStats.find((g: GroupedRecord) => g.status === "LATE")?._count._all ??
          0;
        const absent =
          userStats.find((g: GroupedRecord) => g.status === "ABSENT")?._count._all ??
          0;
        const attended = present + late;
        const attendanceRate =
          totalSessions > 0 ? Number(((attended / totalSessions) * 100).toFixed(2)) : 0;

        return {
          user,
          present,
          late,
          absent,
          attendanceRate,
          totalSessions,
        };
      });

      res.json({ studyId, totalSessions, summary });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
