import type { ReactNode } from 'react'
import type { OptimizeResult } from '../../lib/types'

export interface ResultPanelProps {
  result: OptimizeResult;
  onDownload?: () => void;
  onSaveWorkfile?: () => void;
  detailDefaultOpen?: boolean;
  variant?: 'optimize' | 'analysis';
  suggestionsSlot?: ReactNode;
}

export type RoomRow = {
  key: string;
  label: string;
  indexLabel: string;
  product: string;
  operators: string;
  efficiency: string;
  speedEfficiency: string;
  detail: string;
  hasAdjustedSpeed: boolean;
}

export type PreparedPlan = OptimizeResult['plans'][number] & {
  rows: RoomRow[];
}

export type ResultTabId = 'data' | 'detail' | 'import' | 'suggestions'
