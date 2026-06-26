import { useState, useRef, useCallback } from 'react';
import { FiUpload, FiX, FiImage, FiTrash2 } from 'react-icons/fi';
import { apiClient } from '../api/client';

// Colors matching VideoEditor.tsx
const colors = {
  bg: '#0a0a0f',
  surface: '#12121a',
  card: '#1a1a24',
  border: '#2a2a3a',
  primary: '#8B5CF6',
  secondary: '#A78BFA',
  accent: '#C084FC',
  danger: '#ff4466',
  text: '#ffffff',
  textSecondary: '#b0b0c0',
  textMuted: '#606070',
};

export interface WatermarkConfig {
  enabled: boolean;
  imageUrl: string | null;
  filename: string | null;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity: number;
  scale: number;
  marginX: number;
  marginY: number;
}

interface WatermarkSettingsProps {
  config: WatermarkConfig;
  onChange: (config: WatermarkConfig) => void;
  onClose?: () => void;
  compact?: boolean;
}

const positions = [
  { value: 'top-left', label: 'Arriba Izq.' },
  { value: 'top-right', label: 'Arriba Der.' },
  { value: 'bottom-left', label: 'Abajo Izq.' },
  { value: 'bottom-right', label: 'Abajo Der.' },
  { value: 'center', label: 'Centro' },
] as const;

export default function WatermarkSettings({
  config,
  onChange,
  onClose,
  compact = false,
}: WatermarkSettingsProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate PNG
    if (!file.type.includes('png')) {
      alert('Solo se permiten archivos PNG para marcas de agua');
      return;
    }

    setIsUploading(true);
    try {
      const result = await apiClient.uploadWatermark(file);
      onChange({
        ...config,
        enabled: true,
        imageUrl: result.url,
        filename: result.filename,
      });
    } catch (error) {
      console.error('Failed to upload watermark:', error);
      alert('Error al subir la marca de agua');
    } finally {
      setIsUploading(false);
    }
  }, [config, onChange]);

  const handleRemoveWatermark = useCallback(async () => {
    if (config.filename) {
      try {
        await apiClient.deleteWatermark(config.filename);
      } catch (error) {
        console.error('Failed to delete watermark:', error);
      }
    }
    onChange({
      ...config,
      enabled: false,
      imageUrl: null,
      filename: null,
    });
  }, [config, onChange]);

  const containerStyle: React.CSSProperties = compact ? {
    padding: 12,
    backgroundColor: colors.card,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
  } : {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 400,
    maxWidth: '90vw',
    backgroundColor: colors.surface,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 1000,
  };

  return (
    <>
      {!compact && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            zIndex: 999,
          }}
          onClick={onClose}
        />
      )}
      <div style={containerStyle}>
        {/* Header */}
        {!compact && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <FiImage size={20} color={colors.primary} />
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: colors.text }}>
                Marca de Agua
              </h3>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: colors.textMuted,
                cursor: 'pointer',
                padding: 4,
              }}
            >
              <FiX size={20} />
            </button>
          </div>
        )}

        {/* Content */}
        <div style={{ padding: compact ? 0 : 20 }}>
          {/* Enable toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <span style={{ color: colors.text, fontSize: 14 }}>Activar marca de agua</span>
            <label
              style={{
                position: 'relative',
                width: 44,
                height: 24,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
                style={{ display: 'none' }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: config.enabled ? colors.primary : colors.border,
                  borderRadius: 12,
                  transition: 'background-color 0.2s',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 2,
                  left: config.enabled ? 22 : 2,
                  width: 20,
                  height: 20,
                  backgroundColor: '#fff',
                  borderRadius: 10,
                  transition: 'left 0.2s',
                }}
              />
            </label>
          </div>

          {/* Upload area */}
          {!config.imageUrl ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: 24,
                border: `2px dashed ${colors.border}`,
                borderRadius: 8,
                textAlign: 'center',
                cursor: 'pointer',
                opacity: isUploading ? 0.6 : 1,
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = colors.primary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = colors.border;
              }}
            >
              <FiUpload size={32} color={colors.textMuted} style={{ marginBottom: 8 }} />
              <p style={{ margin: 0, color: colors.textSecondary, fontSize: 13 }}>
                {isUploading ? 'Subiendo...' : 'Click para subir imagen PNG'}
              </p>
              <p style={{ margin: '4px 0 0', color: colors.textMuted, fontSize: 11 }}>
                Recomendado: PNG con transparencia
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                backgroundColor: colors.bg,
                borderRadius: 8,
                marginBottom: 16,
              }}
            >
              <img
                src={config.imageUrl}
                alt="Watermark preview"
                style={{
                  width: 60,
                  height: 60,
                  objectFit: 'contain',
                  backgroundColor: colors.card,
                  borderRadius: 4,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    color: colors.text,
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {config.filename || 'Marca de agua'}
                </p>
                <p style={{ margin: '4px 0 0', color: colors.textMuted, fontSize: 11 }}>
                  Imagen cargada
                </p>
              </div>
              <button
                onClick={handleRemoveWatermark}
                style={{
                  background: 'none',
                  border: 'none',
                  color: colors.danger,
                  cursor: 'pointer',
                  padding: 8,
                }}
                title="Eliminar marca de agua"
              >
                <FiTrash2 size={18} />
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {/* Settings (only show if watermark is set) */}
          {config.imageUrl && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Position */}
              <div>
                <label style={{ display: 'block', color: colors.textSecondary, fontSize: 12, marginBottom: 8 }}>
                  Posicion
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {positions.map((pos) => (
                    <button
                      key={pos.value}
                      onClick={() => onChange({ ...config, position: pos.value })}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: config.position === pos.value ? colors.primary : colors.card,
                        color: config.position === pos.value ? colors.bg : colors.text,
                        border: `1px solid ${config.position === pos.value ? colors.primary : colors.border}`,
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: config.position === pos.value ? 600 : 400,
                        transition: 'all 0.2s',
                      }}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Opacity */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ color: colors.textSecondary, fontSize: 12 }}>
                    Opacidad
                  </label>
                  <span style={{ color: colors.text, fontSize: 12 }}>
                    {Math.round(config.opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={config.opacity}
                  onChange={(e) => onChange({ ...config, opacity: parseFloat(e.target.value) })}
                  style={{
                    width: '100%',
                    accentColor: colors.primary,
                  }}
                />
              </div>

              {/* Scale */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ color: colors.textSecondary, fontSize: 12 }}>
                    Tamano
                  </label>
                  <span style={{ color: colors.text, fontSize: 12 }}>
                    {Math.round(config.scale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="2"
                  step="0.05"
                  value={config.scale}
                  onChange={(e) => onChange({ ...config, scale: parseFloat(e.target.value) })}
                  style={{
                    width: '100%',
                    accentColor: colors.primary,
                  }}
                />
              </div>

              {/* Margins */}
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', color: colors.textSecondary, fontSize: 12, marginBottom: 6 }}>
                    Margen X
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="200"
                    value={config.marginX}
                    onChange={(e) => onChange({ ...config, marginX: parseInt(e.target.value) || 0 })}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: colors.card,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      fontSize: 13,
                      outline: 'none',
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', color: colors.textSecondary, fontSize: 12, marginBottom: 6 }}>
                    Margen Y
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="200"
                    value={config.marginY}
                    onChange={(e) => onChange({ ...config, marginY: parseInt(e.target.value) || 0 })}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: colors.card,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      fontSize: 13,
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Default watermark config
export function getDefaultWatermarkConfig(): WatermarkConfig {
  return {
    enabled: false,
    imageUrl: null,
    filename: null,
    position: 'bottom-right',
    opacity: 0.8,
    scale: 1,
    marginX: 20,
    marginY: 20,
  };
}
