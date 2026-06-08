import type { LogEntry } from "../api";

interface Props {
    entries: LogEntry[];
}

const LEVEL_CLASS: Record<string, string> = {
    ERROR:   "text-danger",
    WARNING: "text-warn",
    INFO:    "text-ink-4",
};

export default function LogViewer({ entries }: Props) {
    if (entries.length === 0) {
        return <div className="text-[12px] text-ink-3 py-2">Sin entradas de log.</div>;
    }

    return (
        <div className="max-h-[280px] overflow-y-auto font-mono text-[11px]">
            {entries.map((e, i) => (
                <div
                    key={i}
                    className="flex gap-2.5 py-1.5 border-b border-dashed border-line last:border-b-0 items-baseline"
                >
                    <span className="text-ink-4 shrink-0">{e.ts.split("T")[1]}</span>
                    <span className={`shrink-0 w-[56px] font-semibold ${LEVEL_CLASS[e.level] ?? "text-ink-3"}`}>
                        {e.level}
                    </span>
                    <span className="text-ink-2 break-all">{e.msg}</span>
                </div>
            ))}
        </div>
    );
}
