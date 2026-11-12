import type { CultivationData } from './cultivation-contract'

type Recipe = CultivationData['recipes'][string]
export type MaterialIngredient = {
  id: string
  count: number
  ingredients: MaterialIngredient[]
  cycle: boolean
  conversion?: { id: string; count: number; output: number }
}

export function isMaterialFee(id: string) {
  return id === '4001' || id === '4006' || id === 'exp'
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

export type MaterialGraphNode = {
  key: string
  id: string
  count: number
  column: number
  kind: 'ingredient' | 'selected' | 'product'
  fees: Record<string, number>
  extra: Record<string, number>
  cycle: boolean
  conversion?: MaterialIngredient['conversion']
}

export function buildMaterialGraph(id: string, count: number, data: Pick<CultivationData, 'recipes'>) {
  const routes = buildMaterialRoutes(id, count, data)
  const nodes: MaterialGraphNode[] = []
  const edges: Array<{ from: string; to: string }> = []
  const fees = (items: Record<string, number>) => Object.fromEntries(Object.entries(items).filter(([item]) => isMaterialFee(item)))
  const addIngredient = (item: MaterialIngredient, key: string): MaterialGraphNode => {
    const inputs = item.ingredients.filter((input) => !isMaterialFee(input.id)).map((input) => addIngredient(input, `${key}/${input.id}`))
    const node: MaterialGraphNode = { key, id: item.id, count: item.count, column: inputs.length ? Math.max(...inputs.map((input) => input.column)) + 1 : 0,
      kind: key === 'selected' ? 'selected' : 'ingredient', fees: fees(Object.fromEntries(item.ingredients.map((input) => [input.id, input.count]))), extra: {}, cycle: item.cycle, conversion: item.conversion }
    nodes.push(node)
    for (const input of inputs) edges.push({ from: input.key, to: node.key })
    return node
  }
  const selected = addIngredient(routes.ingredient, 'selected')
  const alignIngredients = (item: MaterialIngredient, key: string, column: number) => {
    nodes.find((node) => node.key === key)!.column = column
    for (const input of item.ingredients.filter((input) => !isMaterialFee(input.id))) alignIngredients(input, `${key}/${input.id}`, column - 1)
  }
  alignIngredients(routes.ingredient, 'selected', selected.column)
  const recipes = new Map(routes.products.map((product) => [product.id, product.recipe]))
  const products = new Map<string, MaterialGraphNode>([[id, selected]])
  const addProduct = (item: string, path: Set<string>): MaterialGraphNode | null => {
    if (products.has(item)) return products.get(item)!
    if (path.has(item)) return null
    const recipe = recipes.get(item)!
    const inputs = Object.keys(recipe.items).filter((input) => input === id || recipes.has(input))
      .map((input) => addProduct(input, new Set(path).add(item))).filter((input) => input !== null)
    const node: MaterialGraphNode = { key: `product/${item}`, id: item, count: recipe.count,
      column: Math.max(selected.column, ...inputs.map((input) => input.column)) + 1, kind: 'product', fees: fees(recipe.items), cycle: false,
      extra: Object.fromEntries(Object.entries(recipe.items).filter(([input]) => !isMaterialFee(input))) }
    nodes.push(node)
    products.set(item, node)
    for (const input of inputs) edges.push({ from: input.key, to: node.key })
    return node
  }
  for (const product of routes.products) addProduct(product.id, new Set())
  return { nodes, edges }
}
