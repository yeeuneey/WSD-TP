import admin from "firebase-admin";
import { env } from "./env";

let firebaseApp: admin.app.App | null = null;

const getFirebaseCredentials = (): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} => {
  const missing = [
    ["FIREBASE_PROJECT_ID", env.FIREBASE_PROJECT_ID],
    ["FIREBASE_CLIENT_EMAIL", env.FIREBASE_CLIENT_EMAIL],
    ["FIREBASE_PRIVATE_KEY", env.FIREBASE_PRIVATE_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Missing Firebase environment variables: ${missing.join(", ")}`);
  }

  return {
    projectId: env.FIREBASE_PROJECT_ID!,
    clientEmail: env.FIREBASE_CLIENT_EMAIL!,
    privateKey: env.FIREBASE_PRIVATE_KEY!,
  };
};

const getFirebaseApp = (): admin.app.App => {
  if (firebaseApp) {
    return firebaseApp;
  }

  const credentials = getFirebaseCredentials();
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: credentials.projectId,
      clientEmail: credentials.clientEmail,
      privateKey: credentials.privateKey,
    }),
  });

  return firebaseApp;
};

export const getFirebaseAuth = (): admin.auth.Auth => {
  return getFirebaseApp().auth();
};
