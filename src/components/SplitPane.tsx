import { useRef, type PointerEvent, type ReactNode } from "react";

type Props = {
  ratio: number;
  stacked: boolean;
  ariaLabel: string;
  onRatio: (ratio: number) => void;
  /** both | hide second | hide first */
  layout?: "both" | "source" | "table";
  children: ReactNode[];
};

export function SplitPane({
  ratio,
  stacked,
  ariaLabel,
  onRatio,
  layout = "both",
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = (event: PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const next = stacked
      ? (event.clientY - box.top) / box.height
      : (event.clientX - box.left) / box.width;
    onRatio(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    update(event);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    update(event);
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  const solo = layout !== "both";
  // minmax(0, Nfr) — bare `Nfr` is minmax(auto, Nfr) and will not shrink below
  // the pane's min-content width, which locks the split on window resize.
  const first = `minmax(0, ${ratio}fr)`;
  const second = `minmax(0, ${1 - ratio}fr)`;
  const style = solo
    ? undefined
    : stacked
      ? { gridTemplateRows: `${first} var(--split-gap) ${second}`, gridTemplateColumns: "minmax(0, 1fr)" }
      : { gridTemplateColumns: `${first} var(--split-gap) ${second}`, gridTemplateRows: "minmax(0, 1fr)" };

  return (
    <div
      ref={ref}
      className={[stacked ? "split stacked" : "split wide", solo ? "solo" : ""]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      <section className={layout === "table" ? "split-pane is-hidden" : "split-pane"}>
        {children[0]}
      </section>
      {layout === "both" ? (
        <div
          className="split-handle"
          role="separator"
          aria-label={ariaLabel}
          aria-orientation={stacked ? "horizontal" : "vertical"}
          aria-valuemin={22}
          aria-valuemax={78}
          aria-valuenow={Math.round(ratio * 100)}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.08 : 0.03;
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              onRatio(ratio - step);
            }
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              onRatio(ratio + step);
            }
          }}
        />
      ) : null}
      <section className={layout === "source" ? "split-pane is-hidden" : "split-pane"}>
        {children[1]}
      </section>
    </div>
  );
}
