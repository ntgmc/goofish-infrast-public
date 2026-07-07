import type { ReactNode } from 'react'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'

export interface ResultPanelProps {
  result: OptimizeResult;
  operators?: LicenseOperator[];
  onDownload?: () => void;
  onSaveWorkfile?: () => void;
  detailDefaultOpen?: boolean;
  variant?: 'optimize' | 'analysis';
  suggestionsSlot?: ReactNode;
}

export type RoomOperator = {
  name: string;
  id?: string;
}

export type RoomRow = {
  key: string;
  label: string;
  indexLabel: string;
  roomType: string;
  roomIndex: number;
  queueLabel: string;
  product: string;
  operators: RoomOperator[];
  operatorText: string;
  efficiency: string;
  speedEfficiency: string;
  detail: string;
  detailItems: string[];
  hasAdjustedSpeed: boolean;
  isAutofill?: boolean;
}

export type PreparedPlan = OptimizeResult['plans'][number] & {
  rows: RoomRow[];
}

export type ResultTabId = 'board' | 'data' | 'detail' | 'import' | 'suggestions'
