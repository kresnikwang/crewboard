# CrewBoard UX Improvements Implementation Plan

**Goal:** Fix the confirmed usability issues from the UI/UX audit while retaining CrewBoard's existing visual identity.

**Architecture:** Keep the vanilla JS SPA and Bootstrap components. Extend shared UI helpers for keyboard selection, field errors and page routing; contain wide tables within their own scroll regions. Generate all runtime assets from source.

**Tech Stack:** Express, native JavaScript, Bootstrap 5, CSS, Playwright, SQLite test databases.

## Design direction

Retain the navy sidebar (#1E3A6E), white surfaces (#FFFFFF), warm page background (#FEFAF5) and project colors. Use accessible blue (#2E6BC4), body text (#1A1A1A) and secondary text (#667085). Keep Inter and native Chinese fallbacks, with readable 12–14px data text. Align controls and tables left, keep numeric columns aligned, and reserve shadows for meaningful layers.

Desktop: sidebar | page title + one-row actions | compact data table.
Mobile: topbar | title + wrapping actions | locally scrollable table with fixed identity column.

The calendar remains the product's defining composition. Avoid decorative changes that add density without information.

## Tasks

1. Modify `public/css/{base,layout,components,pages,schedule,bootstrap-bridge}.css`: contrast tokens, local table scrolling, fixed first columns, minimum day widths, focus states, touch controls, reduced motion, compact project layout. Verify 320/390/768/1024/1440px layouts.
2. Modify `public/js/core.js`: semantic navigation enhancement, URL state/history with existing auth hash compatibility, login Enter submission/autofill/busy state, shared inline validation and accessible option selection. Keep permissions and API behavior intact.
3. Modify `public/js/schedule/{02-load-render,05-modal,06-actions}.js`, `public/js/timesheets.js`, `public/js/manage.js`: connect keyboard selectors and field errors, label date/hour inputs, focus today on mobile, wrap tables, show bulk bar only with selections.
4. Modify `public/js/reports.js` and `public/js/i18n.js`: immediate data loading independent of Chart.js, bounded dependency loading with failure/retry state, prevent stale responses, bilingual labels and feedback.
5. Update the frontend build so CSS source changes also reach the runtime assets loaded by the SPA. Update relevant development documentation.
6. Add meaningful Playwright regression coverage for keyboard login/selection/navigation, small-screen table containment, URL history and blocked chart dependency. Run targeted tests, then `npm test`, `npm run build`, the full E2E suite, `git diff --check`, and screenshot QA.

Implementation proceeds in this chat; no deployment or production-data changes are part of this request.

## Verification results

- `npm test`: 178 passed (91 security, 37 regression, 50 email flows).
- `npm run test:e2e`: 28 passed, including six added UX regression scenarios.
- `npm run build` and `git diff --check`: passed.
- Browser screenshot review: desktop at 1440px and mobile at 390px; table containment checked at 320/390/768/1024px. No JavaScript page errors observed.
- Primary theme colors and secondary text checked against white: contrast ratios 4.8:1 or higher.
- Fixed a regression found during full E2E: picker option clicks now keep combobox focus until selection completes. Keyboard and pointer booking workflows both pass.
