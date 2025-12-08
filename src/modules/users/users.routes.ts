import { Router } from "express";
import { prisma } from "../../config/db";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (err) {
    next(err);
  }
});

export default router;