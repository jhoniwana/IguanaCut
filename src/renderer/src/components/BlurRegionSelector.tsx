import { useState } from 'react';
import { IoMdTrash, IoMdAdd, IoMdClose, IoMdEye, IoMdEyeOff } from 'react-icons/io';
import { FiEyeOff, FiZap } from 'react-icons/fi';
import { MdBlurOn } from 'react-icons/md';

// Clean colors matching VideoEditor
const colors = {
  bg: '#0f0f0f',
  surface: '#1a1a1a',
  card: '#222222',
  border: '#333333',
  primary: '#10b981',
  secondary: '#3b82f6',
  accent: '#f59e0b',
  danger: '#ef4444',
  purple: '#8b5cf6',
  text: '#ffffff',
  textSecondary: '#a1a1a1',
  textMuted: '#666666',
};

export interface BlurRegion {
  id: string;
  x: number; // Percentage 0-100
  y: number; // Percentage 0-100
  width: number; // Percentage 0-100
  height: number; // Percentage 0-100
  startTime: number;
  endTime: number;
  blurIntensity: number; // 10-50
}

export interface BlurConfig {
  mode: 'off' | 'auto' | 'manual';
  autoIntensity: number;
  regions: BlurRegion[];
}

interface Props {
  config: BlurConfig;
  onChange: (config: BlurConfig) => void;
  currentTime: number;
  duration: number;
  onClose: () => void;
}

export default function BlurRegionSelector({ config, onChange, currentTime, duration, onClose }: Props) {
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const addRegion = () => {
    const newRegion: BlurRegion = {
      id: `blur-${Date.now()}`,
      x: 35,
      y: 35,
      width: 30,
      height: 30,
      startTime: currentTime,
      endTime: Math.min(currentTime + 5, duration),
      blurIntensity: 25,
    };
    onChange({
      ...config,
      mode: 'manual',
      regions: [...config.regions, newRegion],
    });
    setEditingRegionId(newRegion.id);
  };

  const removeRegion = (id: string) => {
    onChange({
      ...config,
      regions: config.regions.filter(r => r.id !== id),
    });
    if (editingRegionId === id) {
      setEditingRegionId(null);
    }
  };

  const updateRegion = (id: string, updates: Partial<BlurRegion>) => {
    onChange({
      ...config,
      regions: config.regions.map(r => r.id === id ? { ...r, ...updates } : r),
    });
  };

  const setMode = (mode: BlurConfig['mode']) => {
    onChange({ ...config, mode });
  };

  const modeButtonStyle = (isActive: boolean): React.CSSProperties => ({
    flex: 1,
    background: isActive ? colors.purple : colors.card,
    color: isActive ? '#fff' : colors.textMuted,
    border: `1px solid ${isActive ? colors.purple : colors.border}`,
    borderRadius: '8px',
    padding: '12px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s ease',
  });

  const sliderStyle: React.CSSProperties = {
    width: '100%',
    height: '6px',
    WebkitAppearance: 'none',
    appearance: 'none',
    background: colors.border,
    borderRadius: '3px',
    outline: 'none',
    cursor: 'pointer',
  };

  // Check if a region is active at current time
  const isRegionActive = (region: BlurRegion) => {
    return currentTime >= region.startTime && currentTime <= region.endTime;
  };

  return (
    <div style={{
      background: colors.surface,
      borderRadius: '12px',
      padding: '16px',
      border: `1px solid ${colors.border}`,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FiEyeOff size={18} color={colors.purple} />
          <span style={{ color: colors.text, fontWeight: '600', fontSize: '14px' }}>
            Censurar/Pixelar
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.textMuted,
            cursor: 'pointer',
            padding: '4px',
          }}
        >
          <IoMdClose size={18} />
        </button>
      </div>

      {/* Mode Selection */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          fontSize: '11px',
          color: colors.textMuted,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Modo
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setMode('off')}
            style={modeButtonStyle(config.mode === 'off')}
          >
            <IoMdEyeOff size={18} />
            <span>Desactivado</span>
          </button>
          <button
            onClick={() => setMode('auto')}
            style={modeButtonStyle(config.mode === 'auto')}
          >
            <FiZap size={18} />
            <span>Auto (IA)</span>
          </button>
          <button
            onClick={() => setMode('manual')}
            style={modeButtonStyle(config.mode === 'manual')}
          >
            <MdBlurOn size={18} />
            <span>Manual</span>
          </button>
        </div>
      </div>

      {/* Auto Mode Settings */}
      {config.mode === 'auto' && (
        <div style={{
          background: colors.card,
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '12px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px',
          }}>
            <FiZap size={16} color={colors.accent} />
            <span style={{ color: colors.text, fontSize: '13px', fontWeight: '600' }}>
              Detección Automática de Rostros
            </span>
          </div>
          <p style={{
            color: colors.textSecondary,
            fontSize: '12px',
            margin: '0 0 12px 0',
            lineHeight: '1.5',
          }}>
            La IA detectará y pixelará automáticamente todos los rostros en el video.
            Este proceso puede tardar varios minutos dependiendo de la duración.
          </p>

          <div style={{ marginBottom: '8px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '11px',
              color: colors.textMuted,
              marginBottom: '4px',
            }}>
              <span>Intensidad del blur</span>
              <span style={{ color: colors.purple, fontFamily: 'monospace' }}>{config.autoIntensity}</span>
            </div>
            <input
              type="range"
              min={10}
              max={50}
              value={config.autoIntensity}
              onChange={(e) => onChange({ ...config, autoIntensity: parseInt(e.target.value) })}
              style={sliderStyle}
            />
          </div>

          <div style={{
            background: 'rgba(139, 92, 246, 0.1)',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            borderRadius: '6px',
            padding: '10px',
            fontSize: '11px',
            color: colors.purple,
          }}>
            <strong>Nota:</strong> Requiere procesamiento adicional al exportar.
            El tiempo dependerá de la duración del video.
          </div>
        </div>
      )}

      {/* Manual Mode - Region List */}
      {config.mode === 'manual' && (
        <>
          {/* Add Region Button */}
          <button
            onClick={addRegion}
            style={{
              width: '100%',
              background: colors.purple,
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '12px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginBottom: '12px',
            }}
          >
            <IoMdAdd size={18} />
            Añadir Región en {fmt(currentTime)}
          </button>

          {/* Regions List */}
          {config.regions.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '20px',
              color: colors.textMuted,
              fontSize: '12px',
            }}>
              <MdBlurOn size={32} style={{ marginBottom: '8px', opacity: 0.5 }} />
              <p style={{ margin: 0 }}>No hay regiones definidas</p>
              <p style={{ margin: '4px 0 0', fontSize: '11px' }}>
                Añade una región para pixelar un área del video
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {config.regions.map((region, index) => {
                const isEditing = editingRegionId === region.id;
                const isActive = isRegionActive(region);

                return (
                  <div
                    key={region.id}
                    style={{
                      background: isEditing ? 'rgba(139, 92, 246, 0.15)' : colors.card,
                      borderRadius: '8px',
                      padding: '12px',
                      border: `1px solid ${isEditing ? colors.purple : isActive ? colors.accent : colors.border}`,
                    }}
                  >
                    {/* Region Header */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: isEditing ? '12px' : '0',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '6px',
                          background: colors.purple,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontSize: '11px',
                          fontWeight: '700',
                        }}>
                          {index + 1}
                        </div>
                        <div>
                          <div style={{ color: colors.text, fontSize: '13px', fontWeight: '600' }}>
                            Región {index + 1}
                            {isActive && (
                              <span style={{
                                marginLeft: '8px',
                                background: colors.accent,
                                color: '#000',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '9px',
                                fontWeight: '700',
                              }}>
                                VISIBLE
                              </span>
                            )}
                          </div>
                          <div style={{
                            color: colors.textMuted,
                            fontSize: '11px',
                            fontFamily: 'monospace',
                          }}>
                            {fmt(region.startTime)} → {fmt(region.endTime)}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={() => setEditingRegionId(isEditing ? null : region.id)}
                          style={{
                            background: isEditing ? colors.purple : 'transparent',
                            border: 'none',
                            color: isEditing ? '#fff' : colors.textMuted,
                            cursor: 'pointer',
                            padding: '6px',
                            borderRadius: '4px',
                          }}
                          title={isEditing ? 'Cerrar' : 'Editar'}
                        >
                          {isEditing ? <IoMdEye size={14} /> : <IoMdEyeOff size={14} />}
                        </button>
                        <button
                          onClick={() => removeRegion(region.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: colors.danger,
                            cursor: 'pointer',
                            padding: '6px',
                            borderRadius: '4px',
                          }}
                          title="Eliminar"
                        >
                          <IoMdTrash size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Region Editor */}
                    {isEditing && (
                      <div>
                        {/* Position */}
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{
                            fontSize: '10px',
                            color: colors.textMuted,
                            marginBottom: '6px',
                            textTransform: 'uppercase',
                          }}>
                            Posición
                          </div>
                          <div style={{ display: 'flex', gap: '12px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '10px',
                                marginBottom: '2px',
                              }}>
                                <span style={{ color: colors.textMuted }}>X</span>
                                <span style={{ color: colors.purple }}>{region.x}%</span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={100 - region.width}
                                value={region.x}
                                onChange={(e) => updateRegion(region.id, { x: parseInt(e.target.value) })}
                                style={sliderStyle}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '10px',
                                marginBottom: '2px',
                              }}>
                                <span style={{ color: colors.textMuted }}>Y</span>
                                <span style={{ color: colors.purple }}>{region.y}%</span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={100 - region.height}
                                value={region.y}
                                onChange={(e) => updateRegion(region.id, { y: parseInt(e.target.value) })}
                                style={sliderStyle}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Size */}
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{
                            fontSize: '10px',
                            color: colors.textMuted,
                            marginBottom: '6px',
                            textTransform: 'uppercase',
                          }}>
                            Tamaño
                          </div>
                          <div style={{ display: 'flex', gap: '12px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '10px',
                                marginBottom: '2px',
                              }}>
                                <span style={{ color: colors.textMuted }}>Ancho</span>
                                <span style={{ color: colors.purple }}>{region.width}%</span>
                              </div>
                              <input
                                type="range"
                                min={5}
                                max={100 - region.x}
                                value={region.width}
                                onChange={(e) => updateRegion(region.id, { width: parseInt(e.target.value) })}
                                style={sliderStyle}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '10px',
                                marginBottom: '2px',
                              }}>
                                <span style={{ color: colors.textMuted }}>Alto</span>
                                <span style={{ color: colors.purple }}>{region.height}%</span>
                              </div>
                              <input
                                type="range"
                                min={5}
                                max={100 - region.y}
                                value={region.height}
                                onChange={(e) => updateRegion(region.id, { height: parseInt(e.target.value) })}
                                style={sliderStyle}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Time Range */}
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{
                            fontSize: '10px',
                            color: colors.textMuted,
                            marginBottom: '6px',
                            textTransform: 'uppercase',
                          }}>
                            Tiempo
                          </div>
                          <div style={{ display: 'flex', gap: '12px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '10px',
                                marginBottom: '2px',
                              }}>
                                <span style={{ color: colors.textMuted }}>Inicio</span>
                                <span style={{ color: colors.accent }}>{fmt(region.startTime)}</span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={region.endTime - 0.1}
                                step={0.1}
                                value={region.startTime}
                                onChange={(e) => updateRegion(region.id, { startTime: parseFloat(e.target.value) })}
                                style={sliderStyle}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '10px',
                                marginBottom: '2px',
                              }}>
                                <span style={{ color: colors.textMuted }}>Fin</span>
                                <span style={{ color: colors.accent }}>{fmt(region.endTime)}</span>
                              </div>
                              <input
                                type="range"
                                min={region.startTime + 0.1}
                                max={duration}
                                step={0.1}
                                value={region.endTime}
                                onChange={(e) => updateRegion(region.id, { endTime: parseFloat(e.target.value) })}
                                style={sliderStyle}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Blur Intensity */}
                        <div>
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '10px',
                            marginBottom: '4px',
                          }}>
                            <span style={{ color: colors.textMuted }}>Intensidad del blur</span>
                            <span style={{ color: colors.purple }}>{region.blurIntensity}</span>
                          </div>
                          <input
                            type="range"
                            min={10}
                            max={50}
                            value={region.blurIntensity}
                            onChange={(e) => updateRegion(region.id, { blurIntensity: parseInt(e.target.value) })}
                            style={sliderStyle}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Instructions */}
          {config.regions.length > 0 && (
            <div style={{
              marginTop: '12px',
              padding: '10px',
              background: colors.card,
              borderRadius: '6px',
              fontSize: '11px',
              color: colors.textMuted,
              textAlign: 'center',
            }}>
              Las regiones se muestran como rectángulos morados sobre el video.
              Ajusta posición y tamaño con los controles.
            </div>
          )}
        </>
      )}

      {/* Disabled Mode Info */}
      {config.mode === 'off' && (
        <div style={{
          textAlign: 'center',
          padding: '16px',
          color: colors.textMuted,
          fontSize: '12px',
        }}>
          Selecciona un modo para activar la censura
        </div>
      )}
    </div>
  );
}
