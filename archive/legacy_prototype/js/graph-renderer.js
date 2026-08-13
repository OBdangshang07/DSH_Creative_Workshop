/**
 * DSH Creative Workshop - Graph Renderer
 * 基于原生 HTML5 Canvas 的高质感 Seam 关系图与依赖闭包图谱渲染器
 * 保持克制、精确的暗黑网络拓扑美学
 */

export class GraphRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = [];
    this.edges = [];
    this.hoveredNode = null;
    this.draggedNode = null;
    this.animationId = null;

    this.transform = { x: 0, y: 0, scale: 1 };
    this.isPanning = false;
    this.startPan = { x: 0, y: 0 };

    this._bindEvents();
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
    this.render();
  }

  _bindEvents() {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('mousedown', (e) => {
      const pos = this._getEventPos(e);
      const hit = this._hitTest(pos.x, pos.y);
      if (hit) {
        this.draggedNode = hit;
      } else {
        this.isPanning = true;
        this.startPan = { x: e.clientX - this.transform.x, y: e.clientY - this.transform.y };
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.draggedNode) {
        const pos = this._getEventPos(e);
        this.draggedNode.x = (pos.x - this.transform.x) / this.transform.scale;
        this.draggedNode.y = (pos.y - this.transform.y) / this.transform.scale;
        this.render();
      } else if (this.isPanning) {
        this.transform.x = e.clientX - this.startPan.x;
        this.transform.y = e.clientY - this.startPan.y;
        this.render();
      } else {
        const pos = this._getEventPos(e);
        const hit = this._hitTest(pos.x, pos.y);
        if (hit !== this.hoveredNode) {
          this.hoveredNode = hit;
          this.canvas.style.cursor = hit ? 'pointer' : 'grab';
          this.render();
        }
      }
    });

    window.addEventListener('mouseup', () => {
      this.draggedNode = null;
      this.isPanning = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      this.transform.scale = Math.max(0.4, Math.min(2.5, this.transform.scale * zoomFactor));
      this.render();
    });
  }

  _getEventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _hitTest(screenX, screenY) {
    const worldX = (screenX - this.transform.x) / this.transform.scale;
    const worldY = (screenY - this.transform.y) / this.transform.scale;
    return this.nodes.find(n => {
      const dx = n.x - worldX;
      const dy = n.y - worldY;
      return Math.sqrt(dx * dx + dy * dy) <= (n.radius || 20);
    });
  }

  // 加载 Seam 能力图谱数据
  loadSeamGraph(plugins) {
    this.nodes = [];
    this.edges = [];

    const serviceMap = new Map();

    // 1. 构建 Plugin 节点
    plugins.forEach((p, idx) => {
      const angle = (idx / plugins.length) * Math.PI * 2;
      const radius = 180 + (idx % 2) * 50;
      const node = {
        id: p.id,
        label: p.name,
        type: 'plugin',
        kind: p.kind,
        installed: p.installed,
        x: (this.width || 800) / 2 + Math.cos(angle) * radius,
        y: (this.height || 600) / 2 + Math.sin(angle) * radius,
        radius: 20
      };
      this.nodes.push(node);

      // 提取提供的服务
      p.capabilities.providesServices?.forEach(svc => {
        if (!serviceMap.has(svc)) serviceMap.set(svc, { providers: [], consumers: [] });
        serviceMap.get(svc).providers.push(p.id);
      });

      // 提取注入的服务
      p.capabilities.injectsServices?.forEach(svc => {
        if (!serviceMap.has(svc)) serviceMap.set(svc, { providers: [], consumers: [] });
        serviceMap.get(svc).consumers.push(p.id);
      });
    });

    // 2. 构建 Service Seam 核心节点
    let svcIdx = 0;
    serviceMap.forEach((rel, svcName) => {
      const svcNode = {
        id: `svc_${svcName}`,
        label: svcName,
        type: 'service',
        x: (this.width || 800) / 2 + (Math.sin(svcIdx) * 70),
        y: (this.height || 600) / 2 + (Math.cos(svcIdx) * 70),
        radius: 14
      };
      this.nodes.push(svcNode);
      svcIdx++;

      // 连接提供者 (实线绿/蓝)
      rel.providers.forEach(pId => {
        this.edges.push({ from: pId, to: svcNode.id, type: 'provide' });
      });

      // 连接消费者 (虚线黄/白)
      rel.consumers.forEach(pId => {
        this.edges.push({ from: pId, to: svcNode.id, type: 'inject' });
      });
    });

    this.render();
  }

  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.transform.x, this.transform.y);
    ctx.scale(this.transform.scale, this.transform.scale);

    // 1. 绘制连线
    this.edges.forEach(edge => {
      const fromNode = this.nodes.find(n => n.id === edge.from);
      const toNode = this.nodes.find(n => n.id === edge.to);
      if (!fromNode || !toNode) return;

      ctx.beginPath();
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(toNode.x, toNode.y);

      if (edge.type === 'provide') {
        ctx.strokeStyle = 'rgba(77, 107, 254, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // 2. 绘制节点
    this.nodes.forEach(node => {
      const isHovered = this.hoveredNode?.id === node.id;

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + (isHovered ? 3 : 0), 0, Math.PI * 2);

      if (node.type === 'plugin') {
        ctx.fillStyle = node.installed ? '#1D2A20' : '#181822';
        ctx.fill();
        ctx.lineWidth = isHovered ? 2 : 1;
        ctx.strokeStyle = node.installed ? '#22C55E' : (isHovered ? '#4D6BFE' : 'rgba(255,255,255,0.18)');
        ctx.stroke();
      } else {
        // Service Seam
        ctx.fillStyle = '#211D12';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = isHovered ? '#FBBF24' : 'rgba(234, 179, 8, 0.6)';
        ctx.stroke();
      }

      // 文本小标
      ctx.fillStyle = isHovered ? '#FFFFFF' : '#94A3B8';
      ctx.font = node.type === 'plugin' ? '11px sans-serif' : '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, node.x, node.y + node.radius + 14);
    });

    ctx.restore();
  }
}
