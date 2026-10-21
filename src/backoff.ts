export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const calculateBackoff = (attempt: number) =>
  1000 * 2 ** (attempt - 1);
