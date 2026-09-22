import Link from "next/link";

import { Button } from "@/components/ui/button";

function AuthAwareCta() {
    return (
        <Button size="lg" asChild>
            <Link href="/signup">Create your account</Link>
        </Button>
    );
}

export { AuthAwareCta };
