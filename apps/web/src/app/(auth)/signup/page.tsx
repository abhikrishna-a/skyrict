import type { Metadata } from "next";

import { AccountStep } from "@/features/onboarding/account-step";

export const metadata: Metadata = {
    title: "Try Skyrict for free",
    description: "Enter your work email to start.",
};

export default async function RegisterPage({
    searchParams,
}: {
    searchParams: Promise<{ demoCaptcha?: string }>;
}) {
    const params = await searchParams;

    return (
        <div className="space-y-6 text-center">
            <h1 className="font-display text-2xl font-semibold text-foreground">
                Try Skyrict for free
            </h1>

            <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted-foreground">
                Please use your work email address so we can connect you with
                your team in Skyrict.
            </p>

            <AccountStep demoCaptcha={params.demoCaptcha === "1"} />
        </div>
    );
}
