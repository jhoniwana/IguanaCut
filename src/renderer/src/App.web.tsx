import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  IoMdCloudDownload,
  IoMdCloudUpload,
  IoMdTrash,
  IoMdPlay,
  IoMdCut,
  IoMdDownload,
  IoMdHelpCircle
} from 'react-icons/io';
import { FiScissors, FiUpload } from 'react-icons/fi';
import { FaGithub } from 'react-icons/fa';
import DownloadModal from './components/DownloadModal';
import VideoEditor from './components/VideoEditor';

const generateSessionId = () => 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();

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

// SVG pattern de lagartijas minimalistas
const lizardPattern = `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23222222' stroke-width='0.8' opacity='0.4'%3E%3Cpath d='M30 15 Q25 18 22 22 L18 20 M22 22 Q20 28 22 32 Q18 35 15 34 M22 32 Q26 36 30 35 Q34 36 38 32 M38 32 Q42 35 45 34 M38 32 Q40 28 38 22 L42 20 M38 22 Q35 18 30 15'/%3E%3Ccircle cx='27' cy='20' r='1'/%3E%3Ccircle cx='33' cy='20' r='1'/%3E%3C/g%3E%3C/svg%3E")`;

export default function App() {
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [downloadedVideoId, setDownloadedVideoId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const sessionIdRef = useRef<string>(generateSessionId());
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const initSession = async () => {
      try {
        await fetch('/api/system/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionIdRef.current, auto_clean: true }),
        });
      } catch (error) {
        console.error('[Session] Failed to start:', error);
      }
    };

    initSession();

    heartbeatRef.current = setInterval(async () => {
      try {
        await fetch('/api/system/session/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionIdRef.current }),
        });
      } catch (error) {}
    }, 30000);

    const handleUnload = () => {
      navigator.sendBeacon('/api/system/session/end', JSON.stringify({
        session_id: sessionIdRef.current,
        cleanup: true,
      }));
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('unload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('unload', handleUnload);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  const handleDownloadComplete = (download: any) => {
    setDownloadedVideoId(download.video_id);
    setShowDownloadModal(false);
    setShowEditor(true);
  };

  const handleClearAll = async () => {
    if (!confirm('¿ELIMINAR TODOS LOS DATOS?\n\n¡Esta acción no se puede deshacer!')) return;
    setIsClearing(true);
    try {
      await fetch('/api/system/clear-all', { method: 'DELETE' });
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setIsClearing(false);
    }
  };

  const tutorialSteps = [
    {
      step: 1,
      icon: <FiUpload size={32} />,
      title: 'Sube tu video',
      description: 'Haz clic en "Subir Video" y selecciona un archivo de tu computadora. También puedes descargar videos de YouTube u otras plataformas.',
    },
    {
      step: 2,
      icon: <IoMdPlay size={32} />,
      title: 'Navega al punto de inicio',
      description: 'Reproduce el video y pausa donde quieres comenzar tu clip. Usa las flechas ← → para moverte 1 segundo, o Shift+flechas para 0.1 segundos.',
    },
    {
      step: 3,
      icon: <span style={{ fontSize: '28px', fontWeight: 'bold' }}>I</span>,
      title: 'Marca el inicio (IN)',
      description: 'Presiona la tecla "I" o el botón "I Mark IN" para marcar el punto de inicio de tu clip.',
    },
    {
      step: 4,
      icon: <span style={{ fontSize: '28px', fontWeight: 'bold' }}>O</span>,
      title: 'Marca el final (OUT)',
      description: 'Navega al punto final y presiona "O" o el botón "O Mark OUT". ¡Tu clip se creará automáticamente!',
    },
    {
      step: 5,
      icon: <IoMdCut size={32} />,
      title: 'Repite para más clips',
      description: 'Puedes crear múltiples clips. Cada uno aparecerá en el panel lateral derecho. Marca/desmarca los que quieras incluir.',
    },
    {
      step: 6,
      icon: <IoMdDownload size={32} />,
      title: 'Exporta y descarga',
      description: 'Elige "Combinado" para un solo archivo o "Separados" para archivos individuales. Haz clic en exportar y luego descarga tu video.',
    },
  ];

  return (
    <div style={{
      background: `${colors.bg} ${lizardPattern}`,
      backgroundSize: '60px 60px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header Simple */}
      <header style={{
        background: colors.surface,
        padding: '20px',
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '36px' }}>✂️</span>
            <div>
              <h1 style={{ margin: 0, fontSize: '24px', color: colors.text, fontWeight: '700' }}>
                Cortador de Video
              </h1>
              <p style={{ margin: 0, fontSize: '12px', color: colors.textMuted }}>
                Sin pérdida de calidad
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowTutorial(true)}
            style={{
              background: colors.card,
              border: `1px solid ${colors.border}`,
              color: colors.text,
              padding: '10px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
            }}
          >
            <IoMdHelpCircle size={18} />
            ¿Cómo funciona?
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        maxWidth: '600px',
        margin: '0 auto',
        width: '100%',
      }}>
        {/* Welcome Message */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h2 style={{
            color: colors.text,
            fontSize: '28px',
            fontWeight: '600',
            marginBottom: '12px',
          }}>
            Corta videos fácilmente
          </h2>
          <p style={{
            color: colors.textSecondary,
            fontSize: '16px',
            lineHeight: '1.6',
            maxWidth: '450px',
            margin: '0 auto',
          }}>
            Selecciona las partes que quieres conservar de tu video y expórtalas sin perder calidad.
          </p>
        </div>

        {/* Main Action Buttons */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          width: '100%',
          maxWidth: '400px',
        }}>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowEditor(true)}
            style={{
              background: colors.primary,
              color: '#fff',
              padding: '20px 32px',
              borderRadius: '12px',
              fontSize: '18px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
            }}
          >
            <IoMdCloudUpload size={24} />
            Subir Video
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowDownloadModal(true)}
            style={{
              background: colors.secondary,
              color: '#fff',
              padding: '20px 32px',
              borderRadius: '12px',
              fontSize: '18px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
            }}
          >
            <IoMdCloudDownload size={24} />
            Descargar de Internet
          </motion.button>
        </div>

        {/* Quick Tutorial Preview */}
        <div style={{
          marginTop: '48px',
          padding: '24px',
          background: colors.surface,
          borderRadius: '12px',
          border: `1px solid ${colors.border}`,
          width: '100%',
          maxWidth: '400px',
        }}>
          <h3 style={{
            color: colors.text,
            fontSize: '16px',
            fontWeight: '600',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <FiScissors size={18} color={colors.primary} />
            Atajos de teclado
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { key: 'Espacio', action: 'Reproducir / Pausar' },
              { key: 'I', action: 'Marcar inicio del clip' },
              { key: 'O', action: 'Marcar fin y crear clip' },
              { key: '← →', action: 'Avanzar/retroceder 1 seg' },
            ].map((item) => (
              <div key={item.key} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ color: colors.textSecondary, fontSize: '14px' }}>{item.action}</span>
                <span style={{
                  background: colors.card,
                  color: colors.primary,
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  fontFamily: 'monospace',
                }}>
                  {item.key}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Clear Data Button */}
        <button
          onClick={handleClearAll}
          disabled={isClearing}
          style={{
            marginTop: '32px',
            background: 'transparent',
            border: `1px solid ${colors.danger}`,
            color: colors.danger,
            padding: '10px 20px',
            borderRadius: '8px',
            cursor: isClearing ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            opacity: isClearing ? 0.5 : 1,
          }}
        >
          <IoMdTrash size={16} />
          {isClearing ? 'Limpiando...' : 'Limpiar todos los datos'}
        </button>
      </main>

      {/* Footer with Credits */}
      <footer style={{
        borderTop: `1px solid ${colors.border}`,
        padding: '20px',
        textAlign: 'center',
      }}>
        <p style={{
          color: colors.textMuted,
          fontSize: '13px',
          margin: '0 0 8px 0',
        }}>
          Hecho por{' '}
          <a
            href="https://github.com/jhoniwana"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: colors.primary, textDecoration: 'none' }}
          >
            <FaGithub style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            Jhon
          </a>
        </p>
        <p style={{
          color: colors.textMuted,
          fontSize: '12px',
          margin: 0,
        }}>
          Basado en{' '}
          <a
            href="https://github.com/mifi/lossless-cut"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: colors.secondary, textDecoration: 'none' }}
          >
            LosslessCut
          </a>
          {' '}• Powered by FFmpeg
        </p>
      </footer>

      {/* Tutorial Modal */}
      <AnimatePresence>
        {showTutorial && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.9)',
              zIndex: 200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
              overflowY: 'auto',
            }}
            onClick={() => setShowTutorial(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{
                background: colors.surface,
                borderRadius: '16px',
                padding: '32px',
                maxWidth: '600px',
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ color: colors.text, margin: 0, fontSize: '22px', fontWeight: '600' }}>
                  ¿Cómo usar el cortador de video?
                </h2>
                <button
                  onClick={() => setShowTutorial(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: colors.textMuted,
                    fontSize: '24px',
                    cursor: 'pointer',
                  }}
                >
                  ×
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {tutorialSteps.map((step) => (
                  <div
                    key={step.step}
                    style={{
                      display: 'flex',
                      gap: '16px',
                      padding: '16px',
                      background: colors.card,
                      borderRadius: '12px',
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <div style={{
                      width: '56px',
                      height: '56px',
                      background: colors.primary,
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      flexShrink: 0,
                    }}>
                      {step.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '6px',
                      }}>
                        <span style={{
                          background: colors.primary,
                          color: '#fff',
                          width: '22px',
                          height: '22px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          fontWeight: '700',
                        }}>
                          {step.step}
                        </span>
                        <h4 style={{ color: colors.text, margin: 0, fontSize: '15px', fontWeight: '600' }}>
                          {step.title}
                        </h4>
                      </div>
                      <p style={{
                        color: colors.textSecondary,
                        margin: 0,
                        fontSize: '14px',
                        lineHeight: '1.5',
                      }}>
                        {step.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowTutorial(false)}
                style={{
                  width: '100%',
                  marginTop: '24px',
                  background: colors.primary,
                  color: '#fff',
                  padding: '14px',
                  borderRadius: '10px',
                  border: 'none',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                ¡Entendido, empezar!
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <DownloadModal
        isOpen={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
        onDownloadComplete={handleDownloadComplete}
      />

      <AnimatePresence>
        {showEditor && (
          <VideoEditor
            onClose={() => {
              setShowEditor(false);
              setDownloadedVideoId(null);
            }}
            initialVideoId={downloadedVideoId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
