/** Fit every point and range endpoint, while keeping all four quadrants visible. */
export function fitAxis(values: number[]) {
  const finite = values.filter(Number.isFinite);
  const low = Math.min(-0.25, ...finite);
  const high = Math.max(0.25, ...finite);
  const padding = Math.max(0.2, (high - low) * 0.12);
  const targetStep = (high - low + 2 * padding) / 6;
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const fraction = targetStep / magnitude;
  const step = (fraction >= 7.5 ? 10 : fraction >= 3.5 ? 5 : fraction >= 1.5 ? 2 : 1) * magnitude;
  const first = Math.floor((low - padding) / step);
  const last = Math.ceil((high + padding) / step);
  const ticks = Array.from({ length: last - first + 1 }, (_, i) =>
    Number(((first + i) * step).toPrecision(12)),
  );
  return { min: ticks[0], max: ticks.at(-1)!, ticks };
}
