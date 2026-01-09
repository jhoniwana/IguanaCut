import { useState, useEffect, useCallback } from 'react';
import { FiCrop, FiSquare, FiMonitor, FiFilm, FiMove } from 'react-icons/fi';
import { IoMdClose, IoMdCheckmark } from 'react-icons/io';

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
  text: '#ffffff',
  textSecondary: '#a1a1a1',
  textMuted: '#666666',
};

export interface CropConfig {
  enabled: boolean;
  preset: 'tiktok' | 'instagram' | 'youtube' | 'cinema' | 'free' | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropPreset {
  id: 'tiktok' | 'instagram' | 'youtube' | 'cinema' | 'free';
  name: string;
  icon: React.ReactNode;
  aspectRatio: number | null; // null for free
  description: string;
}

const PRESETS: CropPreset[] = [
  { id: 'tiktok', name: 'TikTok', icon: <span style={{ fontWeight: 'bold' }}>9:16</span>, aspectRatio: 9 / 16, description: 'Vertical para TikTok/Reels' },
  { id: 'instagram', name: 'Instagram', icon: <FiSquare size={16} />, aspectRatio: 1, description: 'Cuadrado 1:1' },
  { id: 'youtube', name: 'YouTube', icon: <FiMonitor size={16} />, aspectRatio: 16 / 9, description: 'Horizontal 16:9' },
  { id: 'cinema', name: 'Cine', icon: <FiFilm size={16} />, aspectRatio: 21 / 9, description: 'Cinematográfico 21:9' },
  { id: 'free', name: 'Libre', icon: <FiMove size={16} />, aspectRatio: null, description: 'Dimensiones personalizadas' },
];

interface Props {
  config: CropConfig;
  onChange: (config: CropConfig) => void;
  videoWidth: number;
  videoHeight: number;
  onClose: () => void;
}

export default function CropSelector({ config, onChange, videoWidth, videoHeight, onClose }: Props) {
  const [localX, setLocalX] = useState(config.x);
  const [localY, setLocalY] = useState(config.y);
  const [localWidth, setLocalWidth] = useState(config.width);
  const [localHeight, setLocalHeight] = useState(config.height);

  // Calculate crop dimensions based on preset
  const applyPreset = useCallback((preset: CropPreset['id']) => {
    const presetInfo = PRESETS.find(p => p.id === preset);
    if (!presetInfo) return;

    let newWidth = videoWidth;
    let newHeight = videoHeight;
    let newX = 0;
    let newY = 0;

    if (presetInfo.aspectRatio !== null) {
      const targetRatio = presetInfo.aspectRatio;
      const currentRatio = videoWidth / videoHeight;

      if (currentRatio > targetRatio) {
        // Video is wider than target - crop sides
        newWidth = Math.round(videoHeight * targetRatio);
        newHeight = videoHeight;
        newX = Math.round((videoWidth - newWidth) / 2);
        newY = 0;
      } else {
        // Video is taller than target - crop top/bottom
        newWidth = videoWidth;
        newHeight = Math.round(videoWidth / targetRatio);
        newX = 0;
        newY = Math.round((videoHeight - newHeight) / 2);
      }
    }

    setLocalX(newX);
    setLocalY(newY);
    setLocalWidth(newWidth);
    setLocalHeight(newHeight);

    onChange({
      enabled: true,
      preset,
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight,
    });
  }, [videoWidth, videoHeight, onChange]);

  // Update local state when config changes externally
  useEffect(() => {
    setLocalX(config.x);
    setLocalY(config.y);
    setLocalWidth(config.width);
    setLocalHeight(config.height);
  }, [config.x, config.y, config.width, config.height]);

  // Handle slider changes
  const handlePositionChange = (axis: 'x' | 'y', value: number) => {
    if (axis === 'x') {
      const maxX = videoWidth - localWidth;
      const newX = Math.max(0, Math.min(maxX, value));
      setLocalX(newX);
      onChange({ ...config, x: newX, preset: 'free' });
    } else {
      const maxY = videoHeight - localHeight;
      const newY = Math.max(0, Math.min(maxY, value));
      setLocalY(newY);
      onChange({ ...config, y: newY, preset: 'free' });
    }
  };

  const handleSizeChange = (dimension: 'width' | 'height', value: number) => {
    if (dimension === 'width') {
      const newWidth = Math.max(100, Math.min(videoWidth - localX, value));
      setLocalWidth(newWidth);
      onChange({ ...config, width: newWidth, preset: 'free' });
    } else {
      const newHeight = Math.max(100, Math.min(videoHeight - localY, value));
      setLocalHeight(newHeight);
      onChange({ ...config, height: newHeight, preset: 'free' });
    }
  };

  const toggleCrop = () => {
    onChange({
      ...config,
      enabled: !config.enabled,
    });
  };

  const resetCrop = () => {
    setLocalX(0);
    setLocalY(0);
    setLocalWidth(videoWidth);
    setLocalHeight(videoHeight);
    onChange({
      enabled: false,
      preset: null,
      x: 0,
      y: 0,
      width: videoWidth,
      height: videoHeight,
    });
  };

  const buttonStyle = (isActive: boolean): React.CSSProperties => ({
    background: isActive ? colors.primary : colors.card,
    color: isActive ? '#fff' : colors.textSecondary,
    border: `1px solid ${isActive ? colors.primary : colors.border}`,
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    flex: 1,
    minWidth: '70px',
    transition: 'all 0.2s ease',
  });

  const sliderContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '12px',
  };

  const sliderLabelStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '11px',
    color: colors.textMuted,
  };

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
          <FiCrop size={18} color={colors.primary} />
          <span style={{ color: colors.text, fontWeight: '600', fontSize: '14px' }}>
            Recortar Video
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={toggleCrop}
            style={{
              background: config.enabled ? colors.primary : colors.card,
              color: config.enabled ? '#fff' : colors.textMuted,
              border: 'none',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {config.enabled ? <IoMdCheckmark size={14} /> : null}
            {config.enabled ? 'Activo' : 'Inactivo'}
          </button>
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
      </div>

      {/* Presets */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          fontSize: '11px',
          color: colors.textMuted,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Formato
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              style={buttonStyle(config.preset === preset.id)}
              title={preset.description}
            >
              {preset.icon}
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Position & Size Controls */}
      {config.enabled && (
        <>
          {/* Position Controls */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{
              fontSize: '11px',
              color: colors.textMuted,
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Posición
            </div>

            <div style={sliderContainerStyle}>
              <div style={sliderLabelStyle}>
                <span>Horizontal (X)</span>
                <span style={{ color: colors.primary, fontFamily: 'monospace' }}>{localX}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, videoWidth - localWidth)}
                value={localX}
                onChange={(e) => handlePositionChange('x', parseInt(e.target.value))}
                style={sliderStyle}
              />
            </div>

            <div style={sliderContainerStyle}>
              <div style={sliderLabelStyle}>
                <span>Vertical (Y)</span>
                <span style={{ color: colors.primary, fontFamily: 'monospace' }}>{localY}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, videoHeight - localHeight)}
                value={localY}
                onChange={(e) => handlePositionChange('y', parseInt(e.target.value))}
                style={sliderStyle}
              />
            </div>
          </div>

          {/* Size Controls (only for free mode) */}
          {config.preset === 'free' && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{
                fontSize: '11px',
                color: colors.textMuted,
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Tamaño
              </div>

              <div style={sliderContainerStyle}>
                <div style={sliderLabelStyle}>
                  <span>Ancho</span>
                  <span style={{ color: colors.secondary, fontFamily: 'monospace' }}>{localWidth}px</span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={videoWidth - localX}
                  value={localWidth}
                  onChange={(e) => handleSizeChange('width', parseInt(e.target.value))}
                  style={sliderStyle}
                />
              </div>

              <div style={sliderContainerStyle}>
                <div style={sliderLabelStyle}>
                  <span>Alto</span>
                  <span style={{ color: colors.secondary, fontFamily: 'monospace' }}>{localHeight}px</span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={videoHeight - localY}
                  value={localHeight}
                  onChange={(e) => handleSizeChange('height', parseInt(e.target.value))}
                  style={sliderStyle}
                />
              </div>
            </div>
          )}

          {/* Info */}
          <div style={{
            background: colors.card,
            borderRadius: '8px',
            padding: '10px',
            fontSize: '11px',
            color: colors.textSecondary,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Video original:</span>
              <span style={{ color: colors.text, fontFamily: 'monospace' }}>{videoWidth} x {videoHeight}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Área de recorte:</span>
              <span style={{ color: colors.primary, fontFamily: 'monospace' }}>{localWidth} x {localHeight}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Aspect ratio:</span>
              <span style={{ color: colors.accent, fontFamily: 'monospace' }}>
                {(localWidth / localHeight).toFixed(2)}:1
              </span>
            </div>
          </div>

          {/* Reset Button */}
          <button
            onClick={resetCrop}
            style={{
              width: '100%',
              marginTop: '12px',
              background: colors.card,
              color: colors.textMuted,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              padding: '10px',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Restablecer
          </button>
        </>
      )}

      {/* Disabled State Info */}
      {!config.enabled && (
        <div style={{
          textAlign: 'center',
          padding: '16px',
          color: colors.textMuted,
          fontSize: '12px',
        }}>
          Selecciona un formato para activar el recorte
        </div>
      )}
    </div>
  );
}
