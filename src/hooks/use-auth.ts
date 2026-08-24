import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";

/**
 * Current auth state plus the sign-in/sign-out actions.
 *
 * `isLoading` is derived rather than stored in state. The previous version kept
 * it in `useState` and flipped it to `false` once, which meant it never went
 * back to `true` — after a sign-out or a reconnect, consumers briefly rendered
 * a signed-out UI while the user document was still in flight.
 */
export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.currentUser);
  const { signIn, signOut } = useAuthActions();

  return {
    // `user` is `undefined` only while the query is in flight; it resolves to
    // `null` when nobody is signed in.
    isLoading: isAuthLoading || user === undefined,
    isAuthenticated,
    user,
    signIn,
    signOut,
  };
}
