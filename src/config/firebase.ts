import admin from "firebase-admin";
import { env } from "./env";

const app =
  admin.apps.length === 0
    ? admin.initializeApp({
        credential: admin.credential.cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: env.FIREBASE_PRIVATE_KEY,
        }),
      })
    : admin.app();

export const firebaseAuth = app.auth();
