import React, { useMemo, useRef, useState } from 'react';
import { type RepositoryMapNode } from '../../api';
import { Search, ZoomIn, ZoomOut, RotateCcw, Folder, FileCode } from 'lucide-react';
import { Spinner } from '../../components/ui/Primitives';

interface RepositoryMapProps { nodes: RepositoryMapNode[]; loading: boolean; error: string | null; onOpen: (filePath: string) => void; }
type Point = { x: number; y: number };

function layout(nodes: RepositoryMapNode[]) {
  const children = new Map<string, RepositoryMapNode[]>();
  nodes.forEach(n => { const key = n.parentId ?? ''; children.set(key, [...(children.get(key) ?? []), n]); });
  const points = new Map<string, Point>(); let row = 0;
  const place = (node: RepositoryMapNode, depth: number) => { const kids = (children.get(node.id) ?? []).filter(n => n.path !== '.'); const start = row; if (kids.length) kids.sort((a,b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1).forEach(k => place(k, depth + 1)); else row += 1; points.set(node.id, { x: 86 + depth * 190, y: 50 + (kids.length ? (start + row - 1) * 48 / 2 : (row - 1) * 48) }); };
  const root = nodes.find(n => n.path === '.') ?? nodes.find(n => !n.parentId); if (root) place(root, 0); return points;
}

export function RepositoryMap({ nodes, loading, error, onOpen }: RepositoryMapProps) {
  const [filter, setFilter] = useState(''); const [zoom, setZoom] = useState(1); const [offset, setOffset] = useState<Point>({ x: 0, y: 0 }); const [selected, setSelected] = useState<string | null>(null); const drag = useRef<Point | null>(null);
  const points = useMemo(() => layout(nodes), [nodes]); const visible = useMemo(() => nodes.filter(n => n.path !== '.' && (!filter || n.path.toLowerCase().includes(filter.toLowerCase()))), [nodes, filter]);
  const shown = new Set(visible.map(n => n.id)); const edges = visible.filter(n => n.parentId && points.has(n.parentId!));
  const reset = () => { setZoom(1); setOffset({x:0,y:0}); setFilter(''); setSelected(null); };
  return <div className="workspace-map-view cb-spatial-map">
    <div className="map-view-toolbar"><div className="map-toolbar-title"><span className="map-title-text">Repository map</span><span className="map-node-count">{nodes.length} nodes · drag to explore</span></div><div className="map-toolbar-actions"><label className="map-search-box"><Search size={14}/><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Find a file…" aria-label="Filter repository map" /></label><div className="map-zoom-controls"><button type="button" onClick={()=>setZoom(z=>Math.min(1.6,z+.15))} aria-label="Zoom in"><ZoomIn size={15}/></button><button type="button" onClick={()=>setZoom(z=>Math.max(.55,z-.15))} aria-label="Zoom out"><ZoomOut size={15}/></button><button type="button" onClick={reset} aria-label="Reset map view"><RotateCcw size={15}/></button></div></div></div>
    <div className="cb-map-canvas" onPointerDown={e=>{drag.current={x:e.clientX-offset.x,y:e.clientY-offset.y}; e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(drag.current)setOffset({x:e.clientX-drag.current.x,y:e.clientY-drag.current.y})}} onPointerUp={()=>{drag.current=null}}>
      {loading && <div className="map-empty-state"><Spinner size={20}/> Building map…</div>}{error && <div role="alert" className="map-error-state">{error}</div>}{!loading && !error && <div className="cb-map-world" style={{transform:`translate(${offset.x}px,${offset.y}px) scale(${zoom})`}}><svg className="cb-map-edges" width="1600" height={Math.max(500, nodes.length * 50)}>{edges.map(n=>{const from=points.get(n.parentId!)!, to=points.get(n.id)!; return <path key={n.id} d={`M${from.x+58} ${from.y} C${from.x+105} ${from.y},${to.x-35} ${to.y},${to.x-58} ${to.y}`} />})}</svg>{visible.map(n=>{const p=points.get(n.id)!; const active=selected===n.id; return <button key={n.id} type="button" className={`cb-map-card ${n.type === 'directory' ? 'cb-map-card--dir':''} ${active?'is-selected':''}`} style={{left:p.x,top:p.y}} onClick={e=>{e.stopPropagation();setSelected(n.id);if(n.type !== 'directory')onOpen(n.path)}} title={n.path}><span>{n.type==='directory'?<Folder size={15}/>:<FileCode size={15}/>}</span><b>{n.name}</b>{n.language&&<small>{n.language}</small>}</button>})}</div>}</div>
    <p className="cb-map-a11y">Spatial map: use the file explorer for keyboard-first hierarchy navigation. Select a file node to inspect its source.</p>
  </div>;
}
