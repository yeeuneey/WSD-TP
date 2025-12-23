import { createHttpError } from "./http-error";

type Validator<T> = (value: unknown, key: string) => T;

export const validateObject = <
  TSchema extends Record<string, Validator<unknown>>,
>(
  schema: TSchema,
  payload: unknown,
  source: "body" | "query" = "body",
): { [K in keyof TSchema]: ReturnType<TSchema[K]> } => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw createHttpError(400, `${source} must be an object`);
  }

  const result = {} as {
    [K in keyof TSchema]: ReturnType<TSchema[K]>;
  };

  for (const key of Object.keys(schema) as Array<keyof TSchema>) {
    result[key] = schema[key](
      (payload as Record<string, unknown>)[key as string],
      key as string,
    ) as ReturnType<TSchema[typeof key]>;
  }

  return result;
};

export const requiredString = (
  field: string,
  { minLength = 1, maxLength }: { minLength?: number; maxLength?: number } = {},
): Validator<string> => {
  return (value) => {
    if (typeof value !== "string") {
      throw createHttpError(400, `${field} must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed.length < minLength) {
      throw createHttpError(400, `${field} is required`);
    }
    if (maxLength && trimmed.length > maxLength) {
      throw createHttpError(400, `${field} must be <= ${maxLength} characters`);
    }
    return trimmed;
  };
};

export const optionalString = (
  field: string,
  { maxLength }: { maxLength?: number } = {},
): Validator<string | undefined> => {
  return (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
      throw createHttpError(400, `${field} must be a string`);
    }
    const trimmed = value.trim();
    if (maxLength && trimmed.length > maxLength) {
      throw createHttpError(400, `${field} must be <= ${maxLength} characters`);
    }
    return trimmed;
  };
};

export const requiredNumber = (
  field: string,
  { min, max }: { min?: number; max?: number } = {},
): Validator<number> => {
  return (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw createHttpError(400, `${field} must be a number`);
    }
    if (min !== undefined && value < min) {
      throw createHttpError(400, `${field} must be >= ${min}`);
    }
    if (max !== undefined && value > max) {
      throw createHttpError(400, `${field} must be <= ${max}`);
    }
    return value;
  };
};

export const optionalNumber = (
  field: string,
  { min, max }: { min?: number; max?: number } = {},
): Validator<number | undefined> => {
  return (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw createHttpError(400, `${field} must be a number`);
    }
    if (min !== undefined && value < min) {
      throw createHttpError(400, `${field} must be >= ${min}`);
    }
    if (max !== undefined && value > max) {
      throw createHttpError(400, `${field} must be <= ${max}`);
    }
    return value;
  };
};

export const requiredEnum = <T extends string>(
  field: string,
  values: readonly T[],
): Validator<T> => {
  return (value) => {
    if (typeof value !== "string" || !values.includes(value as T)) {
      throw createHttpError(400, `${field} must be one of: ${values.join(", ")}`);
    }
    return value as T;
  };
};

export const optionalEnum = <T extends string>(
  field: string,
  values: readonly T[],
): Validator<T | undefined> => {
  return (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string" || !values.includes(value as T)) {
      throw createHttpError(400, `${field} must be one of: ${values.join(", ")}`);
    }
    return value as T;
  };
};

export const requiredDateString = (
  field: string,
): Validator<Date> => {
  return (value) => {
    if (typeof value !== "string") {
      throw createHttpError(400, `${field} must be an ISO date string`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw createHttpError(400, `${field} must be a valid date`);
    }
    return parsed;
  };
};

export const arrayOf = <T>(
  field: string,
  elementValidator: Validator<T>,
  { minLength = 0, maxLength }: { minLength?: number; maxLength?: number } = {},
): Validator<T[]> => {
  return (value) => {
    if (!Array.isArray(value)) {
      throw createHttpError(400, `${field} must be an array`);
    }
    if (value.length < minLength) {
      throw createHttpError(400, `${field} must contain at least ${minLength} item(s)`);
    }
    if (maxLength !== undefined && value.length > maxLength) {
      throw createHttpError(400, `${field} must contain <= ${maxLength} items`);
    }
    return value.map((item, idx) => elementValidator(item, `${field}[${idx}]`));
  };
};
