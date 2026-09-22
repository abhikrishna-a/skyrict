import { RequirePermission } from "@/components/dashboard/shared/require-permission";
import { ReportsDetail } from "@/features/reports/report-detail";

interface ReportDetailPageProps {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportDetailPage({
  params,
  searchParams,
}: ReportDetailPageProps) {
  const { reportId } = await params;
  const query = await searchParams;

  const initialParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") initialParams[key] = value;
  }

  return (
    <RequirePermission permission="erp.reports.read">
      <ReportsDetail slug={reportId} initialParams={initialParams} />
    </RequirePermission>
  );
}
