import { Router } from "express";
import userRoutes from "../modules/users/users.routes";
import authRoutes from "../modules/auth/auth.routes";
import adminUserRoutes from "../modules/users/admin.routes";
import adminRoutes from "../modules/admin/admin.routes";
import studyRoutes from "../modules/studies/studies.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/admin/users", adminUserRoutes);
router.use("/admin", adminRoutes);
router.use("/studies", studyRoutes);

export default router;
