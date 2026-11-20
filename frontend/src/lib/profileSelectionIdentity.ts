/** Initial auth hydration is not an account switch; confirmed sign-out is. */
export function profileSelectionMustReset(
  previousUserId: string | null | undefined,
  currentUserId: string | null,
  authState: "loading" | "authenticated" | "unauthenticated",
): boolean {
  if (authState === "loading") return false;
  if (authState === "unauthenticated") return true;
  return Boolean(previousUserId && currentUserId && previousUserId !== currentUserId);
}
