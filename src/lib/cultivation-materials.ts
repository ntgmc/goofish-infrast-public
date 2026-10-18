import type { CultivationData } from './cultivation-contract'

type Recipe = CultivationData['recipes'][string]
export type MaterialIngredient = {
  id: string
  count: number
  ingredients: MaterialIngredient[]
  cycle: boolean
  conversion?: { id: string; count: number; output: number }
}

export function buildMaterialRoutes(id: string, count: number, data: Pick<CultivationData, 'recipes'>) {
  const recipes: Record<string, Recipe> = { ...data.recipes, '32001': { count: 1, items: { '4006': 90 } } }
  const isConversion = (product: string, recipe: Recipe) => {
    const inputs = Object.keys(recipe.items)
    return recipe.count > 1 && inputs.length === 1 && Boolean(recipes[inputs[0]]?.items[product])
  }
  const expand = (item: string, amount: number, path: Set<string>): MaterialIngredient => {
    const node: MaterialIngredient = { id: item, count: amount, ingredients: [], cycle: path.has(item) }
    const recipe = recipes[item]
    if (!recipe || node.cycle) return node
    // Chip exchanges are an optional source, not ingredients that must be farmed recursively.
    if (isConversion(item, recipe)) {
      const [input, quantity] = Object.entries(recipe.items)[0]
      node.conversion = { id: input, count: quantity, output: recipe.count }
      return node
    }
    const batches = Math.ceil(amount / recipe.count - 1e-8)
    node.ingredients = Object.entries(recipe.items).map(([input, quantity]) => expand(input, quantity * batches, new Set(path).add(item)))
    return node
  }
  const products: Array<{ id: string; recipe: Recipe }> = []
  const seen = new Set([id])
  const queue = [id]
  for (const item of queue) {
    for (const [product, recipe] of Object.entries(recipes)) {
      if (!recipe.items[item] || isConversion(product, recipe) || seen.has(product)) continue
      seen.add(product)
      queue.push(product)
      products.push({ id: product, recipe })
    }
  }
  return { ingredient: expand(id, count, new Set()), products }
}
