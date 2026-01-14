import { useState, useRef } from 'react';
import { MdBlurOn, MdImage, MdGridOn, MdBlurCircular, MdColorLens } from 'react-icons/md';
import { IoMdClose, IoMdCheckmarkCircle, IoMdRefresh } from 'react-icons/io';
import { FiDownload, FiSearch, FiCheck, FiX, FiUpload } from 'react-icons/fi';
import { BsEmojiSmile, BsSquareFill, BsCircleFill, BsStars } from 'react-icons/bs';

// Gemstone Inc inspired colors
const colors = {
  bg: '#0a0a0f',
  surface: '#12121a',
  card: '#1a1a24',
  border: '#2a2a3a',
  primary: '#00E5FF',
  secondary: '#FF148A',
  accent: '#FFC800',
  text: '#ffffff',
  textSecondary: '#b0b0c0',
  textMuted: '#606070',
  gradient: 'linear-gradient(135deg, #00E5FF 0%, #FF148A 100%)',
};

// Blur style types
export type BlurStyle = 'pixelate' | 'gaussian' | 'color' | 'image' | 'emoji' | 'box' | 'diamond';

// Blur style configuration
export interface BlurStyleConfig {
  style: BlurStyle;
  intensity: number;
  color?: string; // For color blur
  imageData?: string; // Base64 image for overlay
  emoji?: string; // Emoji to use
}

// Detected face from backend
export interface DetectedFace {
  id: string;
  thumbnail: string; // base64
  timestamp: number;
  bbox: [number, number, number, number];
  signature: number[];
  appearances: number;
  confirmed?: boolean; // User confirmed this is a real face
}

// Simple blur config
export interface BlurConfig {
  mode: 'off' | 'auto';
  autoIntensity: number;
  confirmedFaces?: DetectedFace[]; // Only blur these faces
  blurStyle?: BlurStyleConfig;
}

// Blur zone per clip (kept for compatibility)
export interface ClipBlurZone {
  enabled: boolean;
  x: number;
  y: number;
  radius: number;
}

// Preset blur styles
const BLUR_STYLES: { id: BlurStyle; name: string; icon: React.ReactNode; description: string }[] = [
  { id: 'pixelate', name: 'Pixelado', icon: <MdGridOn size={24} />, description: 'Efecto clasico de censura' },
  { id: 'gaussian', name: 'Gaussiano', icon: <MdBlurCircular size={24} />, description: 'Desenfoque suave' },
  { id: 'color', name: 'Color Solido', icon: <MdColorLens size={24} />, description: 'Cubrir con un color' },
  { id: 'box', name: 'Caja Negra', icon: <BsSquareFill size={20} />, description: 'Rectangulo negro' },
  { id: 'emoji', name: 'Emoji', icon: <BsEmojiSmile size={22} />, description: 'Cubrir con emoji' },
  { id: 'image', name: 'Imagen', icon: <MdImage size={24} />, description: 'Tu propia imagen' },
];

// Color presets for color blur
const COLOR_PRESETS = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
  '#FFFF00', '#FF00FF', '#00FFFF', '#FF8800', '#8800FF',
];

// Fun pattern presets (rendered as colored shapes)
const EMOJI_PRESETS = [
  { emoji: '🔥', label: 'Fuego' },
  { emoji: '💋', label: 'Labios' },
  { emoji: '😈', label: 'Diablo' },
  { emoji: '🍑', label: 'Durazno' },
  { emoji: '🍒', label: 'Cerezas' },
  { emoji: '💦', label: 'Gotas' },
  { emoji: '😏', label: 'Picaro' },
  { emoji: '🥵', label: 'Caliente' },
  { emoji: '😘', label: 'Beso' },
  { emoji: '💕', label: 'Corazones' },
  { emoji: '👙', label: 'Bikini' },
  { emoji: '😜', label: 'Guiño' },
];

interface Props {
  config: BlurConfig;
  onChange: (config: BlurConfig) => void;
  onClose: () => void;
  videoId?: string | null;
  activeClipsWithBlur?: number;
  totalClips?: number;
}

export default function BlurRegionSelector({ config, onChange, onClose, videoId }: Props) {
  const isActive = config.mode === 'auto';
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>(config.confirmedFaces || []);
  const [hasScanned, setHasScanned] = useState((config.confirmedFaces?.length || 0) > 0);
  const [showStyleGallery, setShowStyleGallery] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Current blur style with defaults
  const currentStyle: BlurStyleConfig = config.blurStyle || {
    style: 'pixelate',
    intensity: config.autoIntensity,
    color: '#000000',
    emoji: '😀',
  };

  const handleScanFaces = async () => {
    if (!videoId) return;

    setIsScanning(true);
    setScanProgress(0);
    setDetectedFaces([]);

    try {
      const response = await fetch(`/api/videos/${videoId}/detect-faces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval: 0.5, max_faces: 20 }),
      });

      if (!response.ok) {
        throw new Error('Face detection failed');
      }

      const data = await response.json();

      if (data.faces && Array.isArray(data.faces)) {
        // Mark all detected faces as confirmed by default
        const faces = data.faces.map((f: DetectedFace) => ({
          ...f,
          confirmed: true,
        }));
        setDetectedFaces(faces);
        setHasScanned(true);

        // Auto-update config with confirmed faces
        onChange({
          ...config,
          mode: 'auto',
          confirmedFaces: faces.filter((f: DetectedFace) => f.confirmed),
        });
      }
    } catch (error) {
      console.error('Face detection error:', error);
    } finally {
      setIsScanning(false);
      setScanProgress(0);
    }
  };

  const toggleFaceConfirmation = (faceId: string) => {
    const updated = detectedFaces.map(f =>
      f.id === faceId ? { ...f, confirmed: !f.confirmed } : f
    );
    setDetectedFaces(updated);

    // Update config with new confirmed faces
    onChange({
      ...config,
      confirmedFaces: updated.filter(f => f.confirmed),
    });
  };

  const handleStyleSelect = (style: BlurStyle) => {
    onChange({
      ...config,
      blurStyle: {
        ...currentStyle,
        style,
      },
    });
  };

  const handleColorSelect = (color: string) => {
    onChange({
      ...config,
      blurStyle: {
        ...currentStyle,
        color,
      },
    });
  };

  const handleEmojiSelect = (emoji: string) => {
    onChange({
      ...config,
      blurStyle: {
        ...currentStyle,
        emoji,
      },
    });
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageData = e.target?.result as string;
      onChange({
        ...config,
        blurStyle: {
          ...currentStyle,
          style: 'image',
          imageData,
        },
      });
    };
    reader.readAsDataURL(file);
  };

  const confirmedCount = detectedFaces.filter(f => f.confirmed).length;

  const getStylePreview = (style: BlurStyle) => {
    switch (style) {
      case 'pixelate':
        return (
          <div style={{
            width: '100%', height: '100%',
            background: `repeating-linear-gradient(0deg, ${colors.textMuted} 0px, ${colors.textMuted} 4px, ${colors.card} 4px, ${colors.card} 8px),
                        repeating-linear-gradient(90deg, ${colors.textMuted} 0px, ${colors.textMuted} 4px, ${colors.card} 4px, ${colors.card} 8px)`,
            backgroundBlendMode: 'multiply',
          }} />
        );
      case 'gaussian':
        return (
          <div style={{
            width: '100%', height: '100%',
            background: `radial-gradient(circle, ${colors.border} 0%, ${colors.card} 100%)`,
            filter: 'blur(2px)',
          }} />
        );
      case 'color':
        return (
          <div style={{
            width: '100%', height: '100%',
            background: currentStyle.color || '#000',
          }} />
        );
      case 'box':
        return (
          <div style={{
            width: '100%', height: '100%',
            background: '#000',
          }} />
        );
      case 'emoji':
        return (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '28px', background: colors.card,
          }}>
            {currentStyle.emoji || '😀'}
          </div>
        );
      case 'image':
        return currentStyle.imageData ? (
          <img
            src={currentStyle.imageData}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            alt="Custom"
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: colors.card, color: colors.textMuted,
          }}>
            <FiUpload size={20} />
          </div>
        );
      default:
        return null;
    }
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
            background: isActive ? colors.accent : colors.card,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <MdBlurOn size={20} color={isActive ? '#000' : colors.textMuted} />
          </div>
          <div>
            <div style={{ color: colors.text, fontWeight: '600', fontSize: '15px' }}>
              Censurar Rostros
            </div>
            <div style={{ color: colors.textMuted, fontSize: '11px' }}>
              Detecta y confirma los rostros
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
          <IoMdClose size={18} />
        </button>
      </div>

      {/* Step 1: Scan for faces */}
      <div style={{
        background: colors.card,
        borderRadius: '10px',
        padding: '14px',
        marginBottom: '12px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: hasScanned ? '12px' : 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '24px', height: '24px', borderRadius: '50%',
              background: hasScanned ? colors.primary : colors.border,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: '700', color: hasScanned ? '#000' : colors.text,
            }}>
              1
            </div>
            <span style={{ color: colors.text, fontSize: '13px', fontWeight: '500' }}>
              Detectar rostros en el video
            </span>
          </div>
          <button
            onClick={handleScanFaces}
            disabled={isScanning || !videoId}
            style={{
              background: isScanning ? colors.border : colors.primary,
              color: isScanning ? colors.textMuted : '#000',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '12px',
              fontWeight: '600',
              cursor: isScanning ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {isScanning ? (
              <>
                <IoMdRefresh size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Escaneando...
              </>
            ) : hasScanned ? (
              <>
                <IoMdRefresh size={14} />
                Re-escanear
              </>
            ) : (
              <>
                <FiSearch size={14} />
                Detectar
              </>
            )}
          </button>
        </div>

        {/* Progress bar during scan */}
        {isScanning && (
          <div style={{
            height: '4px',
            background: colors.border,
            borderRadius: '2px',
            overflow: 'hidden',
            marginTop: '10px',
          }}>
            <div style={{
              height: '100%',
              background: colors.primary,
              width: `${scanProgress * 100}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>
        )}

        {/* Detected faces grid */}
        {hasScanned && detectedFaces.length > 0 && (
          <div>
            <div style={{
              color: colors.textSecondary,
              fontSize: '11px',
              marginBottom: '10px',
            }}>
              Click en un rostro para confirmar o rechazar ({confirmedCount}/{detectedFaces.length} seleccionados)
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))',
              gap: '8px',
            }}>
              {detectedFaces.map(face => (
                <div
                  key={face.id}
                  onClick={() => toggleFaceConfirmation(face.id)}
                  style={{
                    position: 'relative',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: `2px solid ${face.confirmed ? colors.primary : colors.border}`,
                    cursor: 'pointer',
                    opacity: face.confirmed ? 1 : 0.5,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <img
                    src={`data:image/jpeg;base64,${face.thumbnail}`}
                    alt={`Rostro ${face.id}`}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                  {/* Confirmation indicator */}
                  <div style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: face.confirmed ? colors.primary : colors.border,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {face.confirmed ? (
                      <FiCheck size={12} color="#000" />
                    ) : (
                      <FiX size={12} color={colors.textMuted} />
                    )}
                  </div>
                  {/* Appearances count */}
                  <div style={{
                    position: 'absolute',
                    bottom: '4px',
                    left: '4px',
                    background: 'rgba(0,0,0,0.7)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '9px',
                    color: colors.textSecondary,
                  }}>
                    {face.appearances}x
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasScanned && detectedFaces.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '20px',
            color: colors.textMuted,
            fontSize: '12px',
          }}>
            No se detectaron rostros en el video
          </div>
        )}
      </div>

      {/* Step 2: Choose Blur Style */}
      {hasScanned && confirmedCount > 0 && (
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
            marginBottom: '14px',
          }}>
            <div style={{
              width: '24px', height: '24px', borderRadius: '50%',
              background: colors.primary,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: '700', color: '#000',
            }}>
              2
            </div>
            <span style={{ color: colors.text, fontSize: '13px', fontWeight: '500' }}>
              Estilo de censura
            </span>
          </div>

          {/* Style Gallery */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '10px',
            marginBottom: '14px',
          }}>
            {BLUR_STYLES.map(style => (
              <button
                key={style.id}
                onClick={() => handleStyleSelect(style.id)}
                style={{
                  background: currentStyle.style === style.id ? colors.surface : colors.bg,
                  border: `2px solid ${currentStyle.style === style.id ? colors.primary : colors.border}`,
                  borderRadius: '10px',
                  padding: '12px 8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {/* Style preview */}
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: `1px solid ${colors.border}`,
                }}>
                  {getStylePreview(style.id)}
                </div>
                <div style={{
                  color: currentStyle.style === style.id ? colors.primary : colors.text,
                  fontSize: '11px',
                  fontWeight: currentStyle.style === style.id ? '600' : '500',
                  textAlign: 'center',
                }}>
                  {style.name}
                </div>
              </button>
            ))}
          </div>

          {/* Color picker for color style */}
          {currentStyle.style === 'color' && (
            <div style={{
              background: colors.bg,
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '12px',
            }}>
              <div style={{
                color: colors.textSecondary,
                fontSize: '11px',
                marginBottom: '10px',
              }}>
                Selecciona un color:
              </div>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
              }}>
                {COLOR_PRESETS.map(color => (
                  <button
                    key={color}
                    onClick={() => handleColorSelect(color)}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '6px',
                      background: color,
                      border: currentStyle.color === color
                        ? `3px solid ${colors.primary}`
                        : `2px solid ${colors.border}`,
                      cursor: 'pointer',
                      transition: 'transform 0.15s ease',
                    }}
                  />
                ))}
                {/* Custom color input */}
                <label style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '6px',
                  border: `2px dashed ${colors.border}`,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  <input
                    type="color"
                    value={currentStyle.color || '#000000'}
                    onChange={(e) => handleColorSelect(e.target.value)}
                    style={{
                      width: '40px',
                      height: '40px',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Pattern/Emoji picker */}
          {currentStyle.style === 'emoji' && (
            <div style={{
              background: colors.bg,
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '12px',
            }}>
              <div style={{
                color: colors.textSecondary,
                fontSize: '11px',
                marginBottom: '10px',
              }}>
                Selecciona un patron divertido:
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '8px',
              }}>
                {EMOJI_PRESETS.map(({ emoji, label }) => (
                  <button
                    key={emoji}
                    onClick={() => handleEmojiSelect(emoji)}
                    style={{
                      padding: '8px 4px',
                      borderRadius: '8px',
                      background: currentStyle.emoji === emoji ? colors.card : 'transparent',
                      border: currentStyle.emoji === emoji
                        ? `2px solid ${colors.primary}`
                        : `1px solid ${colors.border}`,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span style={{ fontSize: '20px' }}>{emoji}</span>
                    <span style={{
                      fontSize: '9px',
                      color: currentStyle.emoji === emoji ? colors.primary : colors.textMuted,
                    }}>
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Image upload */}
          {currentStyle.style === 'image' && (
            <div style={{
              background: colors.bg,
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '12px',
            }}>
              <div style={{
                color: colors.textSecondary,
                fontSize: '11px',
                marginBottom: '10px',
              }}>
                Sube tu imagen personalizada:
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                style={{ display: 'none' }}
              />
              {currentStyle.imageData ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}>
                  <img
                    src={currentStyle.imageData}
                    alt="Custom overlay"
                    style={{
                      width: '64px',
                      height: '64px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                      border: `2px solid ${colors.primary}`,
                    }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      background: colors.card,
                      border: `1px solid ${colors.border}`,
                      borderRadius: '8px',
                      padding: '8px 14px',
                      color: colors.text,
                      cursor: 'pointer',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <FiUpload size={14} />
                    Cambiar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: '100%',
                    background: colors.card,
                    border: `2px dashed ${colors.border}`,
                    borderRadius: '10px',
                    padding: '24px',
                    color: colors.textMuted,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'border-color 0.2s ease',
                  }}
                >
                  <FiUpload size={24} />
                  <span style={{ fontSize: '12px' }}>Click para subir imagen</span>
                  <span style={{ fontSize: '10px', color: colors.textMuted }}>PNG, JPG, GIF</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Intensity (for blur styles only) */}
      {hasScanned && confirmedCount > 0 && (currentStyle.style === 'pixelate' || currentStyle.style === 'gaussian') && (
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
            <div style={{
              width: '24px', height: '24px', borderRadius: '50%',
              background: colors.primary,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: '700', color: '#000',
            }}>
              3
            </div>
            <span style={{ color: colors.text, fontSize: '13px', fontWeight: '500' }}>
              Intensidad del {currentStyle.style === 'pixelate' ? 'pixelado' : 'desenfoque'}
            </span>
            <span style={{
              marginLeft: 'auto',
              color: colors.accent,
              fontFamily: 'monospace',
              fontSize: '14px',
              fontWeight: '600',
              background: colors.surface,
              padding: '2px 8px',
              borderRadius: '4px',
            }}>
              {config.autoIntensity}
            </span>
          </div>
          <input
            type="range"
            min={15}
            max={45}
            value={config.autoIntensity}
            onChange={(e) => onChange({
              ...config,
              autoIntensity: parseInt(e.target.value),
              blurStyle: { ...currentStyle, intensity: parseInt(e.target.value) },
            })}
            style={{
              width: '100%',
              height: '8px',
              WebkitAppearance: 'none',
              appearance: 'none',
              background: `linear-gradient(to right, ${colors.primary} 0%, ${colors.accent} ${((config.autoIntensity - 15) / 30) * 100}%, ${colors.border} ${((config.autoIntensity - 15) / 30) * 100}%)`,
              borderRadius: '4px',
              outline: 'none',
              cursor: 'pointer',
            }}
          />
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '6px',
            fontSize: '10px',
            color: colors.textMuted,
          }}>
            <span>Suave</span>
            <span>Fuerte</span>
          </div>
        </div>
      )}

      {/* Status */}
      {isActive && confirmedCount > 0 && (
        <div style={{
          background: `linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.05))`,
          borderRadius: '10px',
          padding: '14px',
          marginBottom: '12px',
          border: `1px solid rgba(16, 185, 129, 0.3)`,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}>
            <IoMdCheckmarkCircle size={20} color={colors.primary} />
            <div>
              <div style={{ color: colors.text, fontWeight: '600', fontSize: '13px' }}>
                {confirmedCount} rostro{confirmedCount > 1 ? 's' : ''} confirmado{confirmedCount > 1 ? 's' : ''}
              </div>
              <div style={{ color: colors.textMuted, fontSize: '11px', marginTop: '2px' }}>
                Estilo: {BLUR_STYLES.find(s => s.id === currentStyle.style)?.name || 'Pixelado'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ready to Export */}
      {isActive && confirmedCount > 0 && (
        <div style={{
          padding: '12px',
          background: `linear-gradient(135deg, ${colors.primary}22, ${colors.primary}11)`,
          borderRadius: '10px',
          border: `1px solid ${colors.primary}44`,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <FiDownload size={18} color={colors.primary} />
          <span style={{ color: colors.text, fontSize: '12px' }}>
            <strong>Listo!</strong> Exporta tu video para aplicar la censura
          </span>
        </div>
      )}

      {/* CSS for spin animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
