import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountStore } from './auth-store.js'

const MAX_MEDIA_BYTES = 4 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/png','image/jpeg','image/webp','image/gif'])
const FAILURE_BACKOFF_MS = 15 * 60_000

export class MediaUnavailableError extends Error {}

interface MediaServiceOptions {
  directory?: string
  fetcher?: typeof fetch
}

const xml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;',
}[character] as string))

function wrapTitle(value:string):string[] {
  const compact=value.trim()||'DSH Plugin'
  if(compact.length<=32)return[compact]
  const boundary=compact.lastIndexOf('-',32)>12?compact.lastIndexOf('-',32):32
  return[compact.slice(0,boundary),compact.slice(boundary).replace(/^-/,'')].filter(Boolean)
}

export class MediaService {
  private readonly memory = new Map<string,{body:Uint8Array;mime:string}>()
  private readonly fetcher:typeof fetch

  constructor(private readonly store:AccountStore,private readonly options:MediaServiceOptions={}) {
    this.fetcher=options.fetcher??fetch
  }

  async initialize():Promise<void>{if(this.options.directory)await mkdir(this.options.directory,{recursive:true})}

  coverSvg(pluginId:string):string|undefined {
    const source=this.store.publicMediaSource(pluginId,0)
    if(source===undefined)return undefined
    const plugin=source.record
    const hash=createHash('sha256').update(plugin.id).digest()
    const hue=(hash[0]??0)*360/255; const accent=(hue+42)%360
    const title=wrapTitle(plugin.name)
    const mediaUrl=`/api/v1/plugins/${encodeURIComponent(plugin.id)}/media/0`
    const remoteMedia=String(source.status)==='ready'?`<image href="${xml(mediaUrl)}" width="640" height="360" preserveAspectRatio="xMidYMid slice" opacity=".82"/>`:''
    const titleSvg=title.map((line,index)=>`<text x="34" y="${176+index*34}" font-family="Segoe UI,Noto Sans SC,sans-serif" font-size="${title.length>1?26:30}" font-weight="700" fill="#fff">${xml(line)}</text>`).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${xml(plugin.name)} cover">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 48% 16%)"/><stop offset="1" stop-color="hsl(${accent} 55% 8%)"/></linearGradient><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#07101a10"/><stop offset=".55" stop-color="#07101a66"/><stop offset="1" stop-color="#07101af5"/></linearGradient></defs>
      <rect width="640" height="360" fill="url(#g)"/><path d="M0 64H640M0 128H640M0 192H640M0 256H640M80 0V360M160 0V360M240 0V360M320 0V360M400 0V360M480 0V360M560 0V360" stroke="#fff" stroke-opacity=".045"/>
      ${remoteMedia}<rect width="640" height="360" fill="url(#shade)"/>
      <rect x="34" y="30" width="126" height="25" rx="3" fill="hsl(${accent} 82% 48%)"/><text x="47" y="47" font-family="ui-monospace,monospace" font-size="11" font-weight="700" fill="#07101a">DSH WORKSHOP</text>
      ${titleSvg}<text x="34" y="${title.length>1?266:230}" font-family="ui-monospace,monospace" font-size="13" fill="#9fdfff">${xml(plugin.packageName??plugin.fullName)}</text>
      <text x="34" y="326" font-family="ui-monospace,monospace" font-size="11" fill="#d5e1eb">${xml(plugin.kind)}  ·  ${xml(plugin.surfaces.join(' / ')||'headless')}</text><text x="606" y="326" text-anchor="end" font-family="ui-monospace,monospace" font-size="10" fill="#8297aa">${xml(plugin.verification.commitSha.slice(0,10))}</text>
    </svg>`
  }

  async asset(pluginId:string,index:number):Promise<{body:Uint8Array;mime:string;etag:string}> {
    const source=this.store.publicMediaSource(pluginId,index)
    if(source===undefined)throw new MediaUnavailableError('MEDIA_NOT_FOUND')
    const key=createHash('sha256').update(`${source.revision_id}:${index}:${source.source_url}`).digest('hex')
    const cached=await this.readCache(key,String(source.mime??''))
    if(cached!==undefined)return{...cached,etag:key}
    if(['fallback','failed'].includes(String(source.status))&&source.checked_at!==null&&Date.parse(String(source.checked_at))+FAILURE_BACKOFF_MS>Date.now())throw new MediaUnavailableError('MEDIA_RETRY_BACKOFF')
    try {
      const url=this.safeSourceUrl(String(source.source_url),String(source.full_name),String(source.record.verification.commitSha))
      const response=await this.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'image/webp,image/png,image/jpeg,image/gif'}})
      if(!response.ok)throw new Error(`HTTP_${response.status}`)
      const mime=String(response.headers.get('content-type')??'').split(';')[0]!.toLowerCase()
      if(!ALLOWED_MIME.has(mime))throw new Error('MEDIA_TYPE_DENIED')
      const declared=Number(response.headers.get('content-length')??0); if(declared>MAX_MEDIA_BYTES)throw new Error('MEDIA_TOO_LARGE')
      const body=await this.readLimited(response)
      await this.writeCache(key,body,mime)
      this.store.updateMediaState(String(source.revision_id),index,{status:'ready',cacheKey:key,mime,bytes:body.length})
      return{body,mime,etag:key}
    }catch(cause){
      const message=cause instanceof Error?cause.message:'MEDIA_FETCH_FAILED'
      this.store.updateMediaState(String(source.revision_id),index,{status:'fallback',error:message.slice(0,160)})
      throw new MediaUnavailableError(message)
    }
  }

  async clear(cacheKeys:string[]):Promise<void>{
    for(const key of cacheKeys.filter(value=>/^[0-9a-f]{64}$/.test(value))){
      this.memory.delete(key)
      if(this.options.directory)await rm(join(this.options.directory,key),{force:true})
    }
  }

  private safeSourceUrl(value:string,fullName:string,commitSha:string):URL {
    const url=new URL(value); if(url.protocol!=='https:')throw new Error('MEDIA_SOURCE_DENIED')
    const host=url.hostname.toLowerCase(); const [owner,repo]=fullName.split('/')
    if(host==='opengraph.githubassets.com')return url
    if(host==='raw.githubusercontent.com'&&owner&&repo){
      const prefix=`/${owner}/${repo}/${commitSha}/`.toLowerCase(); if(url.pathname.toLowerCase().startsWith(prefix))return url
    }
    throw new Error('MEDIA_SOURCE_DENIED')
  }

  private async readLimited(response:Response):Promise<Uint8Array>{
    if(response.body===null)throw new Error('MEDIA_EMPTY')
    const reader=response.body.getReader(); const chunks:Uint8Array[]=[]; let total=0
    while(true){
      const {done,value}=await reader.read(); if(done)break
      if(value===undefined)continue
      total+=value.byteLength
      if(total>MAX_MEDIA_BYTES){await reader.cancel();throw new Error('MEDIA_TOO_LARGE')}
      chunks.push(value)
    }
    if(total===0)throw new Error('MEDIA_EMPTY')
    const body=new Uint8Array(total); let offset=0
    for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength}
    return body
  }

  private async readCache(key:string,mime:string):Promise<{body:Uint8Array;mime:string}|undefined>{
    const memory=this.memory.get(key); if(memory)return memory
    if(!this.options.directory||!ALLOWED_MIME.has(mime))return undefined
    try{const body=new Uint8Array(await readFile(join(this.options.directory,key)));return{body,mime}}catch{return undefined}
  }

  private async writeCache(key:string,body:Uint8Array,mime:string):Promise<void>{
    this.memory.set(key,{body,mime})
    if(this.options.directory)await writeFile(join(this.options.directory,key),body,{mode:0o600})
  }
}
