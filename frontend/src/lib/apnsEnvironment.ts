export type ApnsEnvironment = "sandbox" | "production";

export function resolveApnsEnvironment(input: {
  configured?: string | null;
  signed?: string | null;
  isDevelopment: boolean;
}): ApnsEnvironment {
  if (input.configured === "sandbox" || input.configured === "production") {
    return input.configured;
  }
  if (input.signed === "sandbox" || input.signed === "production") {
    return input.signed;
  }
  return input.isDevelopment ? "sandbox" : "production";
}
