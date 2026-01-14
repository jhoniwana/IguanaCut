import { useState, useEffect, useCallback } from 'react';
import { FiCrop, FiMove, FiX } from 'react-icons/fi';
import { IoMdCheckmarkCircle } from 'react-icons/io';

// Gemstone Inc inspired colors - Modern luxury aesthetic
const colors = {
  bg: '#0a0a0f',
  surface: '#12121a',
  card: '#1a1a24',
  border: '#2a2a3a',
  primary: '#00E5FF',
  secondary: '#FF148A',
  accent: '#FFC800',
  danger: '#ff4466',
  text: '#ffffff',
  textSecondary: '#b0b0c0',
  textMuted: '#606070',
  gradient: 'linear-gradient(135deg, #00E5FF 0%, #FF148A 100%)',
  gradientAccent: 'linear-gradient(135deg, #FF148A 0%, #FFC800 100%)',
};

export interface CropConfig {
  enabled: boolean;
  preset: 'tiktok' | 'instagram' | 'youtube' | 'cinema' | 'portrait43' | 'free' | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropPreset {
  id: 'tiktok' | 'instagram' | 'youtube' | 'cinema' | 'portrait43' | 'free';
  name: string;
  aspectRatio: number | null;
  description: string;
  icon: string;
  color: string;
}

const PRESETS: CropPreset[] = [
  { id: 'tiktok', name: '9:16', aspectRatio: 9 / 16, description: 'TikTok, Reels, Shorts', icon: '◆', color: '#FF148A' },
  { id: 'portrait43', name: '3:4', aspectRatio: 3 / 4, description: 'Retrato vertical', icon: '◇', color: '#AA66FF' },
  { id: 'instagram', name: '1:1', aspectRatio: 1, description: 'Instagram cuadrado', icon: '◈', color: '#00E5FF' },
  { id: 'youtube', name: '16:9', aspectRatio: 16 / 9, description: 'YouTube, TV', icon: '◆', color: '#FF4466' },
  { id: 'cinema', name: '21:9', aspectRatio: 21 / 9, description: 'Cinematográfico', icon: '◇', color: '#FFC800' },
  { id: 'free', name: 'Libre', aspectRatio: null, description: 'Tamaño personalizado', icon: '✦', color: colors.textMuted },
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
        newWidth = Math.round(videoHeight * targetRatio);
        newHeight = videoHeight;
        newX = Math.round((videoWidth - newWidth) / 2);
        newY = 0;
      } else {
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

  useEffect(() => {
    setLocalX(config.x);
    setLocalY(config.y);
    setLocalWidth(config.width);
    setLocalHeight(config.height);
  }, [config.x, config.y, config.width, config.height]);

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

  // Mini preview component for aspect ratio
  const AspectPreview = ({ ratio, isActive, color }: { ratio: number | null; isActive: boolean; color: string }) => {
    const previewSize = 40;
    let w, h;

    if (ratio === null) {
      w = previewSize * 0.8;
      h = previewSize * 0.6;
    } else if (ratio > 1) {
      w = previewSize;
      h = previewSize / ratio;
    } else {
      h = previewSize;
      w = previewSize * ratio;
    }

    return (
      <div style={{
        width: `${previewSize}px`,
        height: `${previewSize}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          width: `${w}px`,
          height: `${h}px`,
          border: `2px solid ${isActive ? color : colors.border}`,
          borderRadius: '3px',
          background: isActive ? `${color}33` : 'transparent',
          transition: 'all 0.2s ease',
        }} />
      </div>
    );
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: config.enabled ? colors.primary : colors.card,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <FiCrop size={18} color={config.enabled ? '#fff' : colors.textMuted} />
          </div>
          <div>
            <div style={{ color: colors.text, fontWeight: '600', fontSize: '15px' }}>
              Recortar Video
            </div>
            <div style={{ color: colors.textMuted, fontSize: '11px' }}>
              Cambia el formato de tu video
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: colors.card,
            border: 'none',
            color: colors.textMuted,
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '8px',
          }}
        >
          <FiX size={18} />
        </button>
      </div>

      {/* Status Badge */}
      {config.enabled && config.preset && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '10px',
          background: `${colors.primary}22`,
          borderRadius: '8px',
          marginBottom: '16px',
          border: `1px solid ${colors.primary}44`,
        }}>
          <IoMdCheckmarkCircle size={18} color={colors.primary} />
          <span style={{ color: colors.primary, fontSize: '13px', fontWeight: '600' }}>
            Formato {PRESETS.find(p => p.id === config.preset)?.name} activo
          </span>
        </div>
      )}

      {/* Presets Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '8px',
        marginBottom: '16px',
      }}>
        {PRESETS.map((preset) => {
          const isActive = config.preset === preset.id && config.enabled;
          return (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              style={{
                background: isActive ? `${preset.color}22` : colors.card,
                border: `2px solid ${isActive ? preset.color : colors.border}`,
                borderRadius: '10px',
                padding: '12px 8px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s ease',
              }}
            >
              <AspectPreview ratio={preset.aspectRatio} isActive={isActive} color={preset.color} />
              <div style={{
                color: isActive ? preset.color : colors.text,
                fontSize: '14px',
                fontWeight: '700',
              }}>
                {preset.name}
              </div>
              <div style={{
                color: colors.textMuted,
                fontSize: '10px',
                textAlign: 'center',
                lineHeight: '1.3',
              }}>
                {preset.description}
              </div>
            </button>
          );
        })}
      </div>

      {/* Position Controls - Only show when crop is active */}
      {config.enabled && (
        <>
          {/* Position Info */}
          <div style={{
            background: colors.card,
            borderRadius: '10px',
            padding: '14px',
            marginBottom: '12px',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
            }}>
              <FiMove size={16} color={colors.primary} />
              <span style={{ color: colors.text, fontSize: '13px', fontWeight: '600' }}>
                Ajustar posición
              </span>
              <span style={{
                color: colors.textMuted,
                fontSize: '11px',
                marginLeft: 'auto',
              }}>
                o arrastra en el video
              </span>
            </div>

            {/* X Slider */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '11px',
                marginBottom: '6px',
              }}>
                <span style={{ color: colors.textMuted }}>Horizontal</span>
                <span style={{ color: colors.primary, fontFamily: 'monospace' }}>{localX}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, videoWidth - localWidth)}
                value={localX}
                onChange={(e) => handlePositionChange('x', parseInt(e.target.value))}
                style={{
                  width: '100%',
                  height: '8px',
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  background: colors.border,
                  borderRadius: '4px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              />
            </div>

            {/* Y Slider */}
            <div>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '11px',
                marginBottom: '6px',
              }}>
                <span style={{ color: colors.textMuted }}>Vertical</span>
                <span style={{ color: colors.primary, fontFamily: 'monospace' }}>{localY}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, videoHeight - localHeight)}
                value={localY}
                onChange={(e) => handlePositionChange('y', parseInt(e.target.value))}
                style={{
                  width: '100%',
                  height: '8px',
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  background: colors.border,
                  borderRadius: '4px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              />
            </div>
          </div>

          {/* Output Info */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 12px',
            background: colors.card,
            borderRadius: '8px',
            marginBottom: '12px',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: colors.textMuted, fontSize: '10px', marginBottom: '2px' }}>Original</div>
              <div style={{ color: colors.text, fontSize: '12px', fontFamily: 'monospace' }}>{videoWidth}×{videoHeight}</div>
            </div>
            <div style={{ color: colors.textMuted }}>→</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: colors.textMuted, fontSize: '10px', marginBottom: '2px' }}>Salida</div>
              <div style={{ color: colors.primary, fontSize: '12px', fontFamily: 'monospace', fontWeight: '600' }}>{localWidth}×{localHeight}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: colors.textMuted, fontSize: '10px', marginBottom: '2px' }}>Ratio</div>
              <div style={{ color: colors.accent, fontSize: '12px', fontFamily: 'monospace' }}>{(localWidth / localHeight).toFixed(2)}</div>
            </div>
          </div>

          {/* Reset Button */}
          <button
            onClick={resetCrop}
            style={{
              width: '100%',
              background: colors.card,
              color: colors.textMuted,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              padding: '10px',
              fontSize: '13px',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <FiX size={16} />
            Desactivar recorte
          </button>
        </>
      )}

      {/* Hint when not active */}
      {!config.enabled && (
        <div style={{
          textAlign: 'center',
          padding: '16px',
          color: colors.textMuted,
          fontSize: '12px',
        }}>
          👆 Selecciona un formato para comenzar
        </div>
      )}
    </div>
  );
}
