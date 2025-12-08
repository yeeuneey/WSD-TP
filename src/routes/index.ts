import { Router } from "express";
import userRoutes from "../modules/users/users.routes";

const router = Router();

router.use("/users", userRoutes);

export default router;