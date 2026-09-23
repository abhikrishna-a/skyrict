import { QueueListSkeleton } from "@/components/ui/page-skeletons";

/**
 * Route-level fallback for the Audit Guardian report list.
 *
 * CONTENT ONLY on purpose: `AgentsShell` already mounts the real chrome around
 * this segment, so the fallback stands in for the report list body only (three
 * card-shaped rows, matching the page's own loading state) instead of painting
 * a second rail or the agents-home hero shape over the live chrome.
 */
export default function GuardianLoading() {
    return <QueueListSkeleton />;
}
