"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Contact,
  FileText,
  Inbox,
  Package,
  Receipt,
  ShoppingCart,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { hasPermission, useModuleAccess } from "@/lib/access/modules";

export type ModuleQuickLink = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /**
   * Module read key required to see the link, or undefined for always-visible
   * hubs. The Approvals inbox aggregates tasks across modules and is gated by
   * the shell's module check alone (same rule as the route map), so it has no
   * key of its own.
   */
  permission?: string;
};

const quickLinks: ModuleQuickLink[] = [
  {
    href: "/erp/crm/overview",
    title: "CRM",
    description: "Leads, pipelines, and customers.",
    icon: Contact,
    permission: "erp.crm.read",
  },
  {
    href: "/erp/orders",
    title: "Orders",
    description: "Sales orders and the fulfilment flow.",
    icon: ShoppingCart,
    permission: "erp.sales.read",
  },
  {
    href: "/erp/inventory",
    title: "Inventory",
    description: "Stock and warehouses.",
    icon: Package,
    permission: "erp.inventory.read",
  },
  {
    href: "/erp/finance",
    title: "Finance",
    description: "Cash flow and ledgers.",
    icon: Wallet,
    permission: "erp.finance.read",
  },
  {
    href: "/erp/hr",
    title: "HR",
    description: "People and the team.",
    icon: Users,
    permission: "erp.hr.read",
  },
  {
    href: "/erp/documents",
    title: "Documents",
    description: "Central document store with AI extraction.",
    icon: FileText,
    permission: "erp.documents.read",
  },
  {
    href: "/erp/payroll",
    title: "Payroll",
    description: "Runs, compensation, and pay rules.",
    icon: Receipt,
    permission: "erp.payroll.read",
  },
  {
    href: "/erp/approvals",
    title: "Approvals",
    description: "AI-routed approvals inbox.",
    icon: Inbox,
  },
  {
    href: "/erp/reports",
    title: "Reports",
    description: "Dashboards and exports.",
    icon: BarChart3,
    permission: "erp.reports.read",
  },
];

/**
 * Quick links the user may actually open. Links carry their module's read key
 * (each target route is gated by the same key in the route map); the wildcard
 * keeps everything. Pure so the gate is unit-testable without a render.
 */
export function filterQuickLinksByPermissions(
  links: ModuleQuickLink[],
  grantedPermissions: string[],
): ModuleQuickLink[] {
  return links.filter(
    (link) => !link.permission || hasPermission(grantedPermissions, link.permission),
  );
}

/** Module quick-link cards rendered on the ERP overview page. */
export function ModuleQuickLinks() {
  const { status, permissions } = useModuleAccess();

  // Fail closed while access is resolving and for a fully-denied world.
  if (status !== "ready") return null;
  const visible = filterQuickLinksByPermissions(quickLinks, permissions);
  if (visible.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="group relative flex flex-col rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/40 active:translate-y-0"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
            <link.icon aria-hidden="true" className="size-5" />
          </div>
          <h3 className="mt-4 font-display text-base font-semibold text-foreground">
            {link.title}
          </h3>
          <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">
            {link.description}
          </p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
            Open
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </span>
        </Link>
      ))}
    </div>
  );
}