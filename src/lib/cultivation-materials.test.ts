import { expect, it } from 'vitest'
import { buildMaterialGraph, buildMaterialRoutes } from './cultivation-materials'

it('expands every ingredient tier with whole recipe batches and follows all later products', () => {
  const data = { recipes: {
    middle: { count: 2, items: { raw: 3 } },
    selected: { count: 1, items: { middle: 3, '4001': 100 } },
    left: { count: 1, items: { selected: 2, other: 1 } },
    right: { count: 1, items: { selected: 1 } },
    final: { count: 1, items: { left: 1, right: 1 } },
    unrelated: { count: 1, items: { other: 2 } },
  } }
  const route = buildMaterialRoutes('selected', 3, data)
  expect(route.ingredient.ingredients.find((node) => node.id === 'middle')).toMatchObject({ id: 'middle', count: 9, ingredients: [{ id: 'raw', count: 15 }] })
  expect(route.ingredient.ingredients.find((node) => node.id === '4001')).toMatchObject({ id: '4001', count: 300, ingredients: [] })
  expect(route.products.map((product) => product.id)).toEqual(['left', 'right', 'final'])
  expect(buildMaterialRoutes('4001', 300, data).products.map((product) => product.id)).toEqual(['selected', 'left', 'right', 'final'])
  expect(data.recipes.middle.items).toEqual({ raw: 3 })
})

it('includes chip packs and the entire catalyst exchange while keeping reciprocal chip conversions optional', () => {
  const data = { recipes: {
    '3243': { count: 1, items: { '3242': 2, '32001': 1 } },
    '3242': { count: 2, items: { '3252': 3 } },
    '3252': { count: 2, items: { '3242': 3 } },
  } }
  const route = buildMaterialRoutes('3243', 4, data)
  expect(route.ingredient.ingredients[0]).toMatchObject({ id: '3242', count: 8, ingredients: [], conversion: { id: '3252', count: 3, output: 2 } })
  expect(route.ingredient.ingredients[1]).toMatchObject({ id: '32001', count: 4, ingredients: [{ id: '4006', count: 360 }] })
  expect(buildMaterialRoutes('4006', 90, data).products.map((product) => product.id)).toEqual(['32001', '3243'])
})

it('places ingredients before their products, merges downstream branches and keeps fees beside their material', () => {
  const data = { recipes: {
    middle: { count: 2, items: { raw: 3, '4001': 50 } },
    selected: { count: 1, items: { middle: 3, '4001': 100 } },
    left: { count: 1, items: { selected: 2, other: 1 } },
    right: { count: 1, items: { selected: 1 } },
    final: { count: 1, items: { left: 1, right: 1, selected: 1 } },
  } }
  const graph = buildMaterialGraph('selected', 3, data)
  const selected = graph.nodes.find((node) => node.kind === 'selected')!
  expect(selected.fees).toEqual({ '4001': 300 })
  expect(graph.nodes.some((node) => node.id === '4001')).toBe(false)
  expect(graph.nodes.find((node) => node.id === 'raw')).toMatchObject({ count: 15, column: 0 })
  expect(graph.nodes.find((node) => node.id === 'middle')).toMatchObject({ count: 9, column: 1, fees: { '4001': 250 } })
  expect(graph.nodes.find((node) => node.id === 'final')).toMatchObject({ column: 4, count: 1, kind: 'product' })
  expect(graph.nodes.find((node) => node.id === 'left')?.extra).toEqual({ selected: 2, other: 1 })
  for (const edge of graph.edges) {
    const from = graph.nodes.find((node) => node.key === edge.from)!, to = graph.nodes.find((node) => node.key === edge.to)!
    expect(from.column).toBeLessThan(to.column)
  }
  expect(graph.edges.filter((edge) => edge.to === 'product/final').map((edge) => edge.from).sort()).toEqual(['product/left', 'product/right', 'selected'])
})

it('retains currency entry points and optional chip conversions without expanding cycles into the graph', () => {
  const data = { recipes: { '3243': { count: 1, items: { '3242': 2, '32001': 1 } }, '3242': { count: 2, items: { '3252': 3 } }, '3252': { count: 2, items: { '3242': 3 } } } }
  const graph = buildMaterialGraph('3243', 4, data)
  expect(graph.nodes.find((node) => node.id === '3242')).toMatchObject({ conversion: { id: '3252', count: 3, output: 2 } })
  expect(graph.nodes.some((node) => node.id === '3252')).toBe(false)
  expect(graph.nodes.find((node) => node.id === '32001')?.fees).toEqual({ '4006': 360 })
  expect(buildMaterialGraph('4006', 90, data).nodes[0]).toMatchObject({ id: '4006', kind: 'selected', count: 90 })
  const cyclic = buildMaterialGraph('a', 1, { recipes: { a: { count: 1, items: { b: 1 } }, b: { count: 1, items: { a: 1 } } } })
  expect(cyclic.nodes.some((node) => node.cycle)).toBe(true)
  expect(cyclic.nodes).toHaveLength(4)
})

it('terminates cyclic source data without dropping other branches or repeating later products', () => {
  const data = { recipes: {
    a: { count: 1, items: { b: 1, raw: 2 } },
    b: { count: 1, items: { a: 1 } },
    final: { count: 1, items: { a: 1, b: 1 } },
  } }
  const route = buildMaterialRoutes('a', 1, data)
  expect(route.ingredient.ingredients[0].ingredients[0]).toMatchObject({ id: 'a', cycle: true, ingredients: [] })
  expect(route.ingredient.ingredients[1]).toMatchObject({ id: 'raw', count: 2 })
  expect(route.products.map((product) => product.id)).toEqual(['b', 'final'])
})
