# Interface design

The task is to compare named institutional macro views with the data, then inspect one view's source and horizon. The interface supports reading and comparison; it is not a monitoring console.

## Information hierarchy

- **Map:** the scatter plot and one selected-point inspector. No repeated summary cards, evidence feed or institution table below it.
- **House views:** the complete comparison table, a horizon filter, institution search, and links back to individual points.
- **Data:** the three published GDP/PCE anchors, their periods, and an explanation of the data point. Supporting labor/CPI indicators and raw histories expand on demand.
- **Sources:** searchable articles and official releases. Collection status and detailed failure messages live in a coverage disclosure.
- **Methodology:** a focused reading page linked from the plot, inspector and footer. Definitions and range limitations remain available without filling the main workspace.

The plot shows all recent house views by default. Only the selected point's range is drawn; Display allows all ranges or none. Axis domains always include every full range, regardless of visibility, so the setting does not move the points. Direct forecasts and inferred coordinates remain labeled. Current and forward-looking views remain explicit, with actual author horizons in the inspector and table.

Source-supported outlook arrows sit inside institution labels as small direction glyphs; they do not draw numerical destinations across the chart. Display can hide them. Hollow institution dots identify mappings spanning quadrants even when ranges are hidden. The selected inspector names the overlapping quadrants and separates mapping uncertainty from the author's view. Direction horizons and supporting excerpts stay with that point's details.

## Visual system

Use self-hosted Manrope, restrained green-gray neutrals, a white plotting surface and soft quadrant colors. The chart carries the color; ordinary controls stay quiet. One border defines the plot/inspector workspace. Avoid nested cards, repeated metric strips, decorative icons and colored status dashboards.

Core tokens: ink `#25372E`, secondary text `#647066`, accent `#315B47`, background `#F7F8F5`, content `#FFFFFF`, border `#DFE5DD`. Body text is 14px; large headings are 28px on desktop and 23px on mobile. Numerals use tabular spacing. Focus states are visible and motion respects reduced-motion preferences.

## Responsive behavior

At tablet widths the inspector moves below the chart. On phones the chart gains vertical space and wider axis margins; the selected label stays visible, and compact institution buttons make every point easy to select. All labels can still be enabled in Display. Tables scroll within their own container, never the page. Secondary detail remains collapsed until requested.

## Skills used

- [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md): a coherent visual direction with intentional typography, spacing and restrained decoration.
- [Impeccable](https://github.com/pbakaus/impeccable/blob/main/plugin/skills/impeccable/SKILL.md), specifically [distill](https://github.com/pbakaus/impeccable/blob/main/plugin/skills/impeccable/reference/distill.md): remove repetition, use progressive disclosure, retain important functionality.
- [Impeccable clarify](https://github.com/pbakaus/impeccable/blob/main/plugin/skills/impeccable/reference/clarify.md): distinguish horizons, sources and inferred values in plain interface language.
- [Vercel Web Design Guidelines](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md): keyboard operation, focus, semantic controls, contrast, responsive overflow, loading/error states and shareable filter state.

This is a simplification of the existing research application. The public-source dataset, mapping methodology, API and daily backend schedule remain the existing product contract.
