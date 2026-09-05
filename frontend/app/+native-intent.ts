import { redirectSystemPath as resolve } from "@/src/lib/deepLinkContract";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return resolve(path);
}
