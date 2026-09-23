

import { PageHeader } from "@/components/dashboard/shared/page-header";
import { AiGlyph } from "@/components/brand/logo";
import { RequirePermission } from "@/components/dashboard/shared/require-permission";
import { CrmAiPanel } from "./crm-ai-panel";

export default function CrmAiPage() {
    return (
        <RequirePermission permission={["erp.ai.invoke", "erp.crm.read"]}>
            <div className="space-y-6">
                <PageHeader
                    title="AI Insights"
                    description="Pipeline anomaly detection, lead scores, deal health, and AI-generated follow-up suggestions."
                    icon={AiGlyph}
                />
                <CrmAiPanel />
            </div>
        </RequirePermission>
    );
}
