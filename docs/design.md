# Interface design

The task is to compare named institutional macro views with the data, then inspect one view's source and horizon. The interface supports reading and comparison; it is not a monitoring console.

## Information hierarchy

- **Map:** the scatter plot and one selected-point inspector. No repeated summary cards, evidence feed or institution table below it.
- **House views:** the complete comparison table, a horizon filter, institution search, and links back to individual points.
- **Data:** the three published GDP/PCE anchors, their periods, and an explanation of the data point. Supporting labor/CPI indicators and raw histories expand on demand.
- **Sources:** searchable articles and official releases. Collection status and detailed failure messages live in a coverage disclosure.
- **Methodology:** a focused reading page linked from the plot, inspector and footer. Definitions and range limitations remain available without filling the main workspace.

The plot opens with no point selected and all recent house ranges visible. Selecting a point focuses its range; activating the selected point again clears the selection and shows all ranges. The same toggle works with keyboard activation and the mobile house buttons. The institution picker also offers All brokers, and the URL preserves selection across reloads (`?point=all` is also accepted). If filtering or a different snapshot removes a selected point, return to comparison. Display allows all ranges or none. Axis domains always include every visible, quadrant-constrained range, regardless of visibility, so the setting does not move the points. Direct forecasts and inferred coordinates remain labeled. Current and forward-looking views remain explicit, with actual author horizons in the inspector and table.

Forward-guidance arrows use only an institution’s own explicitly published earlier and later real-GDP/core-PCE forecasts. A point labeled forward-looking does not qualify by itself. Missing axes stay unknown; a one-axis or qualitative statement stays in the inspector without an invented trajectory. One endpoint coincides with the house dot; a small square marks its other dated endpoint. Both coordinates and the period labels come from the same report. The hard-data point never starts a house arrow. Display supports focused, all, or hidden guidance, and keyboard activation selects the corresponding house. The inspector shows published rates, periods, and source quotations.

Institution ranges are interpreted ellipses clipped to the central quadrant and explicitly sourced alternatives. Their center and raw radii are preserved; clipping can leave a flat edge at a benchmark. Even multiple authorized alternatives must not fill an unsupported fourth quadrant. A hollow dot indicates an explicitly sourced alternative quadrant, with its evidence in the inspector; it does not encode confidence or probability. Filled dots can still have within-quadrant ranges. Hard data retains its separately labeled sensitivity ellipse.

## Visual system

Use self-hosted Manrope, restrained green-gray neutrals, a white plotting surface and soft quadrant colors. The chart carries the color; ordinary controls stay quiet. One border defines the plot/inspector workspace. Avoid nested cards, repeated metric strips, decorative icons and colored status dashboards.

The top-left wordmark spells out **Growth Inflation Quadrant**, paired with a small quadrant/ellipse symbol. Use the same full name in the browser title and accessible home label.

Core tokens: ink `#25372E`, secondary text `#647066`, accent `#315B47`, background `#F7F8F5`, content `#FFFFFF`, border `#DFE5DD`. Body text is 14px; large headings are 28px on desktop and 23px on mobile. Numerals use tabular spacing. Focus states are visible and motion respects reduced-motion preferences.

## Responsive behavior

The app fills the dynamic viewport height. The chart measures its available width and height and adapts its SVG geometry; it must remain visible on short screens rather than being cropped to suppress scrolling. The desktop inspector scrolls within the workspace. At tablet and phone widths it becomes an overlay with a close button; the horizontal house-button strip sits outside the overlay so selecting the same broker again still works. The chart key expands in a popover on phones and short landscape screens. All labels can still be enabled in Display. Evidence, long reading pages and comparison tables scroll within their own containers, never the document. Secondary detail remains collapsed until requested.

## Skills used

- [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md): a coherent visual direction with intentional typography, spacing and restrained decoration.
- [Impeccable](https://github.com/pbakaus/impeccable/blob/main/plugin/skills/impeccable/SKILL.md), specifically [distill](https://github.com/pbakaus/impeccable/blob/main/plugin/skills/impeccable/reference/distill.md): remove repetition, use progressive disclosure, retain important functionality.
- [Impeccable clarify](https://github.com/pbakaus/impeccable/blob/main/plugin/skills/impeccable/reference/clarify.md): distinguish horizons, sources and inferred values in plain interface language.
- [Vercel Web Design Guidelines](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md): keyboard operation, focus, semantic controls, contrast, responsive overflow, loading/error states and shareable filter state.

This is a simplification of the existing research application. The public-source dataset, mapping methodology, API and daily backend schedule remain the existing product contract.
