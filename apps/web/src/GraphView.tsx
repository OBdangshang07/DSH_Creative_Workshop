import type { GraphSnapshot } from '@dsh-workshop/domain'

export function GraphView({ graph }: { graph: GraphSnapshot }) {
  if (graph.nodes.length <= 1) return <p className="muted">此版本没有声明外部关系。</p>
  const root = graph.nodes[0]
  const targets = graph.nodes.slice(1)
  const width = 680
  const height = Math.max(240, targets.length * 72 + 40)
  return (
    <div className="graph-scroll">
      <svg className="graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="插件关系图">
        {targets.map((node, index) => {
          const y = 55 + index * 72
          const edge = graph.edges.find(item => item.to === node.id)
          return (
            <g key={node.id}>
              <path d={`M 224 ${height / 2} C 310 ${height / 2}, 320 ${y}, 405 ${y}`} className="graph-edge" />
              <text x="315" y={y - 7} textAnchor="middle" className="edge-label">{edge?.label}</text>
              <rect x="405" y={y - 24} width="242" height="48" rx="12" className={`graph-node ${node.kind}`} />
              <text x="422" y={y - 2} className="node-label">{node.label}</text>
              <text x="422" y={y + 14} className="node-kind">{node.kind}</text>
            </g>
          )
        })}
        <rect x="18" y={height / 2 - 31} width="206" height="62" rx="14" className="graph-node root" />
        <text x="35" y={height / 2 - 3} className="node-label root-label">{root?.label}</text>
        <text x="35" y={height / 2 + 16} className="node-kind">当前插件</text>
      </svg>
    </div>
  )
}
