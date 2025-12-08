import dotenv from "dotenv";

dotenv.config();

const requiredVars = {
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: process.env.REDIS_PORT,
} as const;

for (const [key, value] of Object.entries(requiredVars)) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const parseNumber = (value: string, key: string): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
};

export const env = {
  PORT:
    process.env.PORT && !Number.isNaN(Number(process.env.PORT))
      ? Number(process.env.PORT)
      : 8080,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  DATABASE_URL: requiredVars.DATABASE_URL!,
  REDIS_HOST: requiredVars.REDIS_HOST!,
  REDIS_PORT: parseNumber(requiredVars.REDIS_PORT!, "REDIS_PORT"),
  JWT_ACCESS_SECRET: requiredVars.JWT_ACCESS_SECRET!,
  JWT_REFRESH_SECRET: requiredVars.JWT_REFRESH_SECRET!,
};
