import type { ReactNode } from 'react'
import type { LicenseOperator, OptimizeResult, RawPermissionMode, UserGameAccountKind } from '../../lib/types'

export interface ResultPanelProps {
  result: OptimizeResult;
  operators?: LicenseOperator[];
  onDownload?: () => void;
  onDownloadFullResult?: () => void;
  downloadBusy?: boolean;
  fullResultDownloadBusy?: boolean;
  fullDataAvailable?: boolean;
  onSaveWorkfile?: () => void;
  detailDefaultOpen?: boolean;
  suggestionsSlot?: ReactNode;
  manualPreviewSlot?: ReactNode;
  previewLimit?: OptimizeResult['preview_limit'];
  manualEditProfile?: { id: string; kind: UserGameAccountKind; permission: RawPermissionMode };
  manualSimulationBaseline?: { id: string; config: import('../../lib/types').LicenseConfig };
}

export type RoomOperator = {
  recoverySupport?: boolean;
  name: string;
  id?: string;
  elite?: number;
  level?: number | string;
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

export type ResultTabId = 'board' | 'board-v2' | 'manual' | 'data' | 'detail' | 'import' | 'suggestions'
