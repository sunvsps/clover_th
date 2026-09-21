import { get, isApiError, post } from "./client";

/**
 * LOCAL DEMO login. The backend offers these two routes only when it runs with LOCAL_DEMO_ENABLED=true (and only to
 * this machine); otherwise they are a plain 404 and the UI shows nothing.
 */
export type DemoMember = { memberId: string; discordId: string; ign: string; nickname: string | null; isAdmin: boolean };

/** The members to choose from, or `null` when the demo login is not available (404, or any other answer). */
export async function getDemoMembers(): Promise<DemoMember[] | null> {
  try {
    return await get<DemoMember[]>("/api/v1/demo/members");
  } catch (err) {
    if (isApiError(err)) return null;
    throw err;
  }
}

export const demoLogin = (discordId: string) => post<void>("/api/v1/demo/login", { discordId });
