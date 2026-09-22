import { AgentsHomeSkeleton } from "@/components/ui/page-skeletons";

/**
 * Route-level fallback for the AI Agents world.
 *
 * CONTENT ONLY on purpose: `ShellRouter` already mounts `AgentsShell` (real
 * conversation rail + chrome) around this segment, so a "world" skeleton here
 * paints a second rail over the live chrome. That double chrome is what read
 * as a bug on entry - the fallback must only stand in for the page body.
 *
 * Without this boundary, `/dashboard/loading.tsx` (the workspace Overview
 * skeleton) was the nearest fallback for `/dashboard/agents/**`, so the
 * workspace overview shimmer leaked into the agents world on cache-miss
 * navigations.
 */
export default function AgentsLoading() {
    return <AgentsHomeSkeleton />;
}