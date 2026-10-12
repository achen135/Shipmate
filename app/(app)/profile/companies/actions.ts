"use server";

import { revalidatePath } from "next/cache";

import { requireMember } from "@/lib/auth/viewer";
import {
  type FollowResult,
  followByLink,
  followCompany,
  setFollowPriority,
  unfollowCompany,
} from "@/lib/follows/write";

/**
 * Companies actions. Each re-checks the session, then writes as the user
 * (lib/follows/write.ts), so RLS and the follow functions' own checks apply.
 */

const PATH = "/profile/companies";

async function refreshed(result: FollowResult): Promise<FollowResult> {
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function followByCareersLink(values: unknown) {
  await requireMember();
  return refreshed(await followByLink(values));
}

export async function followExistingCompany(companyId: string) {
  await requireMember();
  return refreshed(await followCompany(companyId));
}

export async function setPriority(companyId: string, priority: boolean) {
  await requireMember();
  return refreshed(await setFollowPriority(companyId, priority));
}

export async function unfollow(companyId: string) {
  await requireMember();
  return refreshed(await unfollowCompany(companyId));
}
