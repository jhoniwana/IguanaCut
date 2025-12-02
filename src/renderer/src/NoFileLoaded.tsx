import { Fragment, memo, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CSSProperties } from 'react';
import { 
  FaMouse, 
  FaPlay, 
  FaCut, 
  FaDownload, 
  FaKeyboard, 
  FaMagic,
  FaFilm,
  FaMusic,
  FaImages,
  FaClock,
  FaShare,
  FaRocket,
  FaStar,
  FaCheckCircle,
  FaArrowRight
} from 'react-icons/fa';
import { useTranslation, Trans } from 'react-i18next';

import SetCutpointButton from './components/SetCutpointButton';
import SimpleModeButton from './components/SimpleModeButton';
import useUserSettings from './hooks/useUserSettings';
import { StateSegment } from './types';
import { KeyBinding } from '../../common/types';
import { splitKeyboardKeys } from './util';
import { getModifier } from './hooks/useTimelineScroll';
import Kbd from './components/Kbd';

const electron = window.require('electron');

function Keys({ keys }: { keys: string | undefined }) {
  if (keys == null || keys === '') {
    return <kbd>UNBOUND</kbd>;
  }
  const split = splitKeyboardKeys(keys);
  return split.map((key, i) => (
    <Fragment key={key}><Kbd code={key} />{i < split.length - 1 && <span style={{ fontSize: '.7em', marginLeft: '-.2em', marginRight: '-.2em' }}>{' + '}</span>}</Fragment>
  ));
}

const dropzoneStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  color: 'var(--gray-12)',
  margin: '2em',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  whiteSpace: 'nowrap',
  borderWidth: '.7em',
  borderStyle: 'dashed',
  borderColor: 'var(--gray-3)',
  overflow: 'auto',
};

const containerStyle: CSSProperties = {
  width: '100%',
  maxWidth: '1200px',
  padding: '2em',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '3em',
};

const heroStyle: CSSProperties = {
  textAlign: 'center',
  marginBottom: '1em',
};

const titleStyle: CSSProperties = {
  fontSize: '3.5em',
  fontWeight: 'bold',
  background: 'linear-gradient(135deg, #fe2c55 0%, #25f4ee 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
  marginBottom: '0.5em',
  textShadow: '0 0 30px rgba(254, 44, 85, 0.3)',
};

const subtitleStyle: CSSProperties = {
  fontSize: '1.3em',
  color: 'var(--gray-11)',
  marginBottom: '2em',
};

const featuresGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '2em',
  width: '100%',
  marginBottom: '2em',
};

const featureCardStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.05)',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '16px',
  padding: '2em',
  textAlign: 'center',
  transition: 'all 0.3s ease',
  cursor: 'pointer',
};

const featureIconStyle: CSSProperties = {
  fontSize: '2.5em',
  marginBottom: '1em',
  background: 'linear-gradient(135deg, #fe2c55 0%, #25f4ee 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};

const featureTitleStyle: CSSProperties = {
  fontSize: '1.3em',
  fontWeight: 'bold',
  color: 'var(--gray-12)',
  marginBottom: '0.5em',
};

const featureDescStyle: CSSProperties = {
  fontSize: '1em',
  color: 'var(--gray-11)',
  lineHeight: '1.5',
};

const shortcutsStyle: CSSProperties = {
  background: 'rgba(0, 0, 0, 0.3)',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '16px',
  padding: '2em',
  width: '100%',
  maxWidth: '800px',
};

const shortcutItemStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.8em 0',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
};

const ctaStyle: CSSProperties = {
  background: 'linear-gradient(135deg, #fe2c55 0%, #25f4ee 100%)',
  color: 'white',
  padding: '1em 2em',
  borderRadius: '50px',
  fontSize: '1.2em',
  fontWeight: 'bold',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5em',
  transition: 'all 0.3s ease',
  boxShadow: '0 4px 20px rgba(254, 44, 85, 0.3)',
};

function FeatureCard({ icon, title, description, delay = 0 }: {
  icon: React.ReactNode,
  title: string,
  description: string,
  delay?: number,
}) {
  return (
    <motion.div
      style={featureCardStyle}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      whileHover={{ 
        scale: 1.05, 
        boxShadow: '0 8px 30px rgba(254, 44, 85, 0.2)',
        borderColor: 'rgba(254, 44, 85, 0.3)'
      }}
    >
      <div style={featureIconStyle}>{icon}</div>
      <div style={featureTitleStyle}>{title}</div>
      <div style={featureDescStyle}>{description}</div>
    </motion.div>
  );
}

function NoFileLoaded({ mifiLink, currentCutSeg, onClick, darkMode, keyBindingByAction }: {
  mifiLink: unknown,
  currentCutSeg: StateSegment | undefined,
  onClick: () => void,
  darkMode?: boolean,
  keyBindingByAction: Record<string, KeyBinding>,
}) {
  const { t } = useTranslation();
  const { simpleMode, segmentMouseModifierKey } = useUserSettings();
  const [dragging, setDragging] = useState(false);

  const currentCutSegOrDefault = useMemo(() => currentCutSeg ?? { segColorIndex: 0 }, [currentCutSeg]);

  const features = [
    {
      icon: <FaCut />,
      title: t('Lossless Cutting'),
      description: t('Cut videos and audio without quality loss using professional I/O workflow'),
    },
    {
      icon: <FaDownload />,
      title: t('YouTube Downloads'),
      description: t('Download videos directly from YouTube and other platforms with yt-dlp'),
    },
    {
      icon: <FaFilm />,
      title: t('Smart Timeline'),
      description: t('Visual timeline with thumbnails, waveforms, and frame-accurate editing'),
    },
    {
      icon: <FaKeyboard />,
      title: t('Keyboard Shortcuts'),
      description: t('Professional keyboard shortcuts for efficient editing workflow'),
    },
    {
      icon: <FaImages />,
      title: t('Screenshot Capture'),
      description: t('Capture high-quality screenshots from any frame in your video'),
    },
    {
      icon: <FaMagic />,
      title: t('Batch Processing'),
      description: t('Process multiple files at once with powerful batch operations'),
    },
  ];

  const shortcuts = [
    { key: 'Space', action: t('Play/Pause') },
    { key: 'I', action: t('Set Start Point') },
    { key: 'O', action: t('Set End Point') },
    { key: '←/→', action: t('Seek 1 Second') },
    { key: 'Shift+←/→', action: t('Seek 0.1 Second') },
  ];

  return (
    <motion.div
      className="no-user-select"
      style={dropzoneStyle}
      animate={{ borderColor: dragging ? 'var(--gray-9)' : 'var(--gray-3)' }}
      onDragOver={() => setDragging(true)}
      onDragLeave={() => setDragging(false)}
      role="button"
      onClick={onClick}
    >
      <div style={containerStyle}>
        {/* Hero Section */}
        <motion.div style={heroStyle} initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 style={titleStyle}>
            <FaRocket style={{ marginRight: '0.2em', verticalAlign: 'middle' }} />
            LosslessCut
          </h1>
          <p style={subtitleStyle}>
            {t('Professional video editing made simple. Cut, trim, and perfect your media with lossless quality.')}
          </p>
          
          <motion.button
            style={ctaStyle}
            whileHover={{ scale: 1.05, boxShadow: '0 6px 25px rgba(254, 44, 85, 0.4)' }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
          >
            <FaFilm />
            {t('Start Editing')}
            <FaArrowRight />
          </motion.button>
        </motion.div>

        {/* Features Grid */}
        <div style={featuresGridStyle}>
          {features.map((feature, index) => (
            <FeatureCard
              key={index}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
              delay={index * 0.1}
            />
          ))}
        </div>

        {/* Keyboard Shortcuts */}
        <motion.div
          style={shortcutsStyle}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <h3 style={{ fontSize: '1.5em', marginBottom: '1em', color: 'var(--gray-12)', textAlign: 'center' }}>
            <FaKeyboard style={{ marginRight: '0.5em', verticalAlign: 'middle' }} />
            {t('Essential Shortcuts')}
          </h3>
          {shortcuts.map((shortcut, index) => (
            <div key={index} style={shortcutItemStyle}>
              <span style={{ color: 'var(--gray-11)' }}>{shortcut.action}</span>
              <Kbd code={shortcut.key} />
            </div>
          ))}
        </motion.div>

        {/* Original Instructions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          style={{ textAlign: 'center' }}
        >
          <div style={{ fontSize: '1.7em', textTransform: 'uppercase', color: 'var(--gray-11)', marginBottom: '.1em' }}>
            {t('DROP FILE(S)')}
          </div>

          <div style={{ fontSize: '1.3em', color: 'var(--gray-11)', marginBottom: '.1em' }}>
            <Trans>See <b>Help</b> menu for help</Trans>
          </div>

          <div style={{ fontSize: '1.3em', color: 'var(--gray-11)' }}>
            <Trans>
              <SetCutpointButton currentCutSeg={currentCutSegOrDefault} side="start" style={{ verticalAlign: 'middle' }} /> 
              <SetCutpointButton currentCutSeg={currentCutSegOrDefault} side="end" style={{ verticalAlign: 'middle' }} />, 
              <Keys keys={keyBindingByAction['setCutStart']?.keys} /> 
              <Keys keys={keyBindingByAction['setCutEnd']?.keys} /> or 
              <span><kbd style={{ marginRight: '.1em' }}>{getModifier(segmentMouseModifierKey)}</kbd></span>
              +<FaMouse style={{ marginRight: '.1em', verticalAlign: 'middle' }} /> to set cutpoints
            </Trans>
          </div>

          <div style={{ fontSize: '1.3em', color: 'var(--gray-11)' }} role="button" onClick={(e) => e.stopPropagation()}>
            {simpleMode ? (
              <Trans><SimpleModeButton style={{ verticalAlign: 'middle' }} /> to show advanced view</Trans>
            ) : (
              <Trans><SimpleModeButton style={{ verticalAlign: 'middle' }} /> to show simple view</Trans>
            )}
          </div>
        </motion.div>

        {/* Mifi Link */}
        <AnimatePresence>
          {mifiLink && typeof mifiLink === 'object' && 'loadUrl' in mifiLink && typeof (mifiLink as any).loadUrl === 'string' && (mifiLink as any).loadUrl && (
            <motion.div
              style={{ position: 'relative', margin: '.3em', width: '24em', height: '8em' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <iframe 
                src={`${(mifiLink as any).loadUrl}#dark=${darkMode ? 'true' : 'false'}`} 
                title="iframe" 
                style={{ 
                  background: 'rgba(0,0,0,0)', 
                  border: 'none', 
                  pointerEvents: 'none', 
                  width: '100%', 
                  height: '100%', 
                  position: 'absolute', 
                  colorScheme: 'initial' 
                }} 
              />
              <div 
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  position: 'absolute', 
                  cursor: 'pointer' 
                }} 
                role="button" 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if ('targetUrl' in mifiLink && typeof (mifiLink as any).targetUrl === 'string') 
                    electron.shell.openExternal((mifiLink as any).targetUrl); 
                }} 
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default memo(NoFileLoaded);
