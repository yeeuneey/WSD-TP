export type HttpError = Error & { statusCode?: number };

export const createHttpError = (
  statusCode: number,
  message: string,
): HttpError => {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
};
