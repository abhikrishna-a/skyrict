interface SignalSparklineProps {
    label: string;
    points?: number[];
}

function SignalSparkline({
    label,
    points = [34, 38, 36, 42, 48, 52, 58, 66],
}: SignalSparklineProps) {
    const width = 240;
    const height = 64;
    const pad = 8;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const step = (width - pad * 2) / (points.length - 1);

    const coords = points.map((value, index) => ({
        x: pad + index * step,
        y: height - pad - ((value - min) / range) * (height - pad * 2),
    }));

    const line = coords.map((point) => `${point.x} ${point.y}`).join(" L");
    const last = coords[coords.length - 1];
    const area = `M ${coords[0].x} ${height} L ${line} L ${last.x} ${height} Z`;

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={label}
            className="h-14 w-full"
        >
            <path
                d={`M ${line}`}
                fill="none"
                stroke="#4cb6e1"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path d={area} fill="rgba(76, 182, 225, 0.1)" />
            <circle cx={last.x} cy={last.y} r="4" fill="#4cb6e1" />
        </svg>
    );
}

export { SignalSparkline };