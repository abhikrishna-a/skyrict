import type { DocSection } from "@/content/docs";
import { cn } from "@/lib/utils";

function Toc({
    sections,
    className,
}: {
    sections: DocSection[];
    className?: string;
}) {
    if (sections.length === 0) return null;
    return (
        <aside aria-label="On this page" className={className}>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                On this page
            </p>
            <ul className="mt-3 space-y-1 border-l border-border">
                {sections.map((section) => (
                    <li key={section.id}>
                        <a
                            href={`#${section.id}`}
                            className={cn(
                                "-ml-px block border-l border-transparent py-1 pl-3 text-[13px] leading-snug text-muted-foreground transition-colors",
                                "hover:border-primary/50 hover:text-foreground",
                                "focus-visible:ring-2 focus-visible:ring-ring/50 outline-none",
                            )}
                        >
                            {section.title}
                        </a>
                    </li>
                ))}
            </ul>
        </aside>
    );
}

export { Toc };