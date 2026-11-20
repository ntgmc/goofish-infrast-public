# Goofish Infrastructure design

Use this guide for layout and interaction changes. Runtime values live in
[tokens.css](tokens.css); reuse its tokens rather than copying color, spacing,
typography or component mappings into another file. Feature behavior and routes
live in [V2 workspace](docs/v2-workspace.md).

## Visual system

- Genre: modern-minimal. Applications use a Workbench layout; documents use a
  Long Document layout. Keep the existing navigation and route ownership.
- V2 and admin use mist paper, slate text and copper accents. `--color-v2-*`
  supplies both themes; `.v2-app`, `.v2-drawer`, `.admin-app` and `.admin-dialog`
  map them to shared semantic tokens. Other routes retain the canonical palette.
- Keep Noto Sans SC display, Geist body and the existing monospace stack. Use
  tabular numbers for production, prices, efficiency and time.
- Accent identifies primary actions, selection and focus. Destructive actions
  use semantic red. Secondary actions use a quiet surface and visible boundary.
- Use one primary containment layer. `.tool-inset` is a ruled region inside
  `.tool-panel`, not another card. Prefer open data regions to nested panels.
- Public pages lead with actual product evidence. Documents use a reading width
  of 60–65ch, line height of at least 1.65 and left-aligned copy.
- Allow headings to wrap, use `min-width: 0` in constrained columns and keep
  dense tables or graphs scrollable within their own region.

## Workspace and admin

The shell owns page headings, navigation, theme and utility actions. V2 supporting
pages use `src/pages/v2/pages/` and `.v2-page-section` in `workspace-pages.css`;
admin uses `AdminShell.tsx` and `admin.css`. Reuse business hooks and specialized
editors, binding dialogs, task progress and comparison charts.

| Area | Composition |
| --- | --- |
| V2 navigation | Fixed brand and bottom help/appearance controls; independently scrolling task links. Destinations are real links preserving the profile; editors open drawers. Tool details retain the tools selection. |
| Top bar | Breadcrumb and current location beside notification/account utilities. Keep one compact row on phones, moving secondary actions into “更多操作”; preserve full accessible labels. |
| Overview | One production strip and a full-width schedule, three room columns on wide screens. Phones show the schedule first; configuration and full readings expand below it. |
| Generation | Preparation beside execution, with compact editable summaries and an explicit generate action. Keep the action and charge summary visible without covering content. |
| Tools | Group by 基建、干员养成、材料与仓库. Two columns per group, one on phones; omit unavailable empty groups. |
| Accounts, history, announcements | Searchable index and one selected detail region. Separate records from saved configurations and expose actions in context. |
| Cultivation | Separate target queue from resource planning; keep add/edit actions available. Material acquisition, synthesis and calendar have independent views. |
| Inventory | Item shelf with inspect/use dialogs; tasks and activity records have separate views. |
| Settings and documents | One settings task at a time. Legal documents use a reading region with an adjacent index; FAQ uses search and disclosure. |
| Admin records | Lead with search, common filters and records. Advanced filters expand on demand; batch actions appear after selection. User detail selects one profile. |
| Admin monitoring | Separate queue, service history and dead letters. Risk uses a case index and one evidence region. Preserve visited drafts and stop inactive polling. |

Menus retain keyboard navigation, visible focus, Escape dismissal and focus return.
Mobile navigation locks background scrolling and keeps a focus loop. Unread counts,
pending account switches, feature availability and unsaved drafts remain visible.
Admin operation safeguards are defined in [admin operations](docs/admin-operations.md).

## Drawers, dialogs and details

- Use a fixed compact heading, a bounded scrolling body and separate actions.
  Keep close controls visible, including image previews and nested dialogs.
  When content fits, avoid reserved scrollbar gutters or asymmetric padding.
- Operator drawers keep search available and use a responsive grid of compact
  cards. Reserve two name lines, retain training data and align skill previews.
  Virtualize whole rows, retaining focused and adjacent rows; reduce columns
  when text is enlarged. The full card is one keyboard-accessible trigger.
- `SharedCardDialog` shares background, artwork and name with its source. Keep
  source cards mounted and hidden during the modal, body text at natural scale,
  and source focus restored on dismissal. Use `layoutScroll` on scroll hosts
  and projection roots for dialog/return portals.
- Dismissal releases the modal, scroll lock and focus trap immediately. Decorative
  return portals are inert; scrolling, resizing, another selection or reduced
  motion cancels their return animation. Do not reopen hover previews on focus return.
- Material routes use `stationaryContent` so graph coordinates stay fixed during
  the surface transition. Keep local scrolling and the selected material visible.
- Facility details lead with product, efficiency and shift production. Align
  operator identity, skills and mood tracks. Show actual start/end readings;
  clamp only the drawing, use the selected maximum mood (default 24), and leave
  missing data unavailable. Collapsed skill details stay inert and hidden.
- Feedback keeps its tabs and frame steady. Protect drafts and pending requests;
  empty forms may dismiss through the overlay. Associated IDs expand on demand.

## Feature presentation

- AI explanations use the local Amiya portrait, a short launcher label and a
  small AI badge. The floating dialog leaves the schedule usable. Launcher and
  title bar support pointer and arrow-key movement; move them as a group and
  clamp within the visible workspace, clear of the rail. Preserve position and
  generation state per report. Escape returns focus to the launcher.
  Render Markdown and locally scroll tables; show streamed text progressively
  without replaying old text or placing partial text in the query cache.
  Billing, consent and saved-answer rules live in [AI explanations](docs/ai-schedule-explanation.md).
- Pricing prioritizes the execution outcome, free-start/redemption paths and
  accurate plan terms. Desktop compares four cards; mobile uses a wrapping native
  plan selector and one selected plan. Keep UID binding and activation beside
  purchase. Capability chapters may use one sticky visual on wide screens;
  smaller screens and reduced motion show visuals inline. Preserve native scroll.
- Keep plan headers visible in the entitlement table, merge equal adjacent
  values and retain custom capability rows. Examples remain distinguishable from
  measured benchmark evidence; use published data and theme-matched screenshots.
  Do not copy prices, quotas or availability into design rules; see
  [product copy](docs/product-copy.md) and [site comparison](docs/site-benchmark.md).
- Purchase dialogs and pages share product content. Prioritize the listing action,
  binding terms, delivery expectation and support. Generate QR images locally from
  the selected link, with dark modules, white background and a four-module quiet
  zone. Keep direct purchase usable if QR generation fails; disclose media on
  phones unless it is the only purchase route. See [purchase configuration](docs/v2-workspace.md#购买与公开图片).
- Service status pairs labels and icons with distinct colors/patterns from
  `service-status.css`. Unknown periods remain neutral and hatched. History has
  one Tab stop, arrow navigation, Home/End within a day and Ctrl for the week.
  Preserve missing-data states, retry and incident updates.

## Motion and loading

Use motion for navigation, a changed value or the object being used. Reuse existing
motion components and timing tokens. Avoid bounce, overshoot, parallax and nested
stagger cascades.

- Navigation keeps the rail and top bar still. Scoped page snapshots use a 90ms
  departure and 220ms/6px entrance; the fallback starts at 72% opacity. Loading
  stays live, deferred content restores scroll/focus after mounting, and newer
  navigation cancels old transitions without discarding drafts.
- Shift changes retain room shells and slots, crossfading occupants only.
  Departing content leaves keyboard/accessibility navigation immediately. Room
  geometry may transition over 280ms; text and portraits keep their native scale.
- `SharedCardDialog` uses the existing damped morph with no bounce. Facility
  details animate only expanded content height/opacity; material graphs reveal
  the selected column before neighbors and connectors.
- Stable list items reveal once per mounted list, inside virtual positioning
  shells. Search results show immediately; focus and large scroll jumps skip
  reveals. Shared geometry updates on selection, not virtual scrolling.
- Data refresh keeps readable results and drafts. Use row-shaped placeholders on
  first read and pagination, a compact copper status ring, and a longer-wait
  message after eight seconds. Confirm success only for a completed new revision;
  failures, partial updates and cancellation retain their actual state.
- Changed readings interpolate in place; unchanged cards do not replay. Fresh
  generated results may settle metrics and room groups once. Income bars remember
  their reveal per result. Keep accessible final values and units stable.
- Generation progress follows actual stages. Waiting, running, saving,
  reconnecting and terminal states remain distinct; confirmed completion reaches
  100% before the card collapses. Timers remain still and terminal states stop loops.
- Pricing amounts use the configured value. Headline benchmark counters may reveal
  once; evidence, units, denominators and dense readings stay stable. Pointer-only
  tilt/spotlights stay off touch devices; pause loops in hidden pages.
- Update prompts use published release notes. Returning-build summaries load on
  demand; first visits stay quiet. Record a refresh target before reload to avoid
  duplicate prompts. Keep theme and the update surface continuous across reload.
- Admin motion previews require a server-confirmed session. The inspector also
  requires an explicit per-user browser preference, off by default. Disabled
  inspection installs no observers; disabling it, switching users, session loss
  or navigation tears down the recorder and preview. Replay uses inert detached
  copies and never runs business callbacks, writes
  refresh markers, submits jobs or affects billing. Hide it while a modal owns focus.

App and system reduced-motion settings show final content directly, removing
translation, scaling, layout/ink effects and chart drawing. Any retained opacity
transition is at most 150ms. Admin replays stay local to the preview.

## Responsive and accessibility checks

Collapse secondary columns below 80rem, rails/selection columns below 60rem, and
dense controls below 40rem. Verify 320, 375, 414 and 768px, both themes, keyboard
navigation, enlarged text and reduced motion. Interactive targets are at least
44×44px. Root overflow clipping must not hide component defects.

Use actual loading, empty, unavailable, error and populated states. Feature and
permission behavior remain owned by their implementation and topic documents;
validation requirements are in [agent validation](docs/agent-validation.md).
