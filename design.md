# Goofish Infrastructure design

All pages follow this design system. Read it before a Hallmark run and update
it deliberately when changing the shared design.

## System

- Genre · modern-minimal
- Marketing macrostructure · Workbench
- Application macrostructure · Workbench
- Content macrostructure · Long Document
- Theme · custom tuned (vibe: "technical, restrained, precise, trustworthy")
- Axes · light / geometric-sans / cool-violet
- Navigation · N9 edge-aligned public shell; existing side rail for app and admin
- Footer · Ft2 inline rule, collapsing to a vertical list below 40rem
- Enrichment · existing product captures on marketing pages; none elsewhere

## Tokens (canonical · `tokens.css` is the source of truth)

```css
:root {
  --color-paper:      oklch(0.985 0.008 285);
  --color-paper-2:    oklch(0.958 0.012 285);
  --color-ink:        oklch(0.205 0.018 285);
  --color-ink-2:      oklch(0.390 0.016 285);
  --color-rule:       oklch(0.820 0.016 285);
  --color-accent:     oklch(0.470 0.185 285);
  --color-accent-ink: oklch(0.985 0.008 285);
  --color-focus:      oklch(0.550 0.220 285);

  --font-display: "Noto Sans SC Variable", "Microsoft YaHei", sans-serif;
  --font-body: "Geist Variable", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, monospace;

  /* 4px spacing scale: --space-3xs through --space-4xl. */
  /* Major-third type scale: --text-xs through --text-display. */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 160ms;
  --dur-base: 220ms;
  --dur-slow: 300ms;
  --radius-card: 10px;
  --radius-pill: 999px;
  --radius-input: 7px;
}
```

## Composition rules

- One primary containment layer. `.tool-panel` is primary; `.tool-inset` is a ruled region, never a second card.
- Public pages lead with real product evidence. Avoid three-equal-column feature grids and generic SaaS section sequences.
- App and admin pages preserve route ownership and side-rail information architecture while using open data regions.
- Content pages use a reading width of 60 to 65ch, a line height of at least 1.65, and whitespace instead of card stacks.
- Display headings use `overflow-wrap: anywhere` and `min-width: 0`; document copy stays left aligned.
- Accent is a signal only: primary action, active state, focus, and compact status marks.
- The deployment dialog interrupts an outdated page with the new version's release
  notes and a refresh action. Reopening a newer build welcomes returning users
  with the latest three nonempty release summaries since their last version, a
  full changelog link and a dismissible continue action. Read returning summaries
  lazily from the opened build's published history. Remember the latest visited
  build on this browser; record the refresh target before reloading so that
  entering that build does not show a second prompt. First visits stay quiet.

## Variants

### V2 workspace (`/v2`)

- Keep the modern-minimal / Workbench application family, current routes,
  side navigation, configuration drawers, and result workflow.
- Audience: Arknights players reviewing and exporting base schedules. Lead with
  the current result, daily production, shift selection, and operator assignments.
- Palette: mist paper, slate ink and navigation, copper accent. `tokens.css`
  defines `--color-v2-*`; `.v2-app` and `.v2-drawer` map those values to shared
  semantic tokens. Routes outside V2 and the management console retain the
  canonical palette.
- Light paper: `oklch(0.967 0.007 75)`; accent: `oklch(0.490 0.120 45)`.
  Dark paper: `oklch(0.205 0.016 255)`; accent: `oklch(0.770 0.125 45)`.
- Keep Noto Sans SC display and Geist body fonts, with tabular numbers for
  production, efficiency, and shift times.
- Keep six core tasks in the side rail: overview, generation, history and
  “比较基建配置” under the schedule workspace; cultivation projects and tools in
  their own group. Tools label saved-schedule comparison “比较已有排班”. Use
  full-width compact “干员管理” and “编辑基建” actions for their drawers, retaining the
  owned-operator count. Use an import icon for operator data and a pencil for configuration.
  The compact brand header and bottom help trigger stay visible while the
  middle navigation scrolls independently. Keep consistent 44px targets,
  visible inset focus rings and copper active icons. Page destinations are
  real links with the current profile in the URL; configuration opens dialogs.
  On mobile, align the close button with the brand, lock background scrolling,
  retain the keyboard focus loop, and restore the menu trigger on dismissal.
  The top-right account drawer owns profile management, Skland data, inventory,
  account settings and available billing
  pages. Group guides, announcements, releases and site links under the rail's
  “帮助与更多” menu, which opens above its bottom trigger without moving the
  trigger or resizing the rail. Separate help and support from product news and
  comparisons, with service status in the menu footer. Keep “外观与动画” visible
  above the help trigger, opening one drawer with theme and animation preferences;
  reuse these controls in account preferences and keep the top-bar theme shortcut. Use compact
  group labels, 44px rows, readable labels and inset focus rings. Retain the
  unread announcement count while collapsed and scroll inside the menu when
  needed. Native disclosure semantics retain Tab navigation; arrow keys and
  Home/End browse available entries, Escape returns to the trigger, and leaving
  with Tab closes the menu. Nested dialogs retain their opener and draft.
  Tool detail pages keep the tools entry highlighted. Preserve the Ft2 footer.
- The top bar separates page location from utility actions and the account
  opener. Use a semantic breadcrumb with a profile-preserving workspace link,
  readable current page, consistent 44px utility buttons and visible open/focus
  states. Show the current profile name with a secondary label on wide screens;
  retain its full accessible label and avatar on mobile. Below 40rem, keep one
  compact row with location, notifications and account access; place theme and
  calculation tools in the “更多操作” popover. Truncate long locations within
  their column; retain the full page heading below. Mobile announcements show
  their title and disclosure arrow, with the body available on expansion. Keep
  unread and calculation badges, existing dialogs and theme menu.
- Operator and account drawers share a compact fixed heading and an independently
  scrolling body. Keep the operator profile, sync and MAA import actions compact;
  binding timestamps and authorization details expand on demand. The list search
  stays visible while browsing operators. The operator drawer grows to 800px on desktop and
  shows a compact responsive grid with a minimum card width of 8rem and 0.5rem gaps. Reserve two
  lines for each name beside a prominent 48–64px portrait, with training data wrapping beneath
  the name. Make the full card a single keyboard-accessible trigger, with skill previews aligned
  at the bottom. Open full skill descriptions in a wide `SharedCardDialog`; keep the source card compact. Share the background, portrait and
  name between card and detail, with a heavily damped spring and no bounce. Keep the source mounted
  during the transition, allow detail scrolling immediately, contain it at its boundaries
  and restore the source button's focus on dismissal. Scroll descriptions inside
  the detail surface so its top-right close control remains visible.
  Reduced motion switches directly. Virtualize whole rows for large rosters, retaining focused and
  adjacent rows. Reduce columns with text enlargement. Operator data comes from import or sync.
  Account identity
  precedes profile switching; mark the selected profile and show pending switches.
  Personal destinations use simple rows, with logout in a separate fixed footer.
  Preserve full names, feature availability, nested binding dialogs and focus return.
- Large task, feedback and Skland dialogs share a fixed heading, bounded scrolling
  body and separate actions. Keep feedback tabs visible during scrolling.
  Feedback keeps a steady frame height across tabs and disclosure changes, with
  an overlay scrollbar that occupies no content width. Start with the issue and
  screenshot; associated IDs expand on demand with reduced-motion support.
  Protect actual drafts and pending submissions, while allowing empty forms to
  dismiss through the overlay. Task rows emphasize status and next action, with
  diagnostic identifiers inside details. Image previews retain a visible close
  target and return to their parent. Support narrow screens and enlarged text.
  Use automatic scrollbars without a reserved gutter or asymmetric padding when
  content fits. Let the dialog primitive compensate for page scroll locking.
- Use one production summary strip and an open, full-width schedule region.
  Facility cards provide the object boundaries; keep shift selection and controls
  directly above them without a surrounding panel or repeated schedule heading.
  Wide screens show three room columns. Put configuration and detailed production
  below the schedule in a native disclosure; keep its DOM order aligned with its position.
  Below 40rem, place the schedule before the production strip so facilities are
  visible on entry. Operator portraits and efficiency carry the visual weight.
- Keep generation beside the overview title and export beside result navigation.
  Copper marks the primary action and focus; station colors identify room types
  through the same icon backgrounds on desktop and mobile.
- V2 navigation keeps the rail and top bar steady. Use scoped native page
  snapshots when supported: the old content leaves in 90ms and the destination
  enters over 220ms with a 6px translation, without scaling. Loading screens
  stay live; skip their snapshots and fade in the content once it arrives.
  The fallback enters from 72% opacity over 220ms without a blank frame.
  First load and reduced motion update directly. Wait for a deferred page to
  commit before restoring history scroll and route focus; cancel superseded
  transitions and preserve mounted drafts. Keep room shells and operator
  slots across shifts; crossfade only their occupants and
  exclude departing occupants from interaction and accessibility. Animate room
  geometry over 280ms while keeping text and portraits at their original scale. Keep shared active
  indicators, result crossfades, and drawer enter/exit.
  Reduced motion removes translation, scaling, layout transitions, and chart
  drawing; retained opacity transitions stay at or below 150ms.
- The public result layout at `riic.autos` informed result hierarchy,
  adjacent shift controls, and portrait-led assignments. Use an independent
  palette and implementation.
- Supporting pages own their V2 components in `src/pages/v2/pages/`. Share
  business hooks with V1; compose each workspace around its user's next task.
  Keep the specialized configuration editor, schedule editor, binding dialog,
  progress renderer and comparison chart as shared controls.
- The tools directory groups links under “基建”, “干员养成” and “材料与仓库”,
  with base scheduling first and special recruitment after the ongoing cultivation
  tools. Use two columns within each group and one column below 40rem, concise
  purpose descriptions and larger gaps between groups. Omit sequence numbers;
  preserve profile-aware links and hide groups with no available tools.
- Accounts use a searchable selection index and one account detail region.
  History separates result records from saved configurations, then exposes
  actions for the selected record. Inventory uses an item shelf, inspect/use
  dialogs, and separate task and activity views.
- Generation separates preparation from execution with a column gap and one rule.
  Keep operator and configuration summaries beside their edit actions, with compact
  row spacing and no enclosing panel or step numbers. Use at least 14px for action
  guidance, operator names and inventory hints; reserve 12px for auxiliary metadata
  such as times and facility levels. Separate room groups with larger gaps than the
  spacing within a group. Below 40rem, the first-use checklist collapses to the
  current step, and preparation rows open the existing editors across the whole row.
  Coupon options expand on demand on mobile; when no coupons are available, show
  “暂无可用券” and keep the rules collapsed at every width. Keep the generation action
  and any charge summary at the bottom, reserve its measured height in the page,
  and retain validation and retry messages.
  Comparison composes the
  experiment before inspecting candidate results. Cultivation separates
  conditions from priority, material, calendar and inventory results. Manual
  scheduling makes account, layout and starting schedule explicit steps.
- Settings use task navigation and a single visible content region. Pricing
  keeps four maintenance cards on desktop, showing price, audience, checked benefits
  and a purchase action leading to the V2 purchase guide. Below 40rem, show free capabilities and generation
  limits first, list shared maintenance benefits once, and compare all four terms
  and total prices in a compact native radio group that wraps with the available
  width. Show only the selected plan's total, audience, archive gift and purchase
  action, with UID binding and activation
  conditions immediately above the action. Keep redemption before capability demonstrations.
  Four capability chapters pair paid configuration controls and a compact MAA file flow with
  readable cultivation results and a measured layout comparison. Screenshots in
  `public/assets/pricing/` capture the real editor's drone strategy section with `SAMPLE_CONFIG`.
  The configuration chapter names custom shift intervals, drone allocation and Fiammetta settings.
  Light and dark assets follow the app theme and expand in a keyboard-accessible dialog. The
  export chapter highlights unlimited downloads during maintenance for MAA schedules, with a small
  file moving from the website download to MAA selection. Animate only while visible and show the
  complete flow without motion under reduced motion. Cultivation readings come from the public
  sample result's Mayer suggestion; the
  zero-based comparison chart uses A01's MaaTool S1/S2 cases from the frozen 2026-11-04 snapshot,
  with a link to the underlying evidence. Keep sample estimates distinct from measured results.
  At 80rem and above, native scrolling selects a chapter beside one sticky visual, based on
  current chapter positions at 45% of the viewport. Recalculate on scroll and resize; select the
  last chapter when its bottom is visible. Smaller screens and reduced motion show visuals inline. Keep comparison quotas and
  current service availability beside the relevant chapter, then the compact benchmark proof strip. On desktop, plan descriptions expand on demand; at every width,
  the full entitlement comparison, purchase rules and upgrade details are expandable.
  Purchase guides retain the selected product and profile. Group the product,
  price, terms, listing action and copy action first, with the raw URL available
  on demand. Keep redemption before long media; pair this overview with the QR
  on desktop and place the QR before the buying steps on mobile. Show steps in
  three columns on desktop and a vertical list on mobile. Share posters expand
  on demand, showing the full image without cropping; open them by default when
  they are the only way to reach the product. Each product owns its media;
  blank images take no space.
  Admin image fields support direct upload, preview, replacement and removal,
  with optional URL entry. Preserve original image bytes, pause publishing during
  uploads, and retain the previous image after a failed upload. Keep keyboard
  focus clear of the settings save bar.
  Keep original-image links and recovery for failed media or content loads.
  All pages use bounded content widths and V2 tokens.
- The workspace shell owns page headings. Legal documents place their index
  to the right of a reading area of up to 65ch. FAQ pairs search with expandable
  answers; support pairs a contact region with preparation steps. Releases and
  signed-in announcements use a selection index and reading region.
- `src/pages/v2/workspace-pages.css` styles V2-owned structure under
  `.v2-page-section`. Collapse secondary columns below 80rem, selection and
  document columns below 60rem, and dense controls below 40rem. Retain padded
  surfaces, keyboard focus, 44px controls, and shared reduced-motion support.
- The public site comparison at `/v2/benchmarks` uses Stat-Led composition inside
  the same V2 rail: paired execution and yield headline metrics, a 90-mark
  pass/fail matrix, prominent paired gains, and 30 rows of three-site scores.
  Use green checks and red crosses with struck failed readings; expand evidence
  below the selected row and collapse methods by default. Retain the V2
  palette, fonts, responsive controls and reduced-motion behavior. Frozen data,
  publication fields and verification: [site comparison](docs/site-benchmark.md).
- Page coverage and verification: [V2 workspace redesign](docs/v2-workspace-redesign.md).

### Management console (`/admin`)

- Use the V2 mist, slate and copper palette with the canonical fonts and spacing.
  `.admin-app` and `.admin-dialog` map V2 values to the shared semantic tokens;
  admin dropdown and popover portals inherit the same palette.
- Audience: administrators locating accounts, issuing entitlements, reviewing risk
  and monitoring services. Group the existing routes by operation, entitlements,
  service and security, and site configuration. Keep the account setup entry.
- `AdminShell.tsx` owns navigation, headings, theme and current-page refresh.
  `AdminDashboardView.tsx` composes domain sections. Load user and CDK records
  only in their respective sections; keep visited sections mounted for drafts.
- User maintenance leads with search, common filters and records. Expand advanced
  filters on demand. Select a user to enter the detail workspace, then select
  one profile; password reset belongs to that user context.
- CDK opens with records; generation and distribution analysis are separate
  tasks. Show batch actions only after selecting records on the current page.
- Configuration and monitoring use keyboard-accessible task tabs. Risk pairs a
  case index with one evidence region. Queue monitoring separates waiting,
  running and recent tasks from service history and dead-letter handling.
- Profile edits collect values and an audit reason in one dialog. Failed
  submissions preserve inputs; explicit refresh updates the target version
  before retry. Keep profile and workspace versions distinct.
- `src/pages/admin/admin.css` owns layout beneath the admin shell and dialogs.
  Collapse the rail and selection columns below 60rem and dense controls below
  40rem. Tables scroll locally; page and portal controls retain visible focus,
  44px targets and shared reduced-motion behavior.
- Page coverage and verification: [Admin workspace redesign](docs/admin-workspace-redesign.md).

## CTA voice

- Primary · accent fill · 7px radius · compact 12px/18px rhythm · concrete verb
- Secondary · transparent or paper fill with visible rule · same radius and height
- Destructive · reserved semantic red; never reuse the brand accent

## Motion stance

- Keep workspace motion short and tied to navigation, state, or the object being used.
- Pricing changes roll the exact configured amount over 300ms. Benchmark headline,
  pass-rate and median metrics count once on entering the viewport over 750ms;
  units, denominators, evidence and dense comparison readings remain stable.
- Pointer hover may lift item tiles by 2px and move directory arrows by 3px.
  Pricing cards use border emphasis while their controls stay in place.
- Pricing and capability demonstrations use contained reveal and scroll storytelling;
  keep native scrolling and immediate access to prices and actions. The desktop capability
  illustration follows a fine pointer with a low-opacity copper spotlight and at most 2deg
  tilt per axis, returning to rest on leave. The lifetime card automatically traces its edge
  every four seconds on desktop and touch, using a 3px copper band with a bright core.
  Its purchase action sweeps once on hover or focus. Pointer tilt and spotlight stay off
  on touch; reduced motion keeps the card and illustration static.
- V2 data waits use a copper source-to-record graphic and quiet, synchronized skeleton sweeps.
  Keep the real status readable, introduce decorative movement after 180ms, and add a longer-wait
  message after eight seconds. Pause loops in hidden pages; system or app reduced motion shows
  static shapes. Full-screen startup centers the brand, readable status and a short moving line on
  one axis; data-source graphics belong to local waits. Section loads retain the workbench
  navigation and reserve the content layout.
  Refreshes retain readable data. Confirm completion only after a pending request returns a new
  revision without errors; failed, partial or cancelled refreshes keep their existing error state.
  Changed readings interpolate from the old value and outline their own card for 600ms without
  remounting the content or replaying unchanged cards. Cultivation waits follow the actual snapshot
  refresh and cultivation request, preserving saved targets, input drafts and expanded material
  details. First visits reserve the unknown results; returned materials and dates update in place.
  Other V2 lists use row-shaped placeholders on first read and at the pagination tail. Existing
  results remain readable during refresh. Busy controls carry `aria-busy` and a quiet bottom-edge
  light; small operations keep feedback inside their own control. Shared notification, feedback,
  and training tools use compact status lines within V2, including portalled surfaces.
  V2 Skland binding pairs the real request message with a source-to-record illustration: Skland
  branches into operator records and base configuration, or account and inventory for depot binding.
  Authorization pulses only at the source; the selected-account request moves packets to the records;
  confirmation highlights the receiving cards while saving. These loops show activity, never progress
  or completion. Results and errors replace the illustration immediately; hidden and reduced-motion
  settings pause or remove decorative movement.
  The V2 root scopes these enhancements so shared V1 screens retain their existing presentation.
- Operator, tool, inventory and benchmark lists reveal each stable item once per
  mounted list: 8px travel, 240ms duration, up to eight items at 25ms intervals, or 50ms for
  operator cards and V2 manual/cultivation operator candidates. Candidate pickers observe their own
  scroll viewport; newly reached batches reveal once during each opening. Animate operator contents
  inside the virtual positioning shell. Searches show
  immediately; prepare each unseen item's initial state before paint to prevent a full-opacity
  flash. Jumps exceeding 80% of the scrolling viewport skip reveals; focusing cancels the item's
  animation. Shared card geometry updates on selection changes rather than virtual scrolling.
- `SharedCardDialog` provides card-to-detail transitions with shared layout IDs and the morph
  spring (stiffness 380, damping 40, mass 0.85). Facility cards use it for their background, icon
  and title. Facility details put product, efficiency and shift production first, then compact operator
  rows with identity beside a mood track on wide surfaces and stacked on narrow ones. Keep exact
  starting and ending mood readings beside the track; its filled level represents ending mood,
  a lighter segment shows the change, and a marker identifies starting mood. Scale to the selected
  plan's maximum mood, defaulting to 24. Clamp drawing only; retain actual numeric readings and
  show missing values as unavailable without drawing a change. Recovery uses the positive token.
  Operator rows share their column widths, keeping mood tracks aligned when skill icon counts vary.
  The skill trigger, icons and mood track keep their columns while skill details expand below the row;
  animate only the details height and opacity, and apply changes immediately with reduced motion.
  Keep collapsed skill content inert and hidden from assistive technology. Full calculation details
  expand on demand. The heading retains facility level and shows the selected shift and duration. Keep text in its own shared element or fade it
  into the destination; do not stretch long descriptions. Use `layoutScroll` on the scroll host.
  Dismissal unmounts the modal immediately, releasing its overlay, focus trap and scroll lock.
  Facility source cards handle their return morph. Operator details return through a decorative,
  inert portal above the drawer and its search toolbar, starting at the detail's current visual bounds
  and ending at the source card's untransformed bounds within its virtual row. Crossfade the detail
  and compact content without scaling their text. Keep the shared geometry on the inner return surface
  so reopening continues from its current bounds. Opening another card, changing the list, scrolling,
  resizing or enabling reduced motion cancels the return immediately. Keep the most recently opened
  source card and its virtual row above neighbouring cards. The decorative return stays above the
  search toolbar while ordinary scrolling keeps the toolbar above the list. Opening another card transfers this priority. Keep background scrolling
  locked only while the modal is open. Skill previews on dialog triggers respond to pointer hover;
  keyboard users read skills in the dialog, and returning focus does not reopen a preview.
- Overview production numbers interpolate from their displayed value when a result changes, keeping
  the final accessible value and units stable. Fresh generated results settle metrics and room groups
  in order over roughly half a second; navigation back and ordinary data refreshes do not replay it.
- Shift changes briefly outline incoming occupants; unchanged seats remain still. Income contribution
  and capacity bars grow to their real proportions when entering view. Remember seen bars per result
  across analysis-tab visits; new result IDs start a fresh reveal. Reduced motion shows final bars.
- V2 generation progress uses a compact SVG state symbol: waiting dots, a running arc, a
  closed ring while saving, and a drawn completion check. Reconnection, cancellation and failure
  stay visually distinct and stop activity. Step connectors fill when the real stage advances,
  vertically on small cards and horizontally on wide cards. Once the result is available,
  collapse the card 620ms after confirmed completion, giving its meter and number time to settle;
  reduced motion shows the result directly. Only V2 enables these stage effects. The percentage
  uses the shared numeric tween with a stable three-digit width; timer readings remain still.
  Backend completion targets 100% immediately so both meter and number finish before dismissal.
  Transition stage titles and descriptions only when the stage changes. On narrow cards, animate
  the active step's description height with the morph spring; wide cards keep all descriptions
  visible. A short copper tail and bright leading edge follow the existing meter value, stopping
  on paused or terminal states. Reduced motion removes the leading edge and moving text.
  Generation and appearance settings offer a local progress preview after `/api/admin/session`
  confirms an administrator session. Hide it until confirmed, on failed checks or session expiration,
  and recheck when the window regains focus. Its normal, quick, reconnection, failure and
  cancellation scenarios use the same component and support replay and stepping;
  closing the dialog stops its timers. Preview state stays outside the optimization workflow,
  account storage and billing, and its completion message is explicitly a demonstration.
  The animation inspector additionally requires an explicit switch in Settings → Preferences,
  off by default and stored per website user in the current browser. A server-confirmed admin session
  is still required. Disabled inspection installs no observer or native instrumentation; switching users,
  disabling inspection or losing the admin session tears down the recorder and preview.
  When enabled, the bottom-right inspector records native animations, CSS transitions, sampled layout changes and numeric tweens from
  the current page, retaining the latest 24 effects in memory until navigation. A detached,
  inert copy inside a shadow root replays each effect once at 0.1×–4× with pause and replay
  controls; global page selectors, business events, original animation callbacks and page data
  stay outside the preview. Preserve SVG references
  with distinct snapshot IDs. Snapshot roots freeze immediately; descendant styles copy in 4ms batches
  with a 16ms yield. Pending effects with the same identity coalesce. Large snapshots retain at most
  80 elements and show a simplified-preview notice; mutation batches sample each changed element once.
  Hide the inspector while a page modal owns focus; captured effects
  remain available after it closes. Session expiration stops observation and clears the preview.
  Reduced-motion settings determine which page effects exist to capture; explicit replay stays
  local to the inspector. Route, pending timers and native instrumentation clean up on departure.
- No nested stagger cascades, bounce, overshoot, or parallax in workspaces.
- Reduced-motion fallback · final numbers and content immediately; no transform;
  retained opacity transitions at or below 150ms.

## Responsive contract

- Layout collapse at 60rem; phone typography and interaction rules at 40rem.
- Verify 320, 375, 414, and 768px; all phone hit targets are at least 44×44px.
- `html` and `body` clip accidental horizontal overflow without masking component-level defects.

## Exports

Runtime styles use `tokens.css`. The portable exports below mirror its light
theme; dark theme values are defined under `.dark` in `tokens.css`.

### V2 exports

CSS source: the `--color-v2-*` token blocks and `.v2-app, .v2-drawer` mappings
in `tokens.css`, shared by `.admin-app` and `.admin-dialog` for the management
console. Fonts, spacing, type scale, and easing use the canonical
exports below. The variant's portable core follows.

```css
/* Tailwind v4 */
@theme {
  --color-v2-canvas: oklch(0.967 0.007 75);
  --color-v2-surface: oklch(0.993 0.003 75);
  --color-v2-inset: oklch(0.953 0.006 75);
  --color-v2-ink: oklch(0.265 0.025 255);
  --color-v2-secondary: oklch(0.440 0.018 255);
  --color-v2-muted: oklch(0.495 0.012 255);
  --color-v2-accent: oklch(0.490 0.120 45);
  --color-v2-accent-ink: oklch(0.993 0.003 75);
  --color-v2-line: oklch(0.865 0.008 75);
  --color-v2-control: oklch(0.665 0.012 255);
  --color-v2-focus: oklch(0.490 0.120 45);
}
```

```json
{
  "v2": {
    "canvas": { "$type": "color", "$value": "oklch(0.967 0.007 75)" },
    "surface": { "$type": "color", "$value": "oklch(0.993 0.003 75)" },
    "inset": { "$type": "color", "$value": "oklch(0.953 0.006 75)" },
    "ink": { "$type": "color", "$value": "oklch(0.265 0.025 255)" },
    "secondary": { "$type": "color", "$value": "oklch(0.440 0.018 255)" },
    "muted": { "$type": "color", "$value": "oklch(0.495 0.012 255)" },
    "accent": { "$type": "color", "$value": "oklch(0.490 0.120 45)" },
    "accent-ink": { "$type": "color", "$value": "oklch(0.993 0.003 75)" },
    "line": { "$type": "color", "$value": "oklch(0.865 0.008 75)" },
    "control": { "$type": "color", "$value": "oklch(0.665 0.012 255)" },
    "focus": { "$type": "color", "$value": "oklch(0.490 0.120 45)" }
  }
}
```

```css
/* shadcn/ui */
.v2-app, .v2-drawer {
  --background: var(--color-v2-canvas);
  --foreground: var(--color-v2-ink);
  --card: var(--color-v2-surface);
  --card-foreground: var(--color-v2-ink);
  --popover: var(--color-v2-surface);
  --popover-foreground: var(--color-v2-ink);
  --primary: var(--color-v2-accent);
  --primary-foreground: var(--color-v2-accent-ink);
  --secondary: var(--color-v2-inset);
  --secondary-foreground: var(--color-v2-ink);
  --muted: var(--color-v2-inset);
  --muted-foreground: var(--color-v2-muted);
  --accent: var(--color-v2-hover);
  --accent-foreground: var(--color-v2-ink);
  --border: var(--color-v2-line);
  --input: var(--color-v2-control);
  --ring: var(--color-v2-focus);
}
```

### Tailwind v4

```css
@theme {
  --color-paper: oklch(98.5% 0.008 285);
  --color-paper-2: oklch(95.8% 0.012 285);
  --color-paper-3: oklch(92.5% 0.014 285);
  --color-rule: oklch(82% 0.016 285);
  --color-rule-2: oklch(88.5% 0.014 285);
  --color-muted: oklch(45.5% 0.018 285);
  --color-ink-2: oklch(39% 0.016 285);
  --color-ink: oklch(20.5% 0.018 285);
  --color-accent: oklch(47% 0.185 285);
  --color-accent-ink: oklch(98.5% 0.008 285);
  --color-focus: oklch(55% 0.220 285);
  --font-display: "Noto Sans SC Variable", "Microsoft YaHei", sans-serif;
  --font-body: "Geist Variable", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --spacing-3xs: 0.25rem;
  --spacing-2xs: 0.5rem;
  --spacing-xs: 0.75rem;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --spacing-xl: 3rem;
  --spacing-2xl: 4rem;
  --radius-card: 10px;
  --radius-pill: 999px;
  --radius-input: 7px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(98.5% 0.008 285)", "$type": "color" },
    "paper-2": { "$value": "oklch(95.8% 0.012 285)", "$type": "color" },
    "paper-3": { "$value": "oklch(92.5% 0.014 285)", "$type": "color" },
    "rule": { "$value": "oklch(82% 0.016 285)", "$type": "color" },
    "rule-2": { "$value": "oklch(88.5% 0.014 285)", "$type": "color" },
    "muted": { "$value": "oklch(45.5% 0.018 285)", "$type": "color" },
    "ink-2": { "$value": "oklch(39% 0.016 285)", "$type": "color" },
    "ink": { "$value": "oklch(20.5% 0.018 285)", "$type": "color" },
    "accent": { "$value": "oklch(47% 0.185 285)", "$type": "color" },
    "accent-ink": { "$value": "oklch(98.5% 0.008 285)", "$type": "color" },
    "focus": { "$value": "oklch(55% 0.220 285)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Noto Sans SC Variable, Microsoft YaHei, sans-serif", "$type": "fontFamily" },
    "body": { "$value": "Geist Variable, PingFang SC, Microsoft YaHei, sans-serif", "$type": "fontFamily" },
    "mono": { "$value": "SFMono-Regular, Consolas, Liberation Mono, monospace", "$type": "fontFamily" }
  },
  "space": {
    "3xs": { "$value": "0.25rem", "$type": "dimension" },
    "2xs": { "$value": "0.5rem", "$type": "dimension" },
    "xs": { "$value": "0.75rem", "$type": "dimension" },
    "sm": { "$value": "1rem", "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem", "$type": "dimension" },
    "xl": { "$value": "3rem", "$type": "dimension" },
    "2xl": { "$value": "4rem", "$type": "dimension" }
  },
  "duration": {
    "fast": { "$value": "160ms", "$type": "duration" },
    "base": { "$value": "220ms", "$type": "duration" },
    "slow": { "$value": "300ms", "$type": "duration" }
  }
}
```

### shadcn/ui

```css
:root {
  --background: var(--color-paper);
  --foreground: var(--color-ink);
  --card: var(--color-paper-2);
  --card-foreground: var(--color-ink);
  --popover: var(--color-paper-2);
  --popover-foreground: var(--color-ink);
  --primary: var(--color-accent);
  --primary-foreground: var(--color-accent-ink);
  --secondary: var(--color-paper-3);
  --secondary-foreground: var(--color-ink);
  --muted: var(--color-paper-3);
  --muted-foreground: var(--color-muted);
  --accent: var(--color-rule-2);
  --accent-foreground: var(--color-ink);
  --border: var(--color-rule-2);
  --input: var(--color-rule);
  --ring: var(--color-focus);
  --radius: var(--radius-card);
}
```
