import { useEffect, useMemo, useState } from 'react'
import type { Collection, GraphSnapshot, PluginVersion, Review, ReviewSummary, RiskLevel, SearchHit } from '@dsh-workshop/domain'
import {
  ApiError,
  catalogInfo,
  collectionDetails,
  collections,
  companionEnvironment,
  confirmDryRun,
  createPlan,
  pluginGraph,
  pluginReviews,
  searchPlugins,
  type CatalogInfo,
  type CompanionEnvironment,
  type InstallPlan,
  type ResolvedCollection,
} from './api.js'
import { GraphView } from './GraphView.js'

type Screen = 'catalog' | 'collections'

interface PluginDetailState {
  hit: SearchHit
  graph?: GraphSnapshot
  review?: { summary: ReviewSummary; items: readonly Review[] }
}

const riskName: Record<RiskLevel, string> = {
  low: '低风险',
  moderate: '中等风险',
  high: '高风险',
  critical: '严重风险',
}

function score(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—'
}

function versionOf(hit: SearchHit): PluginVersion | undefined {
  return hit.selectedVersion ?? hit.plugin.versions[0]
}

function permissionCount(version: PluginVersion | undefined): number {
  if (version === undefined) return 0
  return Object.values(version.permissions).filter(permission => permission.required || permission.items.length > 0).length
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) return `${cause.message}（${cause.code}）`
  if (cause instanceof Error) return cause.message
  return '发生未知错误'
}

export function App() {
  const [screen, setScreen] = useState<Screen>('catalog')
  const [info, setInfo] = useState<CatalogInfo>()
  const [hits, setHits] = useState<readonly SearchHit[]>([])
  const [collectionList, setCollectionList] = useState<readonly Collection[]>([])
  const [selectedCollection, setSelectedCollection] = useState<ResolvedCollection>()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [maxRisk, setMaxRisk] = useState<'' | RiskLevel>('')
  const [sort, setSort] = useState('trusted')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string>()
  const [detail, setDetail] = useState<PluginDetailState>()
  const [companion, setCompanion] = useState<CompanionEnvironment>()
  const [companionToken, setCompanionToken] = useState(() => sessionStorage.getItem('dsh-companion-token') ?? '')
  const [profile, setProfile] = useState('web')
  const [plan, setPlan] = useState<InstallPlan>()
  const [operation, setOperation] = useState<{ operationId: string; state: string; receipt: { receiptId: string } }>()

  const popularTags = useMemo(() => info?.tags.slice(0, 14) ?? [], [info])

  useEffect(() => {
    void Promise.all([catalogInfo(), collections(), companionEnvironment().catch(() => undefined)])
      .then(([nextInfo, nextCollections, nextCompanion]) => {
        setInfo(nextInfo)
        setCollectionList(nextCollections.items)
        setCompanion(nextCompanion)
        if (nextCompanion?.environment.profiles[0] !== undefined) setProfile(nextCompanion.environment.profiles[0])
      })
      .catch(cause => setMessage(errorMessage(cause)))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true)
      void searchPlugins({ q: query, tag, maxRisk, sort })
        .then(result => setHits(result.items))
        .catch(cause => setMessage(errorMessage(cause)))
        .finally(() => setLoading(false))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query, tag, maxRisk, sort])

  async function openPlugin(hit: SearchHit): Promise<void> {
    setPlan(undefined)
    setOperation(undefined)
    setDetail({ hit })
    const selectedVersion = versionOf(hit)
    const [graphResult, reviewResult] = await Promise.all([
      pluginGraph(hit.plugin.id).catch(() => undefined),
      selectedVersion === undefined ? undefined : pluginReviews(selectedVersion.id).catch(() => undefined),
    ])
    setDetail(current => current?.hit.plugin.id === hit.plugin.id
      ? { ...current, ...(graphResult === undefined ? {} : { graph: graphResult.graph }), ...(reviewResult === undefined ? {} : { review: reviewResult }) }
      : current)
  }

  async function openCollection(id: string): Promise<void> {
    try {
      setSelectedCollection(await collectionDetails(id))
    } catch (cause) {
      setMessage(errorMessage(cause))
    }
  }

  function rememberToken(value: string): void {
    setCompanionToken(value)
    if (value === '') sessionStorage.removeItem('dsh-companion-token')
    else sessionStorage.setItem('dsh-companion-token', value)
  }

  async function generatePlan(): Promise<void> {
    const selectedVersion = detail === undefined ? undefined : versionOf(detail.hit)
    if (selectedVersion === undefined) return
    if (companionToken.trim() === '') {
      setMessage('请粘贴 Companion 启动时输出的 Local token。token 只保存在当前浏览器会话。')
      return
    }
    try {
      setMessage(undefined)
      setOperation(undefined)
      setPlan(await createPlan(selectedVersion.id, profile, companionToken.trim()))
    } catch (cause) {
      setMessage(errorMessage(cause))
    }
  }

  async function runDryRun(): Promise<void> {
    if (plan === undefined) return
    try {
      setOperation(await confirmDryRun(plan, companionToken.trim()))
    } catch (cause) {
      setMessage(errorMessage(cause))
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen('catalog')}>
          <span className="brand-mark">DSH</span>
          <span><strong>Creative Workshop</strong><small>插件发现与安装计划</small></span>
        </button>
        <nav aria-label="主导航">
          <button className={screen === 'catalog' ? 'active' : ''} onClick={() => setScreen('catalog')}>浏览插件</button>
          <button className={screen === 'collections' ? 'active' : ''} onClick={() => setScreen('collections')}>合集</button>
        </nav>
        <div className={`companion-status ${companion === undefined ? 'offline' : 'online'}`}>
          <span />{companion === undefined ? 'Companion 未连接' : `本机 ${companion.environment.os}/${companion.environment.arch}`}
        </div>
      </header>

      <main>
        {message !== undefined && <div className="notice" role="alert"><span>{message}</span><button onClick={() => setMessage(undefined)}>关闭</button></div>}

        {screen === 'catalog' ? (
          <>
            <section className="hero">
              <p className="eyebrow">CATALOG REVISION {info?.catalogRevision ?? '加载中'}</p>
              <h1>把 DSH 插件变成<br /><em>可比较、可组合、可验证</em>的作品。</h1>
              <p>标准化权限与兼容性，展示真实关系，通过本机安全边界生成确定性的安装计划。</p>
              <div className="metrics">
                <span><strong>{info?.counts.plugins ?? '—'}</strong> 插件</span>
                <span><strong>{info?.counts.collections ?? '—'}</strong> 合集</span>
                <span><strong>{info?.counts.reviews ?? '—'}</strong> 结构化评价</span>
              </div>
            </section>

            <section className="discovery">
              <div className="search-row">
                <label className="search-box"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称、能力、发布者或标签…" /></label>
                <select value={sort} onChange={event => setSort(event.target.value)} aria-label="排序">
                  <option value="trusted">可信度优先</option><option value="relevance">相关度优先</option><option value="rating">评分优先</option><option value="recent">最新发布</option>
                </select>
                <select value={maxRisk} onChange={event => setMaxRisk(event.target.value as '' | RiskLevel)} aria-label="风险上限">
                  <option value="">全部风险</option><option value="low">仅低风险</option><option value="moderate">最高中等</option><option value="high">最高高风险</option>
                </select>
              </div>
              <div className="tag-cloud" aria-label="常用标签">
                <button className={tag === '' ? 'active' : ''} onClick={() => setTag('')}>全部</button>
                {popularTags.map(item => <button key={item} className={tag === item ? 'active' : ''} onClick={() => setTag(tag === item ? '' : item)}>{item}</button>)}
              </div>
            </section>

            <section className="catalog-section">
              <div className="section-title"><div><p className="eyebrow">DISCOVER</p><h2>{tag === '' ? '社区作品' : tag}</h2></div><span>{loading ? '检索中…' : `${hits.length} 项结果`}</span></div>
              <div className="plugin-grid">
                {hits.map(hit => {
                  const version = versionOf(hit)
                  return (
                    <article className="plugin-card" key={hit.plugin.id}>
                      <button className="card-main" onClick={() => void openPlugin(hit)}>
                        <div className="card-top"><span className={`risk ${hit.risk}`}>{riskName[hit.risk]}</span><span className="version">v{version?.version}</span></div>
                        <div className="plugin-icon">{hit.plugin.name.slice(0, 2).toUpperCase()}</div>
                        <h3>{hit.plugin.name}</h3><p className="publisher">{hit.plugin.publisher}</p><p className="summary">{hit.plugin.summary}</p>
                        <div className="card-tags">{hit.plugin.tags.slice(0, 3).map(item => <span key={item}>{item}</span>)}</div>
                      </button>
                      <footer><span className="rating">★ {score(hit.plugin.review.score)}</span><span>{hit.plugin.review.verifiedCount}/{hit.plugin.review.count} 已验证</span><span>{permissionCount(version)} 权限域</span></footer>
                    </article>
                  )
                })}
              </div>
              {!loading && hits.length === 0 && <div className="empty">没有匹配项。可以清空标签或放宽风险上限。</div>}
            </section>
          </>
        ) : (
          <section className="collections-page">
            <p className="eyebrow">CURATED SETS</p><h1>合集</h1><p className="lead">合集固定成员版本、安装顺序和汇总权限，不是一个易失的收藏夹。</p>
            <div className="collection-layout">
              <div className="collection-list">
                {collectionList.map(item => <button key={item.id} className={selectedCollection?.collection.id === item.id ? 'active' : ''} onClick={() => void openCollection(item.id)}><strong>{item.name}</strong><span>{item.summary}</span><small>{item.releases[0]?.members.length ?? 0} 个成员 · {item.maintainer}</small></button>)}
              </div>
              <div className="collection-detail">
                {selectedCollection === undefined ? <div className="empty">选择一个合集查看固定版本与顺序。</div> : <>
                  <p className="eyebrow">RELEASE {selectedCollection.release.version}</p><h2>{selectedCollection.collection.name}</h2>
                  <ol className="member-list">{selectedCollection.members.map(member => <li key={member.version.id}><span>{member.order}</span><div><strong>{member.plugin.name}</strong><small>{member.version.packageManagerSpec}</small></div><em>{member.role}</em></li>)}</ol>
                  <p className="digest">目标 profile：{selectedCollection.release.targetProfile} · DSH {selectedCollection.release.dshRange}</p>
                </>}
              </div>
            </div>
          </section>
        )}
      </main>

      {detail !== undefined && <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDetail(undefined) }}>
        <aside className="drawer" aria-label={`${detail.hit.plugin.name} 详情`}>
          <button className="close" onClick={() => setDetail(undefined)} aria-label="关闭">×</button>
          <div className="detail-head"><div className="plugin-icon large">{detail.hit.plugin.name.slice(0, 2).toUpperCase()}</div><div><p className="eyebrow">{detail.hit.plugin.kind}</p><h2>{detail.hit.plugin.name}</h2><p>{detail.hit.plugin.publisher} · v{versionOf(detail.hit)?.version}</p></div></div>
          <p className="detail-description">{detail.hit.plugin.description}</p>
          <div className="facts"><span><small>风险</small><strong>{riskName[detail.hit.risk]}</strong></span><span><small>社区评分</small><strong>★ {score(detail.review?.summary.score ?? detail.hit.plugin.review.score)}</strong></span><span><small>验证证据</small><strong>{versionOf(detail.hit)?.evidence[0]?.level ?? '—'}</strong></span></div>

          <section className="drawer-section"><h3>权限与兼容性</h3><div className="permission-list">{versionOf(detail.hit) !== undefined && Object.entries(versionOf(detail.hit)!.permissions).map(([scope, permission]) => <div key={scope} className={permission.required || permission.items.length > 0 ? 'declared' : ''}><strong>{scope}</strong><span>{permission.items.length === 0 ? '未声明访问' : permission.items.join(' · ')}</span></div>)}</div><p className="compat">{versionOf(detail.hit)?.compatibility.os.join(' / ')} · {versionOf(detail.hit)?.compatibility.arch.join(' / ')} · DSH {versionOf(detail.hit)?.compatibility.dsh}</p></section>
          <section className="drawer-section"><h3>关系网络</h3>{detail.graph === undefined ? <p className="muted">正在读取关系…</p> : <GraphView graph={detail.graph} />}</section>
          <section className="drawer-section"><h3>动态评价</h3>{detail.review?.items.length === 0 ? <p className="muted">暂无评价。</p> : detail.review?.items.map(review => <article className="review" key={review.id}><header><strong>{review.author}</strong><span>{review.receiptBacked ? '✓ 安装回执已验证' : '未验证体验'}</span></header><p>{review.body}</p></article>) ?? <p className="muted">正在读取评价…</p>}</section>
          <section className="install-panel">
            <div><p className="eyebrow">LOCAL PLAN</p><h3>生成本机安装计划</h3><p>{companion === undefined ? '请先启动 Companion。计划不会修改本机状态。' : `Companion 已连接，当前仅提供 ${companion.mode}。`}</p></div>
            <label>Profile<input value={profile} onChange={event => setProfile(event.target.value)} /></label>
            <label>Local token<input type="password" value={companionToken} onChange={event => rememberToken(event.target.value)} placeholder="Companion 启动时输出" /></label>
            <button className="primary" disabled={companion === undefined} onClick={() => void generatePlan()}>一键生成计划</button>
            {plan !== undefined && <div className="plan-card"><header><strong>{plan.rootPlugin.name} {plan.rootPlugin.version}</strong><span>DRY-RUN</span></header><p>固定 {plan.changes.length} 项变更 · {plan.permissionsAdded.length} 个权限域</p><ol>{plan.changes.map(change => <li key={change.pluginId}><code>{change.packageSpec}</code>{change.dependencyOf !== undefined && <small>依赖于 {change.dependencyOf}</small>}</li>)}</ol>{plan.warnings.map(item => <p className="warning" key={item}>{item}</p>)}<button className="secondary" onClick={() => void runDryRun()}>确认并执行 dry-run</button></div>}
            {operation !== undefined && <div className="success"><strong>{operation.state}</strong><span>操作 {operation.operationId}</span><span>回执 {operation.receipt.receiptId}</span></div>}
          </section>
        </aside>
      </div>}
    </div>
  )
}
