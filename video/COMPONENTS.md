# Component decisions

Catalog reviewed: 2026-08-03 from `https://remocn.dev/llms-components.txt`.

| Scene | Role | Component | Docs | Decision | Content source |
|---|---|---|---|---|---|
| Hook | Presentation | Custom | None | Custom type lockup keeps the security tone quiet | `SCRIPT.md` |
| Problem | Explanation | `progress-steps` candidate | `https://remocn.dev/docs/ui-blocks/progress-steps` | Custom; the four facts are validation gates, not a simulated running pipeline | executor source |
| Positioning | Explanation | `data-flow-pipes` candidate | `https://remocn.dev/docs/ui-blocks/data-flow-pipes` | Custom; a static request path is clearer and needs no glow packets | route and workflow source |
| Product reveal | Evidence | `drift` candidate | `https://remocn.dev/docs/layout/drift` | Custom crop; drift can make small dashboard text shimmer | real screenshot |
| Sponsored check-in | Evidence | `progress-steps` candidate | `https://remocn.dev/docs/ui-blocks/progress-steps` | Custom five-stage row mirrors the real UI and preserves exact labels | route tests and live execution |
| Recovery and paid proof | Evidence | Custom | None | Custom evidence cards keep exact hashes and values legible | ledger and paid evidence |
| Close | Presentation | `backdrop` candidate | `https://remocn.dev/docs/layout/backdrop` | Custom solid background matches the app without double framing | fresh verification |
| All transitions | Presentation | `zoom-blur` candidate | `https://remocn.dev/docs/transitions/zoom-blur` | Standard fade; zoom blur implies hierarchy not present between peer evidence scenes | `SCRIPT.md` |

No Remocn source or registry dependency is installed. Every scene uses Remotion
primitives and real project assets.
