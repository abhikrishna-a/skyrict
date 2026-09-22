import { BarChart3 } from "lucide-react";

import { PageHeader } from "@/components/dashboard/shared/page-header";
import { RequirePermission } from "@/components/dashboard/shared/require-permission";
import { ReportKpis } from "@/features/reports/components/report-kpis";
import { ReportsWorkspace } from "@/features/reports/reports-workspace";

export default function ErpReportsPage() {
    return (
        <RequirePermission permission="erp.reports.read">
            <div className="space-y-6">
                <PageHeader
                    title="Reports"
                    description="Cross-department dashboards and exports for your business."
                    icon={BarChart3}
                />
                <ReportKpis />
                <ReportsWorkspace />
            </div>
        </RequirePermission>
    );
}
