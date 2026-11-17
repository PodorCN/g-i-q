# Instructions for agents maintaining g-i-q

Read [AGENT.MD](AGENT.MD) **before changing this dashboard**. It contains the product contract, research rules, architecture, maintenance procedures, deployment steps and regression checks. Do not rely on chat history or temporary scripts from another session.

The user's latest explicit instructions take precedence. This file records accepted behavior; it neither grants new production authorization nor creates an extra approval requirement. Continue work already authorized in the task without repeatedly asking for confirmation.

## Rules to keep in working context

1. This is a U.S. institutional-view dashboard. Each broker point needs attributable, dated evidence for **both** growth and inflation. Keep the actual research team's identity and forecast horizon.
2. Production axes are **levels**: real GDP growth minus an assumed 2% trend; core PCE inflation minus the 2% target. Do not mix supporting BLS momentum scores into these coordinates.
3. **Interpretive ranges are allowed.** Clip each ellipse to its central quadrant plus only the specific alternative quadrants explicitly supported by the report. Do not remove all ranges, and do not let generic uncertainty authorize crossings.
4. Use `constrainedRange` in `shared/quadrants.ts`. Preserve the ellipse center and raw radii; the exact union of allowed quadrants must exclude every unsupported quadrant. Marginal bounds are not a replacement ellipse or a permitted rectangle.
5. Ranges are **interpretations, not statistical confidence intervals or quadrant probabilities**. Hard-data sensitivity is a separate assumption.
6. An arrow requires the house's own verified, comparable, two-axis forward guidance. Never originate it at the hard-data anchor, infer a missing axis as zero movement, or turn a conditional risk into a baseline trajectory.
7. The default map selects no point and shows all visible brokers' ranges. Clicking a selected broker again returns to this comparison state; selecting a broker focuses its range. Preserve mouse, keyboard, touch and `?point=all` reload behavior.
8. Fit chart domains to visible clipped ranges, the full data range and valid guidance endpoints. Never move research points to make the chart attractive. Visibility toggles must not change the axis domain.
9. Routine research updates write new D1 snapshots; they do **not** need a frontend deployment. Frontend, Worker, local JSON and production D1 are distinct artifacts.
10. Keep snapshot IDs immutable, source dates honest, failures visible, production secrets private and fictional demo data out of production.
11. The maintained Cloudflare app uses GitHub branch `main`. Do not assume the repository's default branch is the deployed app, overwrite unrelated work or modify the user's separate Claude branch without a task requiring it.
12. Verify behavior before claiming completion. A successful push is not proof of deployment; a successful deployment is not proof the correct snapshot is live.

Start with the handbook's **First steps** section. Consult [methodology](docs/methodology.md), [design](docs/design.md) and [deployment](docs/deployment.md) for details. Historical audit files document past decisions; they do not override the current user-approved contract.
