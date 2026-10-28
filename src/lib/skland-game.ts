export type SklandRoom = {
  id: string
  type: 'control' | 'trading' | 'manufacture' | 'power' | 'dormitory' | 'meeting' | 'hire' | 'training'
  level: number
  operators: { id: string; name: string; morale: number | null }[]
  product: string | null
  stock: number | null
  capacity: number | null
  completeAt: number | null
  comfort: number | null
}

export type SklandGame = {
  currentTs: number | null
  player: { name: string | null; level: number | null; mainStage: string | null; lastOnline: number | null; dataAt: number | null;
    operators: number | null; skins: number | null; furniture: number | null; sanity: { current: number; max: number; completeAt: number | null } | null }
  campaign: { current: number; total: number } | null
  tower: { higher: { current: number; total: number } | null; lower: { current: number; total: number } | null } | null
  recruit: { state: number; finishAt: number | null }[] | null
  routine: { daily: { current: number; total: number } | null; weekly: { current: number; total: number } | null }
  building: { rooms: SklandRoom[]; drones: { current: number; max: number } | null; tired: number | null;
    clues: { owned: number | null; received: number | null; board: number | null; sharing: boolean | null; shareCompleteAt: number | null } | null;
    training: { trainee: string | null; trainer: string | null; remaining: number | null } | null } | null
}
