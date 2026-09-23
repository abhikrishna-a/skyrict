import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level fallback for the Audit Guardian report list.
 *
 * CONTENT ONLY on purpose: `AgentsShell` already mounts the real chrome around
 * this segment, so the fallback stands in for the report list body only (three
 * card-shaped rows, matching the page's own loading state) instead of painting
 * a second rail or the agents-home hero shape over the live chrome.
 */
export default function GuardianLoading() {
    return (
        <div className="flex h-full flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
                <div className="mx-auto max-w-3xl space-y-4">
                    <div className="space-y-3" aria-hidden="true">
                        {[0, 1, 2].map((row) => (
                            <Skeleton
                                key={row}
                                className="h-32 w-full rounded-xl"
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}