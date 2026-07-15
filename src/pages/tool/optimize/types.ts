import type { OptimizeSection } from '../../../lib/app-routes'
import { copy } from '../../../copy/index'


export type { OptimizeSection } from '../../../lib/app-routes'

export type OptimizePhase = 'idle' | 'history' | 'suggestions' | 'final'

export const OPTIMIZE_SECTIONS: Array<{
  id: OptimizeSection;
  label: string;
  description: string;
}> = [
  { id: 'overview', label: copy.optimize.pages_tool_optimize_types_001, description: copy.optimize.pages_tool_optimize_types_002 },
  { id: 'plans', label: copy.optimize.pages_tool_optimize_types_003, description: copy.optimize.pages_tool_optimize_types_004 },
  { id: 'config', label: copy.optimize.pages_tool_optimize_types_005, description: copy.optimize.pages_tool_optimize_types_006 },
  { id: 'result', label: copy.optimize.pages_tool_optimize_types_007, description: copy.optimize.pages_tool_optimize_types_008 },
  { id: 'lab', label: copy.optimize.pages_tool_optimize_types_009, description: copy.optimize.pages_tool_optimize_types_010 },
]

export type ValidationState = { ok: true } | { ok: false; message: string }
