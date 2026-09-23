"use client";

import { useEffect, useMemo, useState } from "react";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from "@/components/ui/select";
import { countries } from "@/config/onboarding";

// flag-icons sprite rules - same package the onboarding org step uses; kept
// local to this component so the ~hundreds of sprite rules stay out of pages
// that never render a flag.
import "flag-icons/css/flag-icons.min.css";

const STORAGE_KEY = "skyrict:gmie:country";

const DEFAULT_COUNTRY = "US";

/**
 * Region scoping for market intelligence. Kept local to the GMIE world so the
 * research horizon (competitors, trends, niches) can be set per session without
 * touching workspace data. The trigger and options render a real country flag
 * (flag-icons) mirroring the onboarding organization step.
 */
export function IntelligenceCountrySelect() {
    const [country, setCountry] = useState<string>(DEFAULT_COUNTRY);

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        const known = stored
            ? countries.some((entry) => entry.code === stored)
            : false;
        setCountry(known ? (stored as string) : DEFAULT_COUNTRY);
    }, []);

    const selected = useMemo(
        () =>
            countries.find((entry) => entry.code === country) ??
            countries.find((entry) => entry.code === DEFAULT_COUNTRY) ??
            null,
        [country],
    );

    const change = (value: string) => {
        setCountry(value);
        localStorage.setItem(STORAGE_KEY, value);
    };

    return (
        <Select value={country} onValueChange={change}>
            <SelectTrigger
                size="sm"
                aria-label="Market country"
                title="Market country"
                className="h-9 rounded-full border-border bg-transparent px-3"
            >
                <span className="flex items-center gap-1.5">
                    {selected ? (
                        <span
                            className={`fi fi-${selected.code.toLowerCase()}`}
                            aria-hidden="true"
                        />
                    ) : null}
                    <span className="text-sm font-medium text-foreground">
                        {selected?.name ?? "United States"}
                    </span>
                </span>
            </SelectTrigger>
            <SelectContent
                position="popper"
                align="end"
                className="max-h-72 min-w-56"
            >
                {countries.map((entry) => (
                    <SelectItem key={entry.code} value={entry.code}>
                        <span className="flex items-center gap-1.5">
                            <span
                                className={`fi fi-${entry.code.toLowerCase()}`}
                                aria-hidden="true"
                            />
                            <span>
                                {entry.code} · {entry.name}
                            </span>
                        </span>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}