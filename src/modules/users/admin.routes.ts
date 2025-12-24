import { Router } from "express";
import { prisma } from "../../config/db";
import { authenticate } from "../../middlewares/auth";
import { requireAdmin } from "../../middlewares/rbac";
import { createError } from "../../utils/errors";
import { sanitizeUser } from "../auth/auth.service";
import { parsePagination, parseSortParam } from "../../utils/pagination";

const router = Router();

router.use(authenticate, requireAdmin);

router.get("/", async (req, res, next) => {
  try {
    const keyword = (req.query.q ?? req.query.keyword) as string | undefined;
    const pagination = parsePagination({
      page: typeof req.query.page === "string" ? req.query.page : undefined,
      size: typeof req.query.size === "string" ? req.query.size : undefined,
    });
    const { orderBy, sortString } = parseSortParam(
      typeof req.query.sort === "string" ? req.query.sort : undefined,
      ["createdAt", "email", "name", "status", "role"],
      "createdAt",
    );
    const where: Record<string, unknown> = {};
    if (keyword) {
      const value = String(keyword);
      where.OR = [
        { email: { contains: value, mode: "insensitive" } },
        { name: { contains: value, mode: "insensitive" } },
      ];
    }

    const [total, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy,
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    res.json({
      content: users.map(sanitizeUser),
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

router.patch("/:id/role", async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const { role } = req.body;

    if (!role || !["USER", "ADMIN"].includes(role)) {
      throw createError("role must be USER or ADMIN", {
        statusCode: 400,
        code: "INVALID_ROLE",
      });
    }

    if (Number.isNaN(userId)) {
      throw createError("Invalid user id", {
        statusCode: 400,
        code: "INVALID_USER_ID",
      });
    }

    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw createError("User not found", {
        statusCode: 404,
        code: "USER_NOT_FOUND",
      });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role },
    });

    res.json({ user: sanitizeUser(updated) });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/deactivate", async (req, res, next) => {
  try {
    const userId = Number(req.params.id);

    if (Number.isNaN(userId)) {
      throw createError("Invalid user id", {
        statusCode: 400,
        code: "INVALID_USER_ID",
      });
    }

    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw createError("User not found", {
        statusCode: 404,
        code: "USER_NOT_FOUND",
      });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { status: "INACTIVE" },
    });

    res.json({ user: sanitizeUser(updated) });
  } catch (error) {
    next(error);
  }
});

export default router;
