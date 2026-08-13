/**
 * DSH Creative Workshop - Authentic High-Resolution Vector Artwork & Covers
 * 提供 100% 自适应、高科技感、暗黑工坊美学的 16:9 视觉封面图与相册大图
 */

export const PLUGIN_ARTWORKS = {
  "colleague-skill": {
    ogImage: "https://repository-images.githubusercontent.com/1195828337/b5964685-3a97-43f1-a492-bb9beb6a9921",
    fallbackSvg: `
      <svg width="100%" height="100%" viewBox="0 0 480 270" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg-colleague" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#0E1726"/>
            <stop offset="50%" stop-color="#1B1F3B"/>
            <stop offset="100%" stop-color="#0A0E1A"/>
          </linearGradient>
          <radialGradient id="glow-colleague" cx="240" cy="135" r="140" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#4D6BFE" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#4D6BFE" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="480" height="270" fill="url(#bg-colleague)"/>
        <rect width="480" height="270" fill="url(#glow-colleague)"/>
        
        <!-- 背景网络网格 -->
        <path d="M40 0V270M80 0V270M120 0V270M160 0V270M200 0V270M240 0V270M280 0V270M320 0V270M360 0V270M400 0V270M440 0V270" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
        <path d="M0 30H480M0 60H480M0 90H480M0 120H480M0 150H480M0 180H480M0 210H480M0 240H480" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>

        <!-- 神经回路脉络 -->
        <circle cx="240" cy="120" r="48" stroke="#66C0F4" stroke-width="2" stroke-dasharray="4 3" opacity="0.6"/>
        <circle cx="240" cy="120" r="32" fill="#16202D" stroke="#4D6BFE" stroke-width="2"/>
        <circle cx="240" cy="120" r="14" fill="#66C0F4"/>

        <!-- 外部发散节点 -->
        <path d="M240 72V38M240 168V202M192 120H150M288 120H330M206 86L176 56M274 86L304 56M206 154L176 184M274 154L304 184" stroke="#66C0F4" stroke-width="2" stroke-linecap="round"/>
        <circle cx="240" cy="38" r="4" fill="#A4D007"/>
        <circle cx="240" cy="202" r="4" fill="#4D6BFE"/>
        <circle cx="150" cy="120" r="4" fill="#66C0F4"/>
        <circle cx="330" cy="120" r="4" fill="#FF5A5F"/>

        <!-- 科技排版标题 -->
        <text x="240" y="235" text-anchor="middle" fill="#FFFFFF" font-family="'DM Sans', sans-serif" font-weight="800" font-size="16" letter-spacing="3">COLLEAGUE SKILL</text>
        <text x="240" y="252" text-anchor="middle" fill="#8F98A0" font-family="'Roboto Mono', monospace" font-size="9" letter-spacing="2">DIGITAL LIFE 1.0 · META GENERATOR</text>
      </svg>
    `
  },
  "modlens": {
    ogImage: "https://repository-images.githubusercontent.com/1163808211/158719db-2ed8-4e7d-92ae-a3d9fc62a9d2",
    fallbackSvg: `
      <svg width="100%" height="100%" viewBox="0 0 480 270" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg-modlens" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#08141E"/>
            <stop offset="60%" stop-color="#0D2538"/>
            <stop offset="100%" stop-color="#050C13"/>
          </linearGradient>
        </defs>
        <rect width="480" height="270" fill="url(#bg-modlens)"/>
        
        <!-- 镜头扫描器几何 -->
        <circle cx="240" cy="120" r="64" stroke="#10B981" stroke-width="1.5" stroke-opacity="0.4"/>
        <circle cx="240" cy="120" r="50" stroke="#66C0F4" stroke-width="2" stroke-dasharray="12 6"/>
        <circle cx="240" cy="120" r="36" fill="#121A24" stroke="#10B981" stroke-width="2"/>
        
        <!-- 视线瞄准准星 -->
        <line x1="200" y1="120" x2="280" y2="120" stroke="#10B981" stroke-width="1.5"/>
        <line x1="240" y1="80" x2="240" y2="160" stroke="#10B981" stroke-width="1.5"/>
        <rect x="210" y="90" width="60" height="60" rx="3" stroke="#66C0F4" stroke-width="1" stroke-dasharray="4 2"/>

        <!-- 科技角标 -->
        <path d="M50 50H70M50 50V70M430 50H410M430 50V70M50 220H70M50 220V200M430 220H410M430 220V200" stroke="#66C0F4" stroke-width="2"/>

        <text x="240" y="235" text-anchor="middle" fill="#FFFFFF" font-family="'DM Sans', sans-serif" font-weight="800" font-size="16" letter-spacing="3">MODLENS VISION</text>
        <text x="240" y="252" text-anchor="middle" fill="#10B981" font-family="'Roboto Mono', monospace" font-size="9" letter-spacing="2">MULTIMODAL OCR · UI RESTORATION</text>
      </svg>
    `
  },
  "ipollowork": {
    ogImage: "https://repository-images.githubusercontent.com/1044010907/3f86291a-c81a-4e83-8a29-bcf3fb8a793c",
    fallbackSvg: `
      <svg width="100%" height="100%" viewBox="0 0 480 270" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg-ipollo" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#140F22"/>
            <stop offset="50%" stop-color="#24143D"/>
            <stop offset="100%" stop-color="#0D0A17"/>
          </linearGradient>
        </defs>
        <rect width="480" height="270" fill="url(#bg-ipollo)"/>

        <!-- 3D 浮动 IDE 视窗 -->
        <rect x="140" y="55" width="200" height="120" rx="6" fill="#1A152E" stroke="#9333EA" stroke-width="2" filter="drop-shadow(0 8px 16px rgba(0,0,0,0.6))"/>
        <rect x="140" y="55" width="200" height="24" rx="6" fill="#241B3E"/>
        <circle cx="156" cy="67" r="3.5" fill="#EF4444"/>
        <circle cx="168" cy="67" r="3.5" fill="#FBBF24"/>
        <circle cx="180" cy="67" r="3.5" fill="#10B981"/>

        <!-- 代码高亮线条 -->
        <rect x="156" y="92" width="60" height="6" rx="2" fill="#9333EA"/>
        <rect x="224" y="92" width="80" height="6" rx="2" fill="#66C0F4"/>
        <rect x="156" y="106" width="120" height="6" rx="2" fill="#A4D007"/>
        <rect x="156" y="120" width="90" height="6" rx="2" fill="#E2E8F0" opacity="0.6"/>

        <text x="240" y="235" text-anchor="middle" fill="#FFFFFF" font-family="'DM Sans', sans-serif" font-weight="800" font-size="16" letter-spacing="3">IPOLLOWORK RUNTIME</text>
        <text x="240" y="252" text-anchor="middle" fill="#A855F7" font-family="'Roboto Mono', monospace" font-size="9" letter-spacing="2">SELF-EVOLVING AGENT WORKSPACE</text>
      </svg>
    `
  },
  "deeptide": {
    ogImage: null,
    fallbackSvg: `
      <svg width="100%" height="100%" viewBox="0 0 480 270" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg-deeptide" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#1A0D08"/>
            <stop offset="50%" stop-color="#2D170E"/>
            <stop offset="100%" stop-color="#0E0704"/>
          </linearGradient>
        </defs>
        <rect width="480" height="270" fill="url(#bg-deeptide)"/>

        <!-- Swift 流线飞燕 -->
        <path d="M190 140C220 120 250 80 290 60C270 95 270 120 295 145C260 135 240 145 220 170C225 155 210 148 190 140Z" fill="#F97316"/>
        <circle cx="240" cy="115" r="55" stroke="#F97316" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.4"/>

        <text x="240" y="235" text-anchor="middle" fill="#FFFFFF" font-family="'DM Sans', sans-serif" font-weight="800" font-size="16" letter-spacing="3">DEEPTIDE AGENT</text>
        <text x="240" y="252" text-anchor="middle" fill="#F97316" font-family="'Roboto Mono', monospace" font-size="9" letter-spacing="2">SWIFT-NATIVE MACOS AGENT</text>
      </svg>
    `
  },
  "mobius": {
    ogImage: null,
    fallbackSvg: `
      <svg width="100%" height="100%" viewBox="0 0 480 270" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg-mobius" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#0F172A"/>
            <stop offset="50%" stop-color="#1E293B"/>
            <stop offset="100%" stop-color="#020617"/>
          </linearGradient>
        </defs>
        <rect width="480" height="270" fill="url(#bg-mobius)"/>

        <!-- 莫比乌斯拓扑环 -->
        <path d="M180 120C180 95 205 95 240 120C275 145 300 145 300 120C300 95 275 95 240 120C205 145 180 145 180 120Z" stroke="#38BDF8" stroke-width="8" stroke-linecap="round" fill="none"/>
        <path d="M180 120C180 95 205 95 240 120C275 145 300 145 300 120" stroke="#FBBF24" stroke-width="3" stroke-linecap="round" fill="none"/>

        <text x="240" y="235" text-anchor="middle" fill="#FFFFFF" font-family="'DM Sans', sans-serif" font-weight="800" font-size="16" letter-spacing="3">MOBIUS AGENT OS</text>
        <text x="240" y="252" text-anchor="middle" fill="#38BDF8" font-family="'Roboto Mono', monospace" font-size="9" letter-spacing="2">DISTRIBUTED CLUSTER RUNTIME</text>
      </svg>
    `
  },
  "dsh-web-ui": {
    ogImage: "https://repository-images.githubusercontent.com/1331636953/a9d6eb6e-7196-4656-b5ec-426e87042c28",
    fallbackSvg: `
      <svg width="100%" height="100%" viewBox="0 0 480 270" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg-webui" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#180B22"/>
            <stop offset="60%" stop-color="#2D113B"/>
            <stop offset="100%" stop-color="#110518"/>
          </linearGradient>
        </defs>
        <rect width="480" height="270" fill="url(#bg-webui)"/>

        <!-- 任务看板网格 -->
        <rect x="130" y="60" width="65" height="95" rx="4" fill="#1C1028" stroke="#EC4899" stroke-width="1.5"/>
        <rect x="205" y="60" width="65" height="95" rx="4" fill="#1C1028" stroke="#8B5CF6" stroke-width="1.5"/>
        <rect x="280" y="60" width="65" height="95" rx="4" fill="#1C1028" stroke="#10B981" stroke-width="1.5"/>

        <rect x="138" y="70" width="49" height="18" rx="2" fill="#EC4899" opacity="0.3"/>
        <rect x="213" y="70" width="49" height="28" rx="2" fill="#8B5CF6" opacity="0.3"/>
        <rect x="288" y="70" width="49" height="14" rx="2" fill="#10B981" opacity="0.3"/>

        <text x="240" y="235" text-anchor="middle" fill="#FFFFFF" font-family="'DM Sans', sans-serif" font-weight="800" font-size="16" letter-spacing="3">DSH WEB UI SUITE</text>
        <text x="240" y="252" text-anchor="middle" fill="#EC4899" font-family="'Roboto Mono', monospace" font-size="9" letter-spacing="2">TASK BOARD · GIT GRAPH · SKINS</text>
      </svg>
    `
  },
  "agent-vision-toolkit": {
    ogImage: "https://repository-images.githubusercontent.com/1319174653/9c4e1028-1249-42b5-86f5-0dd79f0aace3",
    fallbackSvg: `
      <svg width="100%" height="100%" viewBox="0 0 480 270" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg-visiontk" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#061C1D"/>
            <stop offset="50%" stop-color="#0E3336"/>
            <stop offset="100%" stop-color="#041213"/>
          </linearGradient>
        </defs>
        <rect width="480" height="270" fill="url(#bg-visiontk)"/>

        <!-- 矩阵双目扫描仪 -->
        <rect x="160" y="80" width="70" height="70" rx="8" fill="#0C2527" stroke="#14B8A6" stroke-width="2"/>
        <circle cx="195" cy="115" r="18" stroke="#2DD4BF" stroke-width="2"/>
        <circle cx="195" cy="115" r="6" fill="#14B8A6"/>

        <rect x="250" y="80" width="70" height="70" rx="8" fill="#0C2527" stroke="#14B8A6" stroke-width="2"/>
        <circle cx="285" cy="115" r="18" stroke="#2DD4BF" stroke-width="2"/>
        <circle cx="285" cy="115" r="6" fill="#14B8A6"/>

        <text x="240" y="235" text-anchor="middle" fill="#FFFFFF" font-family="'DM Sans', sans-serif" font-weight="800" font-size="16" letter-spacing="3">AGENT VISION TOOLKIT</text>
        <text x="240" y="252" text-anchor="middle" fill="#2DD4BF" font-family="'Roboto Mono', monospace" font-size="9" letter-spacing="2">MULTIMODAL QA · GUI AUTOMATION</text>
      </svg>
    `
  },
  "muse-ai": {
    ogImage: null,
    fallbackSvg: `
      <svg width="100%" height="100%" viewBox="0 0 480 270" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg-muse" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#1A0A1D"/>
            <stop offset="50%" stop-color="#2D1135"/>
            <stop offset="100%" stop-color="#0E0410"/>
          </linearGradient>
        </defs>
        <rect width="480" height="270" fill="url(#bg-muse)"/>

        <!-- 交互故事星宿与光环 -->
        <circle cx="240" cy="115" r="45" stroke="#F472B6" stroke-width="2" stroke-dasharray="8 4"/>
        <polygon points="240,80 250,110 280,115 250,120 240,150 230,120 200,115 230,110" fill="#F43F5E"/>

        <text x="240" y="235" text-anchor="middle" fill="#FFFFFF" font-family="'DM Sans', sans-serif" font-weight="800" font-size="16" letter-spacing="3">MUSE AI COMPANION</text>
        <text x="240" y="252" text-anchor="middle" fill="#F472B6" font-family="'Roboto Mono', monospace" font-size="9" letter-spacing="2">STORY WORLD · CHARACTER BONDING</text>
      </svg>
    `
  },
  "req-dsh-core": {
    ogImage: null,
    fallbackSvg: `
      <svg width="100%" height="100%" viewBox="0 0 480 270" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg-core" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#0A1628"/>
            <stop offset="50%" stop-color="#122B4E"/>
            <stop offset="100%" stop-color="#050C17"/>
          </linearGradient>
        </defs>
        <rect width="480" height="270" fill="url(#bg-core)"/>

        <!-- DeepSeek 鲸鱼微内核 -->
        <circle cx="240" cy="115" r="54" stroke="#66C0F4" stroke-width="2"/>
        <path d="M210 125C215 105 235 95 260 100C275 105 285 120 275 135C260 145 230 145 210 125Z" fill="#66C0F4"/>
        <circle cx="265" cy="112" r="3" fill="#0A1628"/>

        <text x="240" y="235" text-anchor="middle" fill="#FFFFFF" font-family="'DM Sans', sans-serif" font-weight="800" font-size="16" letter-spacing="3">DEEPSEEK HARNESS CORE</text>
        <text x="240" y="252" text-anchor="middle" fill="#66C0F4" font-family="'Roboto Mono', monospace" font-size="9" letter-spacing="2">CORDIS RUNTIME MICROKERNEL</text>
      </svg>
    `
  }
};

/**
 * 渲染富视觉封面 HTML（优先展示高分辨率 OpenGraph Banner，备选使用高质量 SVG 画布）
 */
export function getArtworkHtml(id, fallbackName = '') {
  const art = PLUGIN_ARTWORKS[id];
  if (!art) {
    return `
      <div style="width:100%; height:100%; background:linear-gradient(135deg, #16202D 0%, #0E141B 100%); display:flex; align-items:center; justify-content:center; flex-direction:column; gap:6px;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#66C0F4" stroke-width="1.2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
        <span style="font-size:10px; color:#8F98A0; font-family:'Roboto Mono', monospace;">${fallbackName || id}</span>
      </div>
    `;
  }

  if (art.ogImage) {
    return `
      <div style="width:100%; height:100%; position:relative; overflow:hidden; background:#0B1015;">
        <img src="${art.ogImage}" alt="${id}" style="width:100%; height:100%; object-fit:cover; display:block;" onerror="this.parentElement.innerHTML=\`${art.fallbackSvg.replace(/`/g, '\\`')}\`" />
      </div>
    `;
  }

  return art.fallbackSvg;
}
