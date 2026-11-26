import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokiStore } from '@/store/useTokiStore';
import { PlotCanvas } from '@/components/viz/PlotCanvas';
import { MachineInspector } from '@/components/viz/MachineInspector';
import { Icon, type IconName } from '@/components/ui/Icon';
import { buildSegments, documentStats } from '@/lib/geometry';
import { exportGcode } from '@/lib/gcode';
import { importSvg } from '@/lib/svgImport';
import { clamp, downloadText, readTextFile } from '@/lib/utils';
import type { DrawingDoc, ToolId } from '@/types';

const tools: Array<{ id: ToolId; icon: IconName; label: string }> = [
  { id: 'select', icon: 'cursor', label: 'SELECIONAR' },
  { id: 'line', icon: 'line', label: 'LINHA' },
  { id: 'rect', icon: 'rect', label: 'RETÂNGULO' },
  { id: 'ellipse', icon: 'circle', label: 'ELIPSE' },
  { id: 'polyline', icon: 'polyline', label: 'POLILINHA' },
  { id: 'pan', icon: 'hand', label: 'PAN' },
];

export function PlotStudio(): JSX.Element {
  const doc = useTokiStore((s) => s.studioDoc);
  const rig = useTokiStore((s) => s.rig);
  const activeTool = useTokiStore((s) => s.activeTool);
  const setActiveTool = useTokiStore((s) => s.setActiveTool);
  const selected = useTokiStore((s) => s.selectedShapeIds);
  const activeLayerId = useTokiStore((s) => s.activeLayerId);
  const setActiveLayer = useTokiStore((s) => s.setActiveLayer);
  const applyDoc = useTokiStore((s) => s.applyDoc);
  const updateShape = useTokiStore((s) => s.updateShape);
  const addLayer = useTokiStore((s) => s.addLayer);
  const updateLayer = useTokiStore((s) => s.updateLayer);
  const removeLayer = useTokiStore((s) => s.removeLayer);
  const undo = useTokiStore((s) => s.undo);
  const redo = useTokiStore((s) => s.redo);
  const history = useTokiStore((s) => s.history);
  const viewMode = useTokiStore((s) => s.studioViewMode);
  const setViewMode = useTokiStore((s) => s.setStudioViewMode);
  const maximized = useTokiStore((s) => s.studioMaximized);
  const setMaximized = useTokiStore((s) => s.setStudioMaximized);
  const split = useTokiStore((s) => s.studioSplit);
  const setSplit = useTokiStore((s) => s.setStudioSplit);
  const simulation = useTokiStore((s) => s.simulation);
  const startSimulation = useTokiStore((s) => s.startSimulation);
  const pauseSimulation = useTokiStore((s) => s.pauseSimulation);
  const resetSimulation = useTokiStore((s) => s.resetSimulation);
  const advanceSimulation = useTokiStore((s) => s.advanceSimulation);
  const setSimulationSpeed = useTokiStore((s) => s.setSimulationSpeed);
  const saveActiveProject = useTokiStore((s) => s.saveActiveProject);
  const activeProjectId = useTokiStore((s) => s.activeProjectId);
  const projects = useTokiStore((s) => s.projects);
  const pushEvent = useTokiStore((s) => s.pushEvent);
  const requestConfirmation = useTokiStore((s) => s.requestConfirmation);

  const viewsRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const [propertiesOpen, setPropertiesOpen] = useState(true);

  const stats = useMemo(() => documentStats(doc), [doc]);
  const segments = useMemo(() => buildSegments(doc), [doc]);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const selectedShape = doc.shapes.find((shape) => shape.id === selected[0]);

  useEffect(() => {
    if (!simulation.running) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      advanceSimulation(now - last);
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [simulation.running, advanceSimulation]);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      if (!dragging.current || !viewsRef.current) return;
      const rect = viewsRef.current.getBoundingClientRect();
      setSplit(((event.clientX - rect.left) / rect.width) * 100);
    };
    const onUp = (): void => {
      dragging.current = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [setSplit]);

  const simulatedPosition = useMemo(() => {
    if (!simulation.playhead) return simulation.running ? { x: 0, y: 0, z: doc.settings.penUp } : null;
    const segment = segments[simulation.segmentIndex];
    return {
      x: simulation.playhead.x,
      y: simulation.playhead.y,
      z: segment?.pen === 'down' ? doc.settings.penDown : doc.settings.penUp,
    };
  }, [simulation, segments, doc.settings]);

  const handleImport = async (file: File): Promise<void> => {
    try {
      const text = await readTextFile(file);
      let docImport: DrawingDoc;
      if (file.name.toLowerCase().endsWith('.svg')) {
        docImport = importSvg(text, doc).doc;
      } else {
        const parsed = JSON.parse(text) as { doc?: DrawingDoc; shapes?: DrawingDoc['shapes']; layers?: DrawingDoc['layers'] };
        docImport = (parsed.doc ?? parsed) as DrawingDoc;
        if (!Array.isArray(docImport.shapes) || !Array.isArray(docImport.layers)) {
          throw new Error('Arquivo JSON não contém um desenho TOKI válido.');
        }
      }
      requestConfirmation({
        title: 'Importar desenho',
        description: 'O desenho atual será substituído pelo arquivo importado. Salve o projeto antes de continuar.',
        confirmLabel: 'IMPORTAR',
        tone: 'danger',
        detail: file.name,
        onConfirm: () => applyDoc(docImport),
      });
    } catch (error) {
      pushEvent({
        severity: 'ERROR',
        code: 'IMPORT_FAILED',
        module: 'STUDIO',
        message: 'Falha ao importar arquivo.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const updateSetting = (key: keyof DrawingDoc['settings'], value: number): void => {
    applyDoc({ ...doc, settings: { ...doc.settings, [key]: value } });
  };

  const exportSvg = (): void => {
    const body = doc.shapes
      .map((shape) => {
        const points = shape.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
        if (shape.type === 'rect' && shape.points.length >= 2) {
          const [a, b] = shape.points;
          return `<rect x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(a.x - b.x)}" height="${Math.abs(a.y - b.y)}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.width}"/>`;
        }
        if (shape.type === 'ellipse' && shape.points.length >= 2) {
          const [a, b] = shape.points;
          return `<ellipse cx="${(a.x + b.x) / 2}" cy="${(a.y + b.y) / 2}" rx="${Math.abs(a.x - b.x) / 2}" ry="${Math.abs(a.y - b.y) / 2}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.width}"/>`;
        }
        return `<polyline points="${points}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.width}"/>`;
      })
      .join('\n');
    downloadText(
      `${(activeProject?.name ?? 'toki-drawing').replace(/[^\w-]/g, '_')}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${doc.bed.width} ${doc.bed.height}">\n${body}\n</svg>`,
      'image/svg+xml',
    );
  };

  return (
    <section className="module-shell">
      <div className="module-header">
        <div>
          <div className="eyebrow">MÓDULO 02 · PREPARAÇÃO VETORIAL</div>
          <h1 className="module-title">PLOT STUDIO</h1>
          <div className="module-subtitle">
            {activeProject?.name ?? 'SEM PROJETO ATIVO'} · {stats.shapes} TRAÇOS · {stats.segments} SEGMENTOS
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={undo} disabled={!history.past.length}><Icon name="undo" size={14} /></button>
          <button type="button" className="btn" onClick={redo} disabled={!history.future.length}><Icon name="redo" size={14} /></button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" size={14} /> IMPORTAR</button>
          <button type="button" className="btn btn-primary" onClick={saveActiveProject}><Icon name="save" size={14} /> SALVAR</button>
          <input
            ref={fileRef}
            type="file"
            accept=".svg,.json,image/svg+xml,application/json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImport(file);
              event.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="studio-grid">
        <div className="panel tool-rail" aria-label="Ferramentas vetoriais">
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={`tool-btn${activeTool === tool.id ? ' active' : ''}`}
              onClick={() => setActiveTool(tool.id)}
              aria-label={tool.label}
              title={tool.label}
            >
              <Icon name={tool.icon} size={18} />
            </button>
          ))}
          <div className="spacer" />
          <button type="button" className="tool-btn" onClick={() => setPropertiesOpen(!propertiesOpen)} aria-label="Propriedades">
            <Icon name="layers" size={18} />
          </button>
        </div>

        <div className="studio-toolbar">
          <div className="segmented" role="group" aria-label="Modo de visualização">
            <button type="button" className={viewMode === '3d' ? 'active' : ''} onClick={() => { setViewMode('3d'); setMaximized(null); }}>3D</button>
            <button type="button" className={viewMode === '2d' ? 'active' : ''} onClick={() => { setViewMode('2d'); setMaximized(null); }}>2D</button>
            <button type="button" className={viewMode === 'dual' ? 'active' : ''} onClick={() => { setViewMode('dual'); setMaximized(null); }}>DUAL</button>
          </div>
          {viewMode === 'dual' && (
            <div className="segmented" role="group" aria-label="Maximizar visualização">
              <button type="button" className={maximized === '3d' ? 'active' : ''} onClick={() => setMaximized(maximized === '3d' ? null : '3d')}>MAX 3D</button>
              <button type="button" className={maximized === '2d' ? 'active' : ''} onClick={() => setMaximized(maximized === '2d' ? null : '2d')}>MAX 2D</button>
            </div>
          )}
          <div className="spacer" />
          <span className="badge demo">SIMULAÇÃO VIRTUAL</span>
          <button type="button" className="btn btn-sm" onClick={() => (simulation.running ? pauseSimulation() : startSimulation())}>
            <Icon name={simulation.running ? 'pause' : 'play'} size={13} />
            {simulation.running ? 'PAUSAR' : 'SIMULAR'}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={resetSimulation}><Icon name="refresh" size={13} /></button>
          <select
            className="select"
            style={{ width: 74, minHeight: 28 }}
            value={simulation.speed}
            onChange={(event) => setSimulationSpeed(Number(event.target.value))}
            aria-label="Velocidade da simulação"
          >
            {[0.25, 0.5, 1, 2, 4].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
          </select>
        </div>

        <div
          ref={viewsRef}
          className={`studio-views${maximized === '3d' ? ' max-3d' : ''}${maximized === '2d' ? ' max-2d' : ''}`}
        >
          {viewMode !== '2d' && (
            <div className="view-pane view-3d" style={{ flexBasis: viewMode === 'dual' && !maximized ? `${split}%` : '100%' }}>
              <div className="panel" style={{ flex: 1, minHeight: 0 }}>
                <div className="panel-head">
                  <span className="panel-title">VISUALIZAÇÃO 3D</span>
                  <span className="tech-code">{simulation.progress > 0 ? `PEN ${simulatedPosition?.z.toFixed(1) ?? '—'} MM` : 'ISO / GANTRY'}</span>
                </div>
                <div className="stage-frame" style={{ padding: 8 }}>
                  <MachineInspector
                    position={simulation.progress > 0 ? simulatedPosition : null}
                    doc={doc}
                    bed={rig.profiles[rig.mode].bed}
                    mode={rig.mode}
                    tool={rig.profiles[rig.mode].tool}
                    traceProgress={simulation.progress / 100}
                    showLabels={false}
                  />
                </div>
              </div>
            </div>
          )}
          {viewMode === 'dual' && !maximized && (
            <div
              className="split-handle"
              role="separator"
              aria-orientation="vertical"
              onPointerDown={() => { dragging.current = true; }}
            />
          )}
          {viewMode !== '3d' && (
            <div className="view-pane view-2d" style={{ flexBasis: viewMode === 'dual' && !maximized ? `${100 - split}%` : '100%' }}>
              <div className="panel" style={{ flex: 1, minHeight: 0 }}>
                <div className="panel-head">
                  <span className="panel-title">VISUALIZAÇÃO 2D · VISTA SUPERIOR</span>
                  <span className="tech-code">{doc.bed.width}×{doc.bed.height} MM</span>
                </div>
                <PlotCanvas />
              </div>
            </div>
          )}
        </div>

        <div className="sim-bar">
          <span className="tech-code">VIRTUAL</span>
          <div className="progress">
            <span className="progress-fill" style={{ width: `${simulation.progress}%` }} />
          </div>
          <span className="mono" style={{ minWidth: 46, textAlign: 'right' }}>{simulation.progress.toFixed(0)}%</span>
          <span className="sim-note">SEG {simulation.segmentIndex + 1}/{simulation.totalSegments || stats.segments}</span>
        </div>

        <div className="studio-side">
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">CAMADAS</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={addLayer}><Icon name="plus" size={12} /> NOVA</button>
            </div>
            <div className="panel-body tight">
              {doc.layers.map((layer) => (
                <div key={layer.id} className={`layer-row${activeLayerId === layer.id ? ' accent' : ''}`}>
                  <button
                    type="button"
                    className="layer-swatch"
                    style={{ background: layer.color }}
                    onClick={() => setActiveLayer(layer.id)}
                    aria-label={`Selecionar ${layer.name}`}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => setActiveLayer(layer.id)}>
                    {layer.name}
                  </button>
                  <button
                    type="button"
                    className={`mini-icon-btn${layer.visible ? '' : ' active'}`}
                    onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                    aria-label="Alternar visibilidade"
                  >
                    <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={13} />
                  </button>
                  <div className="row" style={{ gap: 2 }}>
                    <button
                      type="button"
                      className={`mini-icon-btn${layer.locked ? ' active' : ''}`}
                      onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                      aria-label="Alternar bloqueio"
                    >
                      <Icon name={layer.locked ? 'lock' : 'unlock'} size={12} />
                    </button>
                    <button
                      type="button"
                      className="mini-icon-btn"
                      onClick={() => removeLayer(layer.id)}
                      disabled={doc.layers.length <= 1}
                      aria-label="Remover camada"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {propertiesOpen && (
            <div className="panel">
              <div className="panel-head"><span className="panel-title">PROPRIEDADES</span><span className="tech-code">{selectedShape ? 'OBJETO' : 'DOCUMENTO'}</span></div>
              <div className="panel-body tight col" style={{ gap: 12 }}>
                {selectedShape ? (
                  <>
                    <label className="label">TIPO<span className="mono">{selectedShape.type.toUpperCase()}</span></label>
                    <label className="label">COR
                      <input className="input" type="color" value={selectedShape.stroke} onChange={(event) => updateShape(selectedShape.id, { stroke: event.target.value })} />
                    </label>
                    <label className="label">ESPESSURA (MM)
                      <input className="input" type="number" min={0.1} max={3} step={0.1} value={selectedShape.width} onChange={(event) => updateShape(selectedShape.id, { width: clamp(Number(event.target.value), 0.1, 3) }, false)} />
                    </label>
                    <label className="label">CAMADA
                      <select className="select" value={selectedShape.layerId} onChange={(event) => updateShape(selectedShape.id, { layerId: event.target.value })}>
                        {doc.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="label">LEITO X (MM)
                      <input className="input" type="number" min={50} max={600} value={doc.bed.width} onChange={(event) => applyDoc({ ...doc, bed: { ...doc.bed, width: clamp(Number(event.target.value), 50, 600) } })} />
                    </label>
                    <label className="label">LEITO Y (MM)
                      <input className="input" type="number" min={50} max={600} value={doc.bed.height} onChange={(event) => applyDoc({ ...doc, bed: { ...doc.bed, height: clamp(Number(event.target.value), 50, 600) } })} />
                    </label>
                    <div className="divider" />
                    <label className="label">VELOCIDADE DESENHO (MM/MIN)
                      <input className="input" type="number" min={60} max={12000} step={60} value={doc.settings.feedRate} onChange={(event) => updateSetting('feedRate', clamp(Number(event.target.value), 60, 12000))} />
                    </label>
                    <label className="label">VELOCIDADE DESLOCAMENTO (MM/MIN)
                      <input className="input" type="number" min={60} max={12000} step={60} value={doc.settings.travelRate} onChange={(event) => updateSetting('travelRate', clamp(Number(event.target.value), 60, 12000))} />
                    </label>
                    <label className="label">PEN UP (MM)
                      <input className="input" type="number" min={0} max={30} step={0.5} value={doc.settings.penUp} onChange={(event) => updateSetting('penUp', clamp(Number(event.target.value), 0, 30))} />
                    </label>
                    <label className="label">PEN DOWN (MM)
                      <input className="input" type="number" min={-5} max={20} step={0.5} value={doc.settings.penDown} onChange={(event) => updateSetting('penDown', clamp(Number(event.target.value), -5, 20))} />
                    </label>
                    <label className="label">PASSADAS
                      <input className="input" type="number" min={1} max={10} value={doc.settings.passes} onChange={(event) => updateSetting('passes', clamp(Number(event.target.value), 1, 10))} />
                    </label>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-head"><span className="panel-title">DADOS TÉCNICOS</span><span className="tech-code">G-CODE / SVG / JSON</span></div>
            <div className="panel-body tight">
              <div className="row-between"><span className="muted">Dist. desenho</span><span className="mono">{stats.drawDistance} mm</span></div>
              <div className="row-between" style={{ marginTop: 8 }}><span className="muted">Dist. deslocamento</span><span className="mono">{stats.travelDistance} mm</span></div>
              <div className="row-between" style={{ marginTop: 8 }}><span className="muted">Tempo estimado</span><span className="mono">{stats.estimatedSeconds}s</span></div>
              <div className="row-between" style={{ marginTop: 8 }}><span className="muted">Segmentos</span><span className="mono">{stats.segments}</span></div>
              <div className="divider" style={{ margin: '12px 0' }} />
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" onClick={async () => downloadText(`${(activeProject?.name ?? 'toki-job').replace(/[^\w-]/g, '_')}.gcode`, await exportGcode(doc, rig), 'text/plain')}>
                  <Icon name="download" size={12} /> G-CODE
                </button>
                <button type="button" className="btn btn-sm" onClick={exportSvg}><Icon name="download" size={12} /> SVG</button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => downloadText(`${(activeProject?.name ?? 'toki-project').replace(/[^\w-]/g, '_')}.json`, JSON.stringify({ doc }, null, 2))}
                >
                  <Icon name="download" size={12} /> JSON
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
