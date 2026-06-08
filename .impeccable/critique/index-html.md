---
target: D:\GITHOME\goofish-infrast-v1\index.html
slug: index-html
date: 2026-06-04
score: 42
p0: 5
p1: 4
p2: 3
register: product
assessment_independence: degraded (sub-agents not requested)
---

# Critique Snapshot: MAA 基建排班优化器

## Overall Score: 42/100

## AI Slop Verdict

**Pass (borderline).** The UI is functional and avoids the worst AI tells (no gradient text, no glassmorphism, no hero-metric template). However, the monochromatic gray palette with blue-600 accent is the generic TailwindCSS dark-mode default. Someone familiar with AI-generated UIs would recognize the pattern but not be distracted by it. The emoji usage (🚀, 📋, 💾, 🤖) is acceptable for a game tool but borders on AI-typical.

## Nielsen Heuristic Scores

1. **Visibility of system status**: 2/4 - Loading states exist ("验证中..", "正在分析基建潜力...") but are basic text changes. No skeleton screens, no progress indicators for the optimization API call.
2. **Match between system and real world**: 2/4 - Uses game terminology (干员, 精英化, 基建) correctly, but no visual connection to Arknights brand. The tool feels generic rather than game-specific.
3. **User control and freedom**: 2/4 - Has "退出登录" reset button, but no undo for applied elite upgrades. Once suggestions are applied, reverting requires re-uploading.
4. **Consistency and standards**: 2/4 - TailwindCSS provides visual consistency, but button styles vary (blue-600 for primary, gray-700 for secondary, green-600 for apply). The blue button in header vs blue button in content creates ambiguity.
5. **Error prevention**: 1/4 - Minimal validation. No confirmation before applying elite upgrades. No warning about irreversible actions. File upload accepts any .maa file without size limits.
6. **Recognition rather than recall**: 2/4 - Room labels (贸易站, 制造站) help, but operator images are optional (loaded from /webp96/ with fallback). Users must remember which operators they have.
7. **Flexibility and efficiency of use**: 1/4 - No keyboard shortcuts, no batch selection for upgrades, no way to sort/filter suggestions. Power users have no efficiency paths.
8. **Aesthetic and minimalist design**: 2/4 - Clean layout but extremely generic. The gray-800/gray-900 dark theme with blue accent is the AI default. No brand personality.
9. **Help users recognize, diagnose, and recover from errors**: 2/4 - Error display exists (red-900/50 background) but messages are technical ("授权文件解密失败"). No guidance on what to do next.
10. **Help and documentation**: 1/4 - No help text, no tooltips, no onboarding. First-time users must figure out what .maa files are and where to get them.

**Total: 17/40**

## Cognitive Load Assessment

### Intrinsic Load
- **Task complexity**: Medium. Users need to understand MAA file format, elite levels, and optimization concepts.
- **Chunking**: Good. The two-step flow (upload → optimize) chunks the task well.
- **Decision points**: The upgrade suggestions page presents up to 20 options simultaneously, which exceeds the 4-option threshold for cognitive overload.

### Germane Load
- **Prior knowledge required**: High. Users must know what .maa files are, understand elite levels (精0/精1/精2), and trust the optimization algorithm.
- **Onboarding**: None. No explanation of what the tool does or how to use it.

### Extraneous Load
- **Visual noise**: Low. The UI is clean but lacks visual hierarchy.
- **Irrelevant information**: The "buildingType" number displayed prominently has no explanation.

## Emotional Journey

- **Upload**: Neutral to anxious (will my file work?)
- **Optimize trigger**: Hopeful (clicking "生成排班方案")
- **Suggestions**: Overwhelmed (many options, unclear which to pick)
- **Results**: Satisfied or confused (numbers without context)
- **Download**: Accomplished (task complete)

**Peak-end rule**: The peak is the optimization result, but the end (downloading JSON) is anticlimactic. No celebration or confirmation.

## Personas

### Alex (Power User)
- **Red flags**: No keyboard shortcuts, no batch operations, no API documentation
- **Pain points**: Cannot sort suggestions by gain, cannot filter by operator type

### Sam (Accessibility)
- **Red flags**: No ARIA labels on file upload, no focus indicators, emoji-only status indicators
- **Pain points**: Cannot complete flow keyboard-only, contrast issues with gray-400 text

### Casey (Mobile User)
- **Red flags**: Touch targets may be too small, no offline capability
- **Pain points**: Large download button is reachable, but the upload area is small

### Arknights Player (Project-Specific)
- **Red flags**: No visual connection to Arknights brand, no operator portraits in main view
- **Pain points**: Must trust the optimization without seeing the algorithm, cannot compare before/after

## Strengths

1. **Clear two-step flow**: Upload → Optimize is intuitive and well-chunked
2. **Dark theme appropriate**: Fits game context and reduces eye strain
3. **Clean code structure**: TypeScript types are well-defined, component separation is logical

## Priority Issues

### P0 (Must Fix)

1. **No onboarding or help text**: First-time users have no guidance on what .maa files are or where to get them. Add a brief explanation or link to MAA documentation.
2. **No confirmation before applying upgrades**: The "应用选中建议" button modifies elite levels without confirmation. Add a confirmation dialog showing what will change.
3. **Accessibility gaps**: File upload has no ARIA label, no keyboard alternative to drag & drop, no focus indicators. Screen reader users cannot complete the flow.
4. **Error messages are technical**: "授权文件解密失败" doesn't help users understand what went wrong. Provide actionable guidance.
5. **No loading skeleton**: The optimize page shows a static button while the API call runs. Use skeleton states for the results area.

### P1 (Should Fix)

1. **Generic visual identity**: The gray-800/gray-900 palette with blue-600 accent is the AI default. Add brand colors or Arknights-inspired accents.
2. **No visual hierarchy**: All text is similar size/weight. The title, subtitle, and body text need clearer scale contrast.
3. **Upgrade suggestions overwhelm**: Up to 20 options shown at once. Add pagination, filtering, or grouping by gain level.
4. **No operator context**: Suggestions show operator names but no portraits, rarity, or current elite level in the main list.

### P2 (Nice to Have)

1. **No keyboard shortcuts**: Power users have no efficiency paths (Ctrl+Enter to generate, etc.)
2. **No export format options**: Only JSON export. Consider CSV or direct MAA integration.
3. **No dark/light theme toggle**: Some users may prefer light theme.
4. **No offline capability**: The tool requires network for optimization API.

## Provocative Questions

1. If a user has 50+ operators, how do they efficiently select which upgrades to apply?
2. What happens if the optimization API is down? Is there a fallback or offline mode?
3. How does a user know if the optimization is actually better than their current setup?
4. What if two users share the same account? Is there conflict resolution?
5. How do you handle operators that the user doesn't own but are suggested for upgrade?
