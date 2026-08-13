import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { RuntimeEnvironment } from '@dsh-workshop/domain'

const execFileAsync = promisify(execFile)
const profilePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

export function assertValidProfile(profile: string): void {
  if (!profilePattern.test(profile) || profile === '.' || profile === '..') {
    throw new CompanionInputError('PROFILE_INVALID_NAME', 'Profile 名称只能包含字母、数字、点、下划线和连字符')
  }
}

export class CompanionInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CompanionInputError'
  }
}

export interface EnvironmentSnapshot extends RuntimeEnvironment {
  dshHome: string
  profiles: readonly string[]
  detectedAt: string
}

export interface EnvironmentProbeLike {
  inspect(): Promise<EnvironmentSnapshot>
  profileDigest(profile: string): Promise<string>
}

async function fixedCommand(command: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(command, [...args], {
      encoding: 'utf8',
      timeout: 3_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    })
    const result = stdout.trim().split(/\r?\n/, 1)[0]
    return result === undefined || result === '' ? undefined : result
  } catch {
    return undefined
  }
}

function currentOs(): RuntimeEnvironment['os'] {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return 'linux'
}

function currentArch(): RuntimeEnvironment['arch'] {
  return process.arch === 'arm64' ? 'arm64' : 'x64'
}

export class EnvironmentProbe implements EnvironmentProbeLike {
  readonly dshHome: string

  constructor(dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
    this.dshHome = resolve(dshHome)
  }

  async inspect(): Promise<EnvironmentSnapshot> {
    const [dshVersion, pnpmVersion, profiles] = await Promise.all([
      fixedCommand('dsh', ['--version']),
      fixedCommand('corepack', ['pnpm', '--version']),
      this.profiles(),
    ])
    return {
      ...(dshVersion === undefined ? {} : { dshVersion }),
      ...(pnpmVersion === undefined ? {} : { pnpmVersion }),
      nodeVersion: process.version,
      os: currentOs(),
      arch: currentArch(),
      dshHome: this.dshHome,
      profiles,
      detectedAt: new Date().toISOString(),
    }
  }

  async profiles(): Promise<readonly string[]> {
    try {
      const entries = await readdir(join(this.dshHome, 'profiles'), { withFileTypes: true })
      return entries.filter(entry => entry.isDirectory() && profilePattern.test(entry.name)).map(entry => entry.name).sort()
    } catch {
      return []
    }
  }

  async profileDigest(profile: string): Promise<string> {
    assertValidProfile(profile)
    const profilesRoot = resolve(this.dshHome, 'profiles')
    const profileRoot = resolve(profilesRoot, profile)
    if (!profileRoot.startsWith(`${profilesRoot}${sep}`)) {
      throw new CompanionInputError('PROFILE_PATH_ESCAPE', 'Profile 路径越过了受控目录')
    }
    const hash = createHash('sha256').update(`profile:${profile}\n`)
    for (const filename of ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml']) {
      try {
        hash.update(`${filename}\0`).update(await readFile(join(profileRoot, filename))).update('\0')
      } catch {
        hash.update(`${filename}\0missing\0`)
      }
    }
    return `sha256:${hash.digest('hex')}`
  }
}
