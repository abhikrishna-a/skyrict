"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { navLinks } from "@/config";
import { cn } from "@/lib/utils";

function Header() {
    const [scrolled, setScrolled] = useState(false);
    const [open, setOpen] = useState(false);
    const pathname = usePathname();

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 8);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    const isActive = (href: string) =>
        href === "/"
            ? pathname === "/"
            : pathname === href || pathname.startsWith(`${href}/`);

    return (
        <header
            className={cn(
                "sticky top-0 z-50 border-b transition-colors",
                scrolled || open
                    ? "border-border/70 bg-card/85 backdrop-blur-md"
                    : "border-transparent bg-transparent",
            )}
        >
            <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
                <Link href="/" aria-label="Skyrict home">
                    <Logo className="text-foreground" />
                </Link>
                <nav
                    className="hidden items-center gap-1 md:flex"
                    aria-label="Primary"
                >
                    {navLinks.map((link) => {
                        const active = isActive(link.href);
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                aria-current={
                                    active ? "page" : undefined
                                }
                                className={cn(
                                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                    active
                                        ? "bg-muted/60 text-foreground"
                                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                                )}
                            >
                                {link.label}
                            </Link>
                        );
                    })}
                </nav>
                <div className="hidden items-center gap-2 md:flex">
                    <Button asChild>
                        <Link href="/register">Sign Up</Link>
                    </Button>
                </div>
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                    aria-label={open ? "Close menu" : "Open menu"}
                    className="flex size-9 items-center justify-center rounded-md text-foreground md:hidden"
                >
                    {open ? (
                        <X aria-hidden="true" className="size-5" />
                    ) : (
                        <Menu aria-hidden="true" className="size-5" />
                    )}
                </button>
            </div>
            {open ? (
                <div className="border-t border-border/70 bg-card/95 px-6 py-4 backdrop-blur-md md:hidden">
                    <nav className="flex flex-col gap-1" aria-label="Mobile">
                        {navLinks.map((link) => {
                            const active = isActive(link.href);
                            return (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => setOpen(false)}
                                    aria-current={
                                        active ? "page" : undefined
                                    }
                                    className={cn(
                                        "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                        active
                                            ? "bg-muted/60 text-foreground"
                                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                                    )}
                                >
                                    {link.label}
                                </Link>
                            );
                        })}
                    </nav>
                    <div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3">
                        <Button asChild>
                            <Link
                                href="/register"
                                onClick={() => setOpen(false)}
                            >
                                Sign Up
                            </Link>
                        </Button>
                    </div>
                </div>
            ) : null}
        </header>
    );
}

export { Header };
